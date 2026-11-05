# MyTwin Studio

## InfiniteTalk removed — 2026-11-05

InfiniteTalk has been uninstalled from GX10 after repeated unexpected power-offs. Its dedicated model cache, worker/UI/control services and dashboard controls have been removed. MyTwin no longer offers it and refuses to resume incomplete InfiniteTalk jobs. OpenRouter avatar generation remains available through an explicit user action.

Photos, audio, completed videos and diagnostic records are preserved. GX10's archived media, job database, logs and service definitions are in `/home/bigmints/archives/infinitetalk-removed-20261105`. Shared ComfyUI and InvokeAI installations were retained. Historical InfiniteTalk source and deployment notes below are retained for reference; they do not describe a running installation. Do not reinstall or run InfiniteTalk while the shutdown cause remains unresolved.

A private studio for scripts, voice takes and photorealistic presenter assets. Inspired by the focused, dark Voicebox workflow. No screen recorder or video editor is included.

## Desktop app (Rust / Tauri)

The desktop app runs without Node.js or a browser server. Its backend is Rust; the interface uses plain HTML/CSS/JavaScript in the system webview.

```sh
npm run desktop        # development
npm run build:desktop  # package MyTwin.app
npm run test:rust      # Rust tests
```

Build tools: Rust, Xcode command-line tools, and the official Tauri CLI (installed through `npm install`). Runtime: macOS only for this build. The app bundle is generated at `src-tauri/target/release/bundle/macos/MyTwin.app`. It can be opened directly or copied to Applications.

Native file pickers import references and export results. Desktop data is stored in `~/Library/Application Support/com.pretheesh.mytwin/`, separately from the browser prototype. Credentials are stored there in an owner-readable file; they are not encrypted at rest. Prototype data is not automatically imported.

Historical GX10 adapter source is retained in `worker/infinitetalk_worker.py`. See [the worker API](docs/worker-api.md) for the removal status and archived contract.

## Browser prototype

Requires Node.js 22+; there are no npm dependencies.

```sh
npm start
```

Open http://127.0.0.1:4317. Set `PORT` to change the port. Run `npm test` for integration checks.

## What works now
- **Video Dubbing** projects accept an uploaded MP4/MOV/WebM or a generated OpenRouter clip in one workspace. Choose your twin, write a script (or review an optional source transcription), generate the cloned voice, set its start and timing, render locally, then download the dubbed MP4. Existing video takes offer **Dub with my twin**. Source footage and previous renders are retained.
- Dubbing replaces all original audio, keeps the full video duration and orientation, and does not alter lip movements. Natural pace rejects narration that would be cut off; Fit supports 0.5×–2× voice speed. Source videos are limited to 512 MB / two hours, and source transcription to 10 minutes / 20 MB extracted WAV. Codec support follows macOS AVFoundation; H.264 MP4/MOV are recommended. Local video processing requires macOS and Xcode command-line tools, like existing video assembly. Cloud speech, transcription and video generation run only on explicit action.
- Podcast timelines have a separate track for the host and every guest, with independent volume and mute controls. Dialogue follows one conversation timeline across those tracks, so separating speakers preserves the turn order, pacing, trims and overall duration. Existing podcasts gain speaker tracks when opened; music and existing takes stay in place. **Speakers & voices → Add guest** supports up to seven guests, each with their own voice and track.
- Podcast **Conversation timing** offers Quick exchange, Natural conversation, Relaxed conversation and Original timing. Conversation modes skip quiet padding at the beginning and end of each generated take, preserve pauses within a turn, and place a short gap between speakers. Playback and WAV export use the same ranges; original audio files remain intact. Manual trims and explicit clip positions take precedence. Timing changes reuse existing voices and do not incur generation charges.
- Podcast opens in an audio workspace with the complete episode dialogue and a speaker/voice status for each turn. **Speakers & voices** assigns twins and optional preset overrides; video setup is optional. **Generate missing voices** validates the entire script first, shows the selected models, then processes one turn at a time. It reuses matching prepared, running and completed takes; changing the text, twin, preset, model, reference or delivery creates a new snapshot. **Stop after current turn** prevents further submissions while the current take finishes. A stopped or interrupted episode never auto-submits on reopen; click Generate missing voices to resume. Keep the app open during generation. Play the conversation from the timeline or an individual turn, reorder turns, and use **Export audio** for the mixed WAV. Video remains accessible through **Video workspace**.
- New projects ask for a format: **Story Telling** or **Podcast**. Existing projects open as Story Telling.
- Podcast projects have two named characters, separate twin/voice assignments, a shared studio reference and direction, and a speaker selector for every turn. **Import script** splits `Host: …` / `Guest: …` dialogue (or your character names) into ordered timeline clips. Each turn uses the assigned character's references for voice and avatar generation; changing a speaker or preset voice makes older takes ineligible for reuse.
- In a Podcast project, configure **Characters & studio**, import or write dialogue, generate each turn's voice in **Audio**, then generate its video in **Video**. Studio images and direction apply across turns; individual shots can override them. Scene video retains the original voice audio using the existing generation pipeline. Scene mode does not provide two-person lip sync; the existing avatar workflow generates one speaking character at a time. Paid provider rendering still requires an explicit Generate action.

- Local productions, editable script sections, autosave and revision undo.
- Reference profiles with voice audio and appearance images/videos.
- Original narration upload and playback.
- OpenRouter narration drafting, polishing, shortening and expansion, with review before applying.
- Separate model lists based on input/output modalities and supported API endpoints.
- OpenRouter speech with model-specific preset voices or reference cloning when the provider supports it.
- MP3 playback and PCM-to-WAV conversion using the returned sample rate and channels.
- WAV/MP3 transcription using audio-input models, reviewed before replacing the script.
- Persistent prepared jobs, explicit submission, remote job tracking, cancellation and retries/reconciliation.
- Versioned voice/avatar inputs, approved-voice gate, output playback and downloads.
- Settings with server-side keys, a connection check, and capability-driven engine choices.

## Connect services

Open **Settings → Connections** to connect API providers or download local models on one page, grouped into Chat, Audio, and Video. Click **Connect** beside OpenRouter and paste your key; that connection is shared across all three groups. **Manage → Model choices** keeps the searchable Chat, Speech, and Transcription model selectors with the provider. Refresh models fetches current choices and voices from OpenRouter. Writing and transcription send content only when their action is clicked. Speech jobs are saved first and sent only when Generate with OpenRouter is clicked. Alternatively set `OPENROUTER_API_KEY` in `.env` (see `.env.example`). Provider requests incur normal provider charges. No live paid request was made during development.

GX10 integration uses the authenticated [MyTwin worker API](docs/worker-api.md) at `http://100.77.38.96:8420`. The InfiniteTalk status UI is on port 8418. Generate or upload narration first. The current guarded preset accepts a portrait and audio up to 16 seconds, with one generation job at a time. In the avatar dialog, choose GX10 and **Accelerated · 4 steps** or **Baseline · 8 steps**. Accelerated is selected when the worker advertises its adapter as ready. The same memory limits and automatic low-memory stop apply to both choices.

The orchestration layer transfers reference media, submits immutable jobs with idempotency keys, polls known remote jobs, and downloads results. Prepared jobs never auto-submit on reconnect. Unknown connection failures require explicit refresh/resubmit. A failed remote render is retained; prepare a new job to rerun it.

## Storage and boundaries

`data/studio.json` stores projects and jobs; `data/media/` contains originals and completed results. `data/secrets.json` stores credentials with owner-only file permissions, unencrypted at rest. Back up `data/`; do not share it without removing credentials and private media. It is gitignored. The app binds only to `127.0.0.1`, checks Host and Origin, and is intended for a single local user. Do not expose it publicly.

References are stored but not trained or audited for model quality. Avatar generation requires a real worker. OpenRouter speech generation runs independently of GX10. InfiniteTalk is no longer installed on GX10. Local voice engines, native export transcoding, transparent video and whole-production stitching are separate follow-up work. Downloads preserve the worker's output format. Profiles can be created and edited, including replacement references. Profile and project deletion remain follow-up work. Individual uploaded files and returned artifacts are limited to 512 MB.

## Layout

- `src-tauri/src/`: native Rust storage, API commands, file import/export and worker orchestration.
- `src-tauri/tauri.conf.json`: desktop window, media scopes, security and bundle settings.

- `server.mjs`: local HTTP API, media serving, OpenRouter and validation.
- `lib/store.mjs`: atomic serialized persistence.
- `lib/worker.mjs`: idempotent worker orchestration.
- `public/`: dependency-free browser interface.
- `test/`: HTTP and worker integration tests, using isolated temporary storage and a mock remote worker (no generated media is simulated in the actual app).

OpenRouter API reference: https://openrouter.ai/docs/api/reference/overview

## OpenRouter speech behavior

The catalog combines `/models` with `/models?output_modalities=speech`. Audio input alone does not imply speech output. Clone support is checked through the model endpoints API, never inferred from audio input. The selected model, voice mode, preset voice and reference IDs are captured with each take.

Speech submissions are claimed atomically. A take can be submitted once; failures or interrupted requests require a new take after checking OpenRouter activity. No automatic retry is made because an interrupted request may have used credits. A submitted speech request cannot be cancelled remotely.

Google and HeyGen speech request PCM; other models request MP3. PCM is wrapped into WAV using the response Content-Type rate and channel count, with no guessed defaults. Provider-specific limits and unsupported formats produce a failed take rather than silent substitution. Reference audio and transcription uploads are capped at 20 MB; returned speech is capped at 128 MB. Long scripts can be split into production sections.

Tests use mock providers. The public catalog and capability lookup were verified live; paid speech, cloning quality and transcription remain unverified until a key is supplied in the app.

Voice samples can be recorded from My Twin → Edit twin. Recording is user-initiated, limited to 90 seconds, previewed before saving, and stored as mono PCM WAV. Closing the editor stops capture. The desktop bundle includes a macOS microphone usage description. Editing a twin preserves its ID and existing take snapshots. Capture-format and storage tests use synthetic audio; microphone permission and physical capture need user verification on the Mac.

## OpenRouter video generation
Open **Generate video**, click **Refresh video models**, select a model and describe the scene in the section prompt. Choose duration, resolution and aspect ratio from the model's advertised options. A twin is optional; enabling **Use twin photo as the first frame** requires a JPG, PNG or WebP photo under 20 MB and a model that advertises first-frame support. Save the job, then explicitly click **Generate with OpenRouter** to submit it.

This mode creates silent clips (`generate_audio: false`); it does not use or lip-sync an approved voice take. Avatar/video-editing/upscaling models without advertised clip durations are excluded from this workflow. Model descriptions and pricing links are available in the controls; provider-specific input requirements and combinations still apply. The separate Avatar video workflow offers OpenRouter or the GX10 worker for voice-driven rendering.

Both native and browser backends persist remote video IDs, poll every 30 seconds, and download completed MP4/WebM files (maximum 512 MB) for local playback and export. Refresh retries status/download checks, never submission. A submission interrupted before its remote ID is saved is marked failed and requires checking OpenRouter activity before making a new take. Submitted video jobs cannot be cancelled from this interface. Mock tests cover request validation and restart recovery. A real Avatar IV Opening render completed on November 3, 2026: 1280×720 H.264/AAC, 10.88 seconds, $0.537768. The saved video audio correlates 0.9986 with the approved voice recording after accounting for a 23 ms offset. Subjective lip-sync quality remains for user review.

API reference: https://openrouter.ai/docs/guides/overview/multimodal/video-generation

## OpenRouter avatar videos
MyTwin’s **Spending** view shows saved OpenRouter charges in USD and exports a CSV record. Totals use provider-reported `usage.cost`, including each individual shot of multi-shot videos once. Missing costs remain **Unknown**, including historical speech takes and rejected requests; they are not treated as zero. This is a record of saved MyTwin requests, not an account-wide OpenRouter invoice. Video billing metadata is saved before downloading output so a download failure does not hide a reported charge.

Avatar IV requires a detectable human-like face. If HeyGen rejects a reference with “No face detected,” MyTwin explains the failure and blocks further Avatar IV submissions using that same saved image. Select a new human portrait or use image-to-video for non-human characters; scene animation with narration does not guarantee lip-sync.

In **Avatar video**, choose **OpenRouter** to use `heygen/avatar-iv` at 720p ($0.05 per output second at the checked November 2026 rate). Select a twin with a JPG, PNG or WebP portrait and approve a voice take for the current section. Click **Generate avatar video** to submit directly. Approved voice takes also have a **Generate avatar video** button, and the timeline offers the same OpenRouter/GX10 choice. The temporary-audio-sharing checkbox is required for OpenRouter. An offline GX10 selection saves the job for later.

OpenRouter requires HTTPS audio references. After you check the temporary-sharing option, MyTwin uses the locally installed `cloudflared` binary to serve only the approved audio through an unguessable Cloudflare HTTPS URL. The server binds to loopback, rejects all other routes and write methods, and closes after a terminal render result or 30 minutes. Keep MyTwin open until the upload/render completes. The portrait is sent inline. MyTwin sends the exact approved audio as a reference; it does not ask the provider to synthesize a new voice. Portraits are limited to 20 MB and audio to 50 MB. The existing OpenRouter key stays in the backend. Avatar jobs use the same durable status polling and local video download as other video jobs; restarting or refreshing does not resubmit a paid job. Mock integration tests check both reference payloads and submission-once behavior. GX10 remains available as a separate provider.

Avatar video settings: OpenRouter / HeyGen Avatar IV offers 16:9 (landscape), 9:16 (portrait), or 1:1 (square), at 720p or 1080p, in both the Production panel and the voice-take/timeline generation dialog. Duration follows the supplied audio. Each new job snapshots and validates these options; historical jobs without options retain the 720p / 16:9 default. GX10 retains 480p and source portrait proportions with a fixed-camera podcast prompt. Its accelerated/baseline choice is stored in each take and passed through both native and web job submission; old saved jobs keep their original preset. Running takes can be cancelled and completed videos download into the app automatically.

## Built-in speech on Apple Silicon

Choose **Options → Voice provider → This Mac · Built-in**. No Voicebox app or
local HTTP service is required. **Settings → Connections → Audio** downloads/verifies
Qwen3 and Kokoro independently. The first download also installs a private,
locked Python 3.11 / MLX runtime. Keep MyTwin open during setup. Network access
is used for package/model downloads; generation uses the downloaded cache with
Hugging Face and Transformers offline mode enabled. No cloud fallback occurs.

- **Qwen3:** Fast clone uses 0.6B Base at 4-bit; Quality clone uses 1.7B Base
  at 8-bit (a larger, separately downloaded model). Add a clean 3–30 second recording and its exact
  transcript in **Edit twin**, then select Qwen3. English, Chinese, Japanese,
  Korean, German, French, Russian, Portuguese, Spanish, and Italian are supported.
  Arabic, Hindi, and Malayalam are not supported by this model.
- **Kokoro:** all 54 presets, with language-aware selection for English (American/British), Japanese, Mandarin Chinese, Spanish, French, Hindi, Italian, and Brazilian Portuguese. Existing installs need one **Verify / repair** to install the multilingual runtime and cache every voice. Japanese uses the pinned bundled UniDic Lite dictionary, so generation needs no dictionary download.
- **Qwen3 CustomVoice:** nine presets with optional delivery instructions, using the separately downloaded 1.7B / 8-bit model.
- **Qwen3 VoiceDesign:** describe a voice and generate short previews. Saving a selected preview retains its exact audio and transcript; subsequent narration uses **Qwen3 Quality clone** to preserve that identity. Download both models for this workflow.
- **My Twin → Create/Edit twin → This Mac · Built-in** includes a voice browser: choose a language/preset or describe a voice, edit the preview text, generate and compare previews, then save your selection. Preview jobs use the local queue, appear in Queue, and never contact a cloud speech provider. Previews are limited to 300 characters; saved designs must be 3–30 seconds. Presets can be saved without a preview. Canceling the editor does not delete generated previews.
- Local takes use the existing preview, approval, timeline, export, and avatar
  workflows. Selecting a cloud avatar provider still sends its required inputs
  to that provider; only local speech inference is offline.
- Each generation runs in a MyTwin-owned process and releases model/GPU memory
  when finished. Jobs are serialized to avoid simultaneous model memory use.
  Prepared/queued jobs can be cancelled through the API; running inference must
  finish or the app can be closed. Interrupted takes are marked failed on restart
  and never automatically regenerated. Local scripts are limited to 12,000
  characters per take and split into bounded chunks internally.

Desktop runtime/models live under `~/Library/Application Support/com.pretheesh.mytwin/local-tts/`;
browser mode uses `data/local-tts/`. The app bundle carries `uv`, the engine
script, catalog, and dependency lock; it does not depend on a project checkout
or a system Python installation after packaging. Build preparation copies the
Mac's installed `uv` into the bundle resources. Run `npm run build:desktop`.
Model revisions and the Python package graph are pinned in `local-tts/`.

Validation: `npm test`, `npm run test:rust`, and
`python3 test/local_tts_test.py`. Real on-device smoke tests produced WAV output
with Kokoro and Qwen3 cloning a synthetic reference; this does not establish
cloning quality for your own recording.

For voice clarity, prefer a clean 5–10 second reference excerpt with an accurate
transcript. Local inference normalizes the reference in memory without changing
the source file. Qwen3 generations that exhaust the per-segment token budget
fail with a retry hint rather than saving a potentially repeating take.

### Local speech delivery

Under This Mac · Built-in, choose speed (0.75–1.50×), extra sentence pause (0–2 seconds), and volume (0–200%). Speed preserves pitch. Pauses add silence between sentences or paragraphs; zero retains natural model pauses. Volume boosts are capped to avoid clipping. Reset delivery restores 1×, natural pauses, and 100%. Controls are saved with each new take and applied to its WAV, including exports and downstream video. Existing takes remain unchanged. After updating an older runtime, use Settings → Connections → Audio → Verify if speed processing is unavailable.

### VoiceStudio connection

Choose **Settings → Connections → Audio → VoiceStudio → Connect** and enter the server address and API key. The same saved address is used for connection checks (`/health`) and speech generation (`/generate`), including local servers and servers hosted elsewhere. Choose **VoiceStudio** under Studio → Options → Voice provider to use it. Keys remain in the backend's private secrets store. Existing installations retain their previous GX10 address; new connections require an address. Each submitted take keeps the connection it started with, so editing the connection affects subsequent submissions. This is separate from the GX10 worker connection.

OmniVoice runs with 32 refinement passes and 16-bit WAV output. A controlled test produced unintelligible output at 64 passes, so the provider fixes the verified setting. OmniVoice is enabled for non-commercial testing under the previously accepted terms. Completed WAV takes use MyTwin's normal playback, approval and export flow. Submitted speech cannot be cancelled; interrupted requests require a new take. Verification: 51 JavaScript tests, 18 Rust tests, desktop connection check, and a live synthetic-reference cloning request.

### Studio timeline editing

The studio has a video monitor and timeline beside a full-height clip inspector. Drag the divider above the timeline to resize the monitor. The video lane stays above Voice and Music; generated scenes follow their voice clip's position and source trim. Choose a preview aspect ratio (16:9, 9:16, 1:1, or 4:3), Fit/Fill, or fullscreen. These settings affect the monitor; they do not transcode existing videos or add a combined video export.

Import local audio with **Music → Import music**, then move it between tracks, trim it, and mix with each track's volume and mute controls. **Export audio** includes imported music and the saved mix. Every voice draft still needs a completed take before exporting. Overlapping clips occupy separate rows within their track.

Drag clip titles to move clips, drag their edges to trim, or enter precise start and source in/out times in the inspector. Snap aligns moves to other clip edges and the playhead. Zoom controls and **Fit** keep the ruler and tracks on the same scale. **B** splits at the playhead; **⌘D** duplicates; **⌘Z / ⇧⌘Z** undo/redo timeline changes. History holds the latest 50 edits for the current app session. Undoing timeline geometry preserves subsequent script and scene-description changes. **Space** plays/pauses, **S** toggles snapping, **F** fits the timeline, and **?** lists shortcuts.

Twins can save a voice provider in **My Twin → Edit twin**. Select **This Mac · Built-in**, then **Kokoro · Preset voice** and a Kokoro or Qwen CustomVoice preset, a saved VoiceDesign preview, or a Qwen3 clone model. Kokoro twins need no voice recording or transcript. The Studio uses the selected twin’s saved provider/model/voice; twins with no saved provider continue using studio defaults. Existing podcast character voice overrides still take precedence.
