# MyTwin website

Static marketing site and documentation for GitHub Pages. No build or runtime dependencies.

## Preview

From this directory, run `python3 -m http.server 4321 --directory dist` and open http://localhost:4321.

## Deploy

`.github/workflows/pages.yml` publishes `website/dist` on pushes to `main` that change the website, or via manual dispatch. Repository Pages settings must use GitHub Actions as the source.

Production URL: https://bigmints.github.io/vox-studio/

Relative asset and navigation paths support the repository subpath. The interactive studio preview mirrors the app’s podcast dialogue, inspector, and timeline layout. `dist/assets/preview.js` implements editable turns, speaker assignment, reordering, duplication, deletion, track mute/volume, timing, seeking, and browser speech playback. Demo timing is estimated; browser voices do not represent the desktop voice engines. No API key or backend is used. `dist/assets/site.js` provides mobile navigation and documentation copy buttons.

## Packaged releases

No packaged release existed when this site was created. Download CTAs currently lead to a source download and build instructions. Once a signed installer is published, replace the download section and relevant docs/FAQ text with its verified GitHub release asset URL and system requirements.
