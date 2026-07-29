# Checker

A Chromium extension for tracking focused work time on Google Sheets. It keeps named task groups, interval history, copy/export actions, and a draggable floating timer panel.

## Install for local development

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Choose **Load unpacked** and select this folder.

## Download

Download the latest `checker-v*.zip` from the [GitHub Releases](https://github.com/cg202601/Checker/releases) page. Unzip it, then use **Load unpacked** in `chrome://extensions` and select the extracted folder.

## Verify software origin

Release archives are built and uploaded only by GitHub Actions from version tags. After downloading an archive, verify its provenance with GitHub CLI:

```bash
gh attestation verify checker-vX.Y.Z.zip --repo cg202601/Checker
```

## Release process

The release workflow runs only when a `v*` Git tag is pushed. It validates that the tag matches `manifest.json`, checks the extension sources, packages an unpacked extension zip, creates a GitHub attestation, and publishes the GitHub Release.