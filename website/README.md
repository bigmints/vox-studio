# Fikr Vox website

Static marketing site and documentation for GitHub Pages. No build or runtime dependencies.

## Preview

From this directory, run `python3 -m http.server 4321 --directory dist` and open http://localhost:4321.

## Deploy

`.github/workflows/pages.yml` publishes `website/dist` on pushes to `main` that change the website, or via manual dispatch. Repository Pages settings must use GitHub Actions as the source.

Production URL: https://fikr.one/vox/

Relative asset and navigation paths support the repository subpath. The interactive studio preview mirrors the app’s podcast dialogue, inspector, and timeline layout. `dist/assets/preview.js` implements editable turns, speaker assignment, reordering, duplication, deletion, track mute/volume, timing, seeking, and prepared Kokoro neural voice playback. Demo audio is rendered with the app’s installed Kokoro engine (George and Heart). Both lines are available in both voices. Edited text needs a new take in the desktop app; no browser speech fallback is used. No API key or backend is used. `dist/assets/site.js` provides mobile navigation and documentation copy buttons.

## Packaged releases

No packaged release existed when this site was created. Download CTAs currently lead to a source download and build instructions. Once a signed installer is published, replace the download section and relevant docs/FAQ text with its verified GitHub release asset URL and system requirements.

## fikr.one/vox hosting

The canonical site is https://fikr.one/vox/. GitHub Pages remains a mirror.

DNS and live configuration confirm that fikr.one points directly to Cloud Run service `ssrfikrapps` in project `fikr-apps`, region `us-central1`. The Firebase Hosting site has no custom domains, so publishing there does not update fikr.one.

`cloudrun/vox-entry.cjs` serves only `/vox` and `/vox/**`. All other HTTP requests and WebSocket upgrades are forwarded to the existing Next.js application, with request methods, bodies, cookies, and authorization headers preserved. Audio supports byte ranges for seeking. The existing app runs on internal port 8081; the route layer listens on the Cloud Run ingress port.

The deployment image derives from the exact immutable image already deployed, without rebuilding the main application or including unrelated local source changes. `cloudrun/Dockerfile` is built from the `website` context with a verified `FIKR_BASE_IMAGE` build argument. Use the configured `fikr-deploy` identity for builds and releases.

Verification:

```sh
node --test website/cloudrun/vox-entry.test.cjs
```

Deploy a no-traffic revision first, verify `/vox/`, `/vox/docs/`, audio byte ranges, and the existing homepage/API behavior, then move traffic to the verified revision. Keep the previous revision available for rollback.

The earlier `scripts/deploy-fikr-hosting.py` helper is retained for Firebase-hosted domains. It checks the domain association before changing a release and refuses to deploy this domain because it is not bound to Firebase Hosting.

The verified live deployment is recorded in `cloudrun/deployment.json`. Rollback, if needed:

```sh
gcloud --configuration=fikr-deploy run services update-traffic ssrfikrapps --project=fikr-apps --region=us-central1 --to-revisions=ssrfikrapps-00075-hzl=100
```
