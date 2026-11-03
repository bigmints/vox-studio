# MyTwin worker contract — v1

This is the MyTwin integration contract. The GX10 InfiniteTalk adapter is implemented in `worker/infinitetalk_worker.py` and runs at `http://100.77.38.96:8420` on the private Tailscale network. It supports portrait + audio avatar generation, up to 30 seconds per take. Voice generation remains separate.

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


## Installed InfiniteTalk worker

The dashboard InfiniteTalk switch also controls `mytwin-worker.service`. The API uses a private bearer token stored in MyTwin's existing secrets store and `~/apps/InfiniteTalk/mytwin-token` on GX10. Do not commit or log the token.

The adapter validates image/audio contents, stores uploads and idempotency keys in SQLite, serializes jobs, and uses `gx10_launch.py` for every render. It shares the standalone UI's GPU lock and retains the existing 90 GiB startup requirement, 12 GiB emergency threshold, 104 GiB service ceiling, and zero swap allowance. Short audio gets silence padding only to complete the model's frame window; narration is never synthesized from the text field.

Stopping InfiniteTalk cancels the process group. Interrupted running jobs become failed on restart; queued jobs remain queued and completed MP4s remain downloadable. A cancelled or failed take needs a new local job ID to rerun; repeating the old ID returns the original result.

Production inference uses 40 steps. Generation is slow on this memory-conservative preset. The integration verification uses a separate short two-step sample; it is not a quality benchmark.

Worker tests: run `.venv/bin/python -m unittest test_infinitetalk_worker` from the GX10 installation. Repository source is in `worker/`; deploy both the adapter and service file there before restarting the worker.

### Verification

A real two-step sample was submitted using MyTwin's `createOrchestrator`, rendered on the GX10, and downloaded as an MP4 into local MyTwin-format media storage. The completed job and identical artifact bytes remained available after a dashboard stop/start. The worker peaked at approximately 36 GiB for that short sample. Seven adapter tests cover authentication, validation, idempotency, recovery, cancellation, and audio-frame padding. Full-length 30-second quality renders have not been benchmarked.
