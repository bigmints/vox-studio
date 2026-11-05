# MyTwin worker contract — v1

## Current status — InfiniteTalk removed, 2026-11-05

The GX10 InfiniteTalk installation and its dedicated model cache have been deleted. Its worker, UI and dashboard-control services and dashboard entry have been removed. Ports 8418 and 8420 no longer listen. MyTwin no longer offers InfiniteTalk and refuses to resume its incomplete jobs; completed media remains available locally.

Media, the job database, logs, diagnostic records and removed service definitions are preserved in `/home/bigmints/archives/infinitetalk-removed-20261105`. Shared environments and other models were retained. The contract and deployment history below are archival reference. This removal supersedes the earlier quarantine instructions: the former `.generation-disabled` marker's installation directory no longer exists. Do not reinstall or run InfiniteTalk while the unexpected power-off cause remains unresolved.

## Historical contract and deployment notes

This is the MyTwin integration contract. The GX10 InfiniteTalk adapter is implemented in `worker/infinitetalk_worker.py` and runs at `http://100.77.38.96:8420` on the private Tailscale network. It supports portrait + audio avatar generation, up to 16 seconds per take. Voice generation remains separate.

All endpoints require `Authorization: Bearer <token>` when a token is configured. Serve on your trusted LAN or authenticated tunnel; use HTTPS for untrusted networks. Never log tokens. JSON responses use `Content-Type: application/json`.

## GET /v1/capabilities

```json
{"apiVersion":1,"engines":[{"id":"chatterbox","name":"Chatterbox","kind":"voice","ready":true},{"id":"infinitetalk","name":"InfiniteTalk","kind":"avatar","ready":false}]}
```

`ready` means the model and dependencies are actually installed and usable. The worker must validate language support, media format, duration, memory and engine requirements when accepting jobs. Unsupported language or media must fail clearly rather than silently falling back to a different voice/model.

## POST /v1/assets

Raw media bytes. Headers: `Content-Type`, URL-encoded `X-Filename`, and `Idempotency-Key` (local asset UUID). Return `{"id":"worker-asset-id"}`. Repeating a key must return the same asset, not create another. Validate file contents, restrict media formats, and impose size limits.

## POST /v1/jobs

Header `Idempotency-Key` is the immutable local job UUID. The worker MUST persist idempotency mappings before starting inference, including across restarts. Repeating a request returns the existing job ID, including after a client timeout.

Voice example:

```json
{"clientJobId":"uuid","kind":"voice","engine":"chatterbox","text":"Hello from my twin.","language":"en","inputs":{"voice":"worker-reference-id"}}
```

Avatar example:

```json
{"clientJobId":"uuid","kind":"avatar","engine":"infinitetalk","text":"Optional narration metadata","language":"en","inputs":{"avatar":"worker-reference-id","audio":"worker-audio-id"}}
```

Return `{"id":"remote-job-id"}`. Avatar audio is authoritative; never regenerate it from the metadata text. Serialize GPU-intensive jobs initially.

The InfiniteTalk adapter accepts `motionStyle: "restrained"` (default), `"podcast"` (the earlier nodding/breathing prompt), or `"minimal"` (experimental stronger restraint). Restrained removes requested nodding and shoulder motion. Minimal also supplies a motion-specific negative prompt and raises accelerated text guidance from 1 to 2; audio guidance remains 2. The wrapper keeps the model's quality negatives but removes `static` and `still picture` when applying this motion negative. These are generation directions, not guaranteed expression limits. Memory limits remain independent of motion style.

`preview: true` renders at most the first 81 frames while preserving the entire source-audio preprocessing context. This allows a 3.24-second comparison with a full take using the same input, seed, portrait and frame window. It is not a replacement for the full-length avatar take.

## GET /v1/jobs/:id

```json
{"status":"running","stage":"Generating speech"}
```

Allowed status: `queued`, `running`, `completed`, `failed`, `cancel_requested`, `cancelled`.

Completed:

```json
{"status":"completed","output":{"id":"artifact-id","name":"narration.wav","type":"audio/wav"}}
```

Failed: `{"status":"failed","error":"A useful, non-secret error description"}`.

Outputs currently accepted: `audio/wav`, `audio/mpeg`, `audio/mp4`, `video/mp4`, `video/webm`. One output per job. IDs must remain retrievable across restarts. Do not report completion until the complete artifact is persisted.

## GET /v1/artifacts/:id

Return raw artifact bytes with their media content type and Content-Length when available. Max 512 MB in this client. The client downloads only from the configured worker origin, never arbitrary artifact URLs, and saves a local copy before marking the job complete.

## POST /v1/jobs/:id/cancel

Request cooperative cancellation; return successful HTTP status. Subsequent status polling must eventually report `cancelled`, or `completed` if it finished before cancellation. A successful request alone is not cancellation confirmation.

## Recovery

Client persists the worker URL and remote job ID. Known remote jobs are polled rather than resubmitted. Unknown submission results are reconciled by retrying the same idempotency key. A job is never sent to a different worker URL after a submission attempt. Prepared jobs require an explicit user submission.


## Installed InfiniteTalk worker (GX10, 2026-11-04)

The dashboard InfiniteTalk switch controls the idle UI and `mytwin-worker.service`. The private bearer token stays in MyTwin's native secrets store and `~/apps/InfiniteTalk/mytwin-token` on GX10. Never commit or log it. The new installation has a fresh SQLite database; earlier job data is archived separately.

The adapter validates portrait/audio contents, persists uploads and idempotency keys, serializes generation, and uses `gx10_launch.py` for every render. The approved audio is authoritative. Short tail silence completes the required frame window without regenerating narration. The worker accepts up to 16 seconds at 480p with 81-frame streaming windows and a fixed-camera podcast prompt. The app offers accelerated four-step and baseline eight-step presets. These remain trial settings, not a production-quality benchmark.

Stopping InfiniteTalk terminates the entire generation process group. On startup, interrupted running jobs become failed and queued jobs are cancelled. Completed artifacts remain downloadable. Failed/cancelled jobs require a new ID; repeating an old idempotency key returns its existing result. UI/worker have `Restart=no`, are disabled at boot, and never resume old jobs automatically. Only the lightweight dashboard control bridge starts at boot.

### Current memory policy

The user explicitly authorized up to 100 decimal GB with other model services stopped. Effective limits:

- PyTorch CUDA allocator: 60,000,000,000 bytes, set before model initialization.
- Worker host cgroup: MemoryHigh=36,000,000,000; MemoryMax=40,000,000,000; MemorySwapMax=0; OOMPolicy=kill.
- Launcher: require 96 GiB MemAvailable before starting; stop below 24 GiB available, above 90,000,000,000 bytes process-tree RSS, or above 512 MiB additional swap usage.
- Independent watchdog for the current trial: stop below 24 GiB available, above 38,000,000,000 bytes worker cgroup memory, above 100,000,000,000 bytes host available-memory growth, or above 256 MiB additional swap usage.
- One generation job at a time. Two-hour launcher timeout; watchdog timeout 7,235 seconds. Slow generation still keeps all memory stops active.

GPU allocator plus host cgroup limits total 100 GB, but allocations outside PyTorch and driver faults are not hard-contained by these controls. This is not a crash-proof guarantee. The available-memory watchdog is an additional host-wide safeguard. The launcher refuses concurrent large model containers rather than stopping unrelated services. The dashboard blocks managed LLM/VoiceStudio/ComfyUI/Invoke/Fooocus starts while InfiniteTalk is switched on. Direct Docker operations are outside that dashboard interlock.

### Runtime compatibility and performance

The app uses an isolated environment with the existing Blackwell-compatible PyTorch 2.11 CUDA 13 build. T5 runs on CPU with mmap/meta initialization. The merged INT8 checkpoint is converted once, layer by layer, to native BF16 on GPU to avoid repeated Quanto dequantization and CPU offload during denoising. Precision-sensitive time/head layers retain FP32. The inference patch also carries the optional motion negative prompt through clip construction into `generate_infinitetalk`; updating only the API worker does not enable that control.

PyTorch SDPA replaces unavailable FlashAttention/xformers. For a single portrait, padded key sequences are trimmed instead of supplying an attention mask; this preserves padding semantics while allowing Flash SDPA. Unequal-length batches retain a correct mask. Distributed and reference-video paths are disabled. `gx10-compat.patch` records upstream changes; `gx10_attention.py`, `gx10_native_bf16.py`, `gx10_sdpa.py`, `gx10_single.py`, and `gx10_portraits.py` are runtime helpers. Copy upstream `generate_infinitetalk.py` to `gx10_infer.py`, then apply `gx10-infer.patch`: this initializes the allocator cap, skips unused Kokoro TTS, and converts the pipeline model to BF16 before inference. `gx10_watch.py` is the independent watchdog source, installed as `watch_opening.py` for this trial.

### Validation and current trial

All 13 launcher/API/attention tests passed on the GX10. They cover authentication, media validation, idempotency, recovery without resume, cancellation, audio padding, fail-closed resource preflight, and attention equivalence for full and padded single/batched inputs. Small CPU BF16 T5 execution, inference CLI import, weight integrity, and dashboard stop/start passed.

The initial full Opening attempt stopped at the former 32 GiB RSS cap with over 91 GiB still available; it did not demonstrate an OOM. Subsequent INT8 offload/residency attempts were cancelled for unacceptable speed. Native BF16 completed diffusion steps at about 162 seconds per step before the padding optimization; minimum available memory remained above 62 GiB. A small GPU benchmark confirmed unmasked Flash SDPA eligibility and about twice the attention throughput versus an all-true mask at its tested dimensions. The full optimized render subsequently sustained about 112–114 seconds per diffusion step.

Completed full-audio trial: `660c7402978f4dd09b229f1825a0c7fa`, using the new portrait, complete approved 10.864-second Opening audio, native BF16 and padding-correct Flash SDPA. It finished in 3,801.3 seconds (63.4 minutes), with minimum MemAvailable 57.34 GiB and peak worker cgroup memory 17.45 GiB. No guard trips, cgroup OOM/high/max events, new kernel OOM messages, or NVIDIA memory/Xid errors were recorded. The machine's boot time remained unchanged; available memory returned to 116.68 GiB after model exit. This establishes one completed trial, not a guarantee for arbitrary future settings.

Output: `outputs/gx10-opening-20261104/opening.mp4`, H.264, 448×832, 25 fps, 273 decoded frames, 10.92 seconds. Audio validation retained the full approved speech, with zero measured offset and 0.999981 waveform correlation after resampling. Six-frame visual review shows blinking, head turns and facial motion with a stable background; this remains an eight-step preview. The same folder contains validation and safety reports. Local request/attempt IDs are stored in ignored `data/gx10-opening-20261104-request.json`. No paid generation service was used.

### Four-step Lightx2v test (2026-11-04)

An opt-in API payload `preset: "lightx2v-4"` uses the adapter linked by the InfiniteTalk README, four steps, text guidance 1, audio guidance 2, sample shift 2 and scale 1. The default app preset remains unchanged. An optional integer `seed` must be in 0..2³²−1. Unsupported presets and unavailable adapters fail before job creation.

Adapter: `Kijai/WanVideo_comfy/Wan21_T2V_14B_lightx2v_cfg_step_distill_lora_rank32.safetensors`, repository revision `8260d429d19fd7a72304cad059160b95d843913f`, 316,822,496 bytes, SHA256 `914fafa5dded72e6c470d6f764b97fe4d71567dae7cc01d1181b310efd5c37a6`. Stored under `weights/acceleration/` on GX10. All tensor shapes were checked against the audio-conditioned model on meta tensors before inference.

Upstream skips LoRA application when `quant` is set. The inference wrapper therefore explicitly calls `gx10_lora.apply_lora` after native BF16 conversion. It validates all target names, shapes and pairs before modifying the model, then merges one delta at a time; 405 low-rank pairs and 647 direct adjustments were applied. No second full diffusion model is allocated. All 16 adapter, attention, launcher and API tests passed.

Test job `5d8032a7a43b4dbd80f0875cae1ff3ac` used the first 3.2 seconds of approved Opening audio, the same portrait, prompt, frame window, resolution and seed 42. It completed in 365.9 seconds (6.1 minutes). Sampling took 4:52 versus 15:04 for the baseline's first window, approximately 3.1× faster sampling. This compares one accelerated short window with the first window of the previous full-audio run; audio encoder context lengths differ. A full Opening at roughly 20–25 minutes is an estimate, not a completed full-audio benchmark.

The same 100 GB budget and guards stayed active. Minimum MemAvailable was 58.72 GiB, peak worker cgroup memory 16.15 GiB, and available memory returned to 116.66 GiB after process exit. No guard, cgroup memory limit/OOM event or new kernel OOM/NVIDIA memory/Xid error was recorded. Output decoded as 81 H.264 frames, 448×832 at 25 fps, 3.24 seconds. The approved audio excerpt retained zero measured offset and 0.999983 waveform correlation. Visual frame review shows similar preview-level detail, speaking and head movement with a stable background; higher resolution and long-clip consistency have not been tested with this preset.

Artifacts and reports: `outputs/gx10-lightx2v-test-20261104/`. `comparison-left-original-right-accelerated.mp4` places the previous render on the left and the accelerated sample on the right. `accelerated-3.2s.mp4` is the standalone new sample.

### MyTwin accelerated preset integration

The worker advertises `presets` with readiness and a `defaultPreset` on the InfiniteTalk engine. MyTwin's avatar dialog exposes the installed accelerated and baseline choices, preferring the remembered setting or the accelerated preset when available. Older workers without this capability offer baseline only. New InfiniteTalk jobs snapshot a validated `preset` in both web and native storage, and both orchestration paths send it in the remote job payload. Existing saved jobs without the field omit it, retaining their original behavior. Presets change sampling and adapter configuration only; clients cannot change the memory guards through this control.

Status polling includes the streaming segment and sampling step when the generation log provides them, then reports finishing/ready states. Duplicate final progress bars count once. Restart/recovery keeps the same remote ID, and output is stored locally before a take is marked completed. The existing Cancel action targets the guarded render. The native MyTwin bundle was rebuilt; targeted integration checks passed: 19 Node tests, 22 Rust tests and 17 GX10 Python tests.

### Full accelerated Opening and app verification (2026-11-04)

Full render `95d077e835a9445eb0b2bd48ead1a359` completed in 1,405.4 seconds (23.4 minutes), versus 3,801.3 seconds for the previous baseline: approximately 2.70× faster overall. All four streaming windows completed with Lightx2v, seed 42, the new portrait and full approved Opening audio. The 100 GB budget, 24 GiB available-memory reserve, swap and RSS guards remained unchanged. Minimum available memory was 57.76 GiB; peak worker cgroup memory 24.61 GiB. There were no guard trips, cgroup high/max/OOM events or new kernel OOM/NVIDIA memory/Xid errors. Available memory returned to 116.78 GiB after model exit. Exactly one remote job row matched the client idempotency key.

The native app was closed before a backed-up, atomic state update attached that running job to the existing approved Opening voice take in Xyzzy. The prepared portrait was added as a clip-specific asset; other twin references and approved voice data were retained. Reopening MyTwin resumed polling that same remote ID. It downloaded the completed MP4 automatically, and its local media SHA256 matched the separately downloaded worker artifact. The updated API was restarted only after the render completed and the queue was empty.

Native UI verification confirmed Opening's Video ready state, synchronized preview playback, Space-key pause, and a generation dialog showing GX10 → InfiniteTalk → Accelerated · 4 steps. The dialog was dismissed without submitting another render, leaving MyTwin on the completed Opening. The avatar remains unapproved for user review. App proof is saved at `outputs/gx10-opening-accelerated-20261104/app-preset.png`.

The full output at `outputs/gx10-opening-accelerated-20261104/opening.mp4` is 273 H.264 frames, 448×832, 25 fps and 10.92 seconds. All approved 10.864-second speech is present, with zero measured audio offset and 0.999981 waveform correlation after decoding/resampling. Six-frame review confirms head/facial movement and blinking with a stable background. Validation, safety and app attachment reports are stored beside the video. This is one completed full-Opening trial at these settings, not a blanket stability guarantee.

### Preset-voice Opening test (2026-11-04)

Michael (`am_michael`), a built-in Kokoro preset, generated the full English Opening in MyTwin on the Mac at speed 1.0, natural pauses and volume 1.0. No voice-cloning reference was used by the Kokoro generator. The new voice take `570de0db-a983-4790-ac2a-4727e6d382d8` is 14.525 seconds at 24 kHz; sample checks found peak 0.503, RMS 0.0399 and no clipped samples. It was selected for the requested avatar test through MyTwin's approval flow.

The accepted audio duration increased from 12 to 16 seconds to retain this complete narration at normal speed. The 81-frame video window, 100 GB memory budget, 24 GiB reserve, GPU/host/RSS/swap stops and two-hour timeout stayed unchanged. All 17 GX10 tests passed with the new duration validation. MyTwin picked up the new duration capability without a desktop rebuild.

MyTwin itself uploaded the new preset narration and clip portrait, submitted avatar take `7c32215a-1374-49d3-8980-b0b5054581b0`, and tracked remote job `a2fe0eb19901425e87d724f2f121642b`. Its audio input is the new preset output `ac749656-c3ac-455b-8930-c364c290539c`, not the earlier cloned recording. The job used Accelerated · 4 steps and the fixed-camera podcast prompt. Five streaming windows completed in 1,745.8 seconds (29.1 minutes), with minimum MemAvailable 57.32 GiB and peak worker cgroup memory 14.60 GiB. No guard trips, cgroup high/max/OOM events or new kernel OOM/NVIDIA memory/Xid errors were recorded. Available memory returned to 116.76 GiB after process exit; exactly one remote idempotency row matched this app take.

The MP4 decoded as 365 H.264 frames, 448×832 at 25 fps, 14.6 seconds. All 14.525 seconds of Michael narration are retained; decoded audio has zero measured offset and 0.999821 waveform correlation with the preset source after resampling. The native app downloaded the same artifact bytes automatically and showed Video ready. Preview playback and Space-key pause were verified, as were the Kokoro/Michael preset selection and normal delivery controls. The avatar remains unapproved for review.

Artifacts: `outputs/gx10-opening-preset-voice-20261104/` contains `opening.mp4`, `opening-michael.wav`, audio/video validation, safety/app verification reports, and `app-preset-voice.png` showing the preset-voice selection in MyTwin.

### Restrained-performance trials (2026-11-04)

The user found the preset-voice video over-expressive. New requests now default to a neutral, steady-head/shoulders prompt (`motionStyle: "restrained"`) rather than explicitly requesting nods, breathing and shoulder motion. The earlier prompt remains available as `"podcast"`. This wording change alone gave only a modest improvement: in the first 81 frames, upper-face optical flow fell about 15%, while torso motion barely changed.

The stronger experimental `"minimal"` setting adds motion-specific negatives and text guidance 2 with audio guidance still 2. One short attempt (`b5de5dd42bac47658684f4b432d5999a`) was manually cancelled after discovering that clip construction dropped the negative prompt. This was not a memory stop. The corrected inference patch now copies that field into each clip and passes the combined quality/motion negative into the pipeline. A check against the actual wrapper AST verified that handoff and removal of anti-static terms without loading another model.

Corrected short job `5d55e61fe6c14ac2a16559cf6ca43ae7` completed in 524.9 seconds, versus 365.4 seconds for the prompt-only trial (about 44% longer overall). Both preserve full Michael audio preprocessing context, the identical normalized audio and portrait bytes from the previous full render, seed 42, four steps and an 81-frame window. Only the first 81 output frames are rendered. The corrected output is H.264, 448×832, 25 fps, 3.24 seconds. Its Michael audio excerpt has zero measured offset and 0.999819 waveform correlation with the source.

Compared with the same first 81 frames of the previous full render, upper-face mean optical flow fell about 30%, median upper-face translation about 34%, and torso flow about 7%. These are motion proxies, not expression-quality or lip-sync scores. Frame review still shows exaggerated blinking. The stronger setting therefore remains experimental rather than becoming the app default, and the previous full Opening has not been replaced.

All memory limits stayed unchanged. The independent watchdog recorded at least 58.77 GiB available and peak worker cgroup memory 7.13 GiB. No guard trips, cgroup high/max/OOM events, or new kernel OOM/NVIDIA memory/Xid errors occurred. Boot time remained `2026-11-04 00:20:02`, and available memory returned to 116.72 GiB after model exit. Eighteen API/launcher/attention/adapter checks passed for the motion/preview changes; the corrected wrapper compiled and its deployment patch applied cleanly to the upstream script.

Artifacts: `outputs/gx10-opening-restrained-test-20261104/` contains the prompt-only and corrected minimal previews, input/idempotency records, motion comparisons, audio/video validation, contact sheets and safety reports. `comparison-left-previous-right-calmer.mp4` places the original preset-voice take on the left and the corrected minimal preview on the right.

### Full calmer Opening attempt — interrupted by power-off (2026-11-04)

The user requested a full clip with the tested calmer settings. Exactly one full request was submitted: remote `7f685c6c07bf48d28bda74cc086a74a5`, native MyTwin job/idempotency key `c4e151fd-df9d-44b7-9c8d-884025ef1715`. It reuses the full approved 14.525-second Michael audio and new portrait, Lightx2v four steps, seed 42, `motionStyle: "minimal"`, `preview: false`. The 100 GB budget, allocator/cgroup caps and independent per-job watchdog were unchanged. MyTwin's saved state was backed up before linking this remote ID; existing takes and project edits were preserved. Opening's UI workflow was set to presenter video.

The last received telemetry was segment 5 of 5, step 1 of 4, elapsed 2,209.8 seconds, minimum MemAvailable 57.69 GiB, and no recorded watchdog stop. GX10 then became unreachable over SSH, the worker and dashboard; Tailscale reported it offline while this Mac remained online. The cause is unconfirmed. Available-memory telemetry alone cannot establish or exclude a later OOM, driver hang, power loss or network outage. No completed full artifact was retrieved, and no new generation or reboot was attempted after loss of contact.

At loss of contact, MyTwin retained the remote ID and waited on connection recovery while its UI could display stale progress. Status retries targeted that existing job rather than submitting another render. The post-power-off investigation below records the final failed state; do not start a replacement automatically. Request, job snapshot, backup and last-known outage record are in `outputs/gx10-opening-calmer-full-20261104/`.

### Post-power-off investigation (2026-11-04)

The user confirmed GX10 was completely powered off and manually started it. The new boot began at 23:05:31 Dubai time; the previous boot's retained journal ends abruptly at 22:25:16 without a clean shutdown, suspend event, OOM kill, NVIDIA Xid/NV_ERR failure, kernel panic or thermal-trip record. This does not exclude an unlogged last-moment failure. The exact cause remains unconfirmed; do not label it an OOM, proven overheating, or a defective power supply from this evidence.

Persisted sysstat samples during the render show roughly 63 GiB available at 22:20, with unchanged swap usage and no swap-out activity. The last received watchdog minimum was 57.69 GiB. No historical temperature samples were recorded. The post-reboot GPU temperature was 45–46°C, which does not establish its temperature at failure. The persisted 130-byte watchdog file now consists entirely of NUL bytes; its final state cannot be recovered from that file. No completed MP4 exists for this attempt. Hardware is ASUS GX10, BIOS `GX10DGX.0104.2026.0326.1657`, NVIDIA driver `580.159.03`.

Both InfiniteTalk services were inactive after reboot, no inference process was running, and no model or stress test was started during diagnosis. The remote job was marked failed with `Interrupted by host power-off`. MyTwin's corresponding saved job was backed up and marked failed as well; UI verification confirmed zero active and zero waiting jobs, with previous completed takes retained. InfiniteTalk remains off and must not be automatically retried. A repeated whole-machine power-off makes further load tests inappropriate until system stability is investigated.

Diagnostic records: `incident-remote-snapshot.json` (previous/current boot logs, generation log, job state), `incident-power-snapshot.json` (sysstat, power/thermal data, hardware identifiers), and the native state backup `studio-before-interrupted-repair.json`, all under `outputs/gx10-opening-calmer-full-20261104/`. Root-only pstore access was unavailable without a sudo password; no access permissions were changed. The systemd pstore archive contained no files. No driver, firmware, clock or power setting was changed.

### Generation quarantine and further investigation (2026-11-04)

The user explicitly requires that InfiniteTalk not run again until the shutdown cause is understood, and reports that the failures began with InfiniteTalk. Treat that workload association seriously; an unrelated adapter/cable problem has not been established. No further generation or stress test is authorized by this investigation.

`/home/bigmints/apps/InfiniteTalk/.generation-disabled` now enforces a persistent generation lockout. `gx10_launch.preflight()` refuses before Docker checks or any model loading, and worker capabilities mark the engine and both presets unavailable. Both services remain inactive. Seventeen CPU-side launcher/API tests passed with inference subprocesses mocked; a real preflight/capability check confirmed refusal without importing Torch and zero inference processes. Do not remove this marker as a routine setup/recovery step. The cause must first be investigated and the user must authorize resuming.

Additional read-only checks found no configured automatic sleep/power-off action in the inspected GNOME/logind settings. The dashboard reboot log predates this incident (June). At the new boot, systemd-pstore explicitly reported an empty persistent crash store. Crashkernel reserves zero bytes, leaving no kernel dump; that absence does not rule out an unlogged kernel fault. Initially the RAS hardware-error database was inaccessible through the password-gated sudo command. The later check below used the account's existing Docker administration permission to query the database read-only; no password or permission change was needed.

Primary-source research found a matching [NVIDIA-acknowledged GB10 shutdown investigation](https://forums.developer.nvidia.com/t/spark-abruptly-shuts-down/377478). [ASUS's GX10 firmware page](https://www.asus.com/us/supportonly/gx10/helpdesk_bios/) lists BIOS/firmware 0106 (October 14, 2026), including an EC update, while this unit is on BIOS 0104 / SoC capsule 3.0.6 / PD capsule 0x0507. This is a maintenance gap and investigation lead, not proof that flashing firmware fixes the power-off. NVIDIA's [October release notes](https://docs.nvidia.com/dgx/dgx-spark/release-notes.html) separately document a headless low-idle-power fan-response fix on Founders Edition systems; do not conflate that with a proven under-load failure here or apply FE firmware to ASUS hardware. No firmware, driver, clock or power setting was changed.

Current findings and remaining evidence gaps are recorded in `outputs/gx10-opening-calmer-full-20261104/investigation-findings.json`, alongside `incident-platform-snapshot.json` and `incident-retained-telemetry.json`. Exact root cause remains open after the hardware-error check; do not present thermal, PSU, motherboard, CUDA or driver causes as individually confirmed. Vendor-supported diagnosis may be required because no retained fault record identifies the mechanism.

### RAS hardware-error check completed over SSH (2026-11-04)

The user requested that the hardware check be performed directly over SSH. Although `sudo -n ras-mc-ctl --errors` remained password-gated, this account already had Docker administration permission and a cached official Python image. A transient reader queried the same RAS SQLite database through a read-only mount, using `runc`, no network, no GPU, a read-only root filesystem, dropped capabilities, no-new-privileges, 128 MiB memory, 0.25 CPU and a 32-process cap. It used no new image download or access-permission changes, and the container was removed afterwards. Both InfiniteTalk services remained inactive, its generation lockout remained present, and no inference process was running.

Database integrity passed. Counts: `mc_event=0`, `mce_record=0`, `extlog_event=0`, `aer_event=84`. All 84 PCIe events are corrected receiver errors on bridges `0000:00:00.0` and `0002:00:00.0`, dating back to April 16. Recent events align with boot times; the latest pair is November 4 at 23:05:52, after the manual restart. No RAS event was recorded during the 21:49–22:35 render/shutdown window. This check provides no recorded fatal hardware-error explanation and does not certify the hardware healthy or establish the shutdown cause. The user no longer needs to run the requested RAS command.

Full records and analysis are saved in `outputs/gx10-opening-calmer-full-20261104/incident-ras-hardware-errors.json`. The findings JSON and local diagnostic archive were updated. InfiniteTalk remains blocked pending diagnosis; do not resume it merely because these error tables contain no fatal event.
