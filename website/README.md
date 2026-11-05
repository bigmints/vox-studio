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

The canonical site is https://fikr.one/vox/. GitHub Pages remains an interim mirror.

The main domain uses Firebase Hosting in front of the existing Fikr application. The deployment helper reads the current live file manifest and configuration, replaces only `/vox/`, preserves unrelated files and backend routing, and refuses to release if another deployment intervenes.

Once the configured `fikr-deploy` account has Hosting access, discover and verify the Hosting site ID for `fikr.one`, then run:

```sh
python3 website/scripts/deploy-fikr-hosting.py --site VERIFIED_SITE_ID
python3 website/scripts/deploy-fikr-hosting.py --site VERIFIED_SITE_ID --publish
```

The first command is read-only. No Hosting deployment has been completed: the configured deployment identity currently receives `403 PERMISSION_DENIED` from Firebase Hosting. The helper has syntax validation but remains unverified against the live Hosting API until that access is granted.
