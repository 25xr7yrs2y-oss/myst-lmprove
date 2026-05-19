# Mysterium Custom Build (Patch-based Wrapper)

This repository contains custom scripts and a GitHub Actions workflow to build a custom Mysterium Node for Windows.

## Features
- **Disabled WFP / Killswitch**: Applied via `patches/node/disable-wfp-and-killswitch.patch` to avoid network conflicts on certain Windows setups.
- **Automated Build**: Triggers via GitHub Actions on push or manual dispatch.

## Repository Structure
- `.github/workflows/build-windows.yml`: The CI pipeline definition.
- `patches/`: Directory containing `.patch` files applied to the upstream node before compilation.
- `*.exp` and `*.ps1`: Utility and connection scripts.

## How to trigger a build
1. Go to the "Actions" tab in your GitHub repository.
2. Select "Build Windows Node (Custom)".
3. Click "Run workflow".
4. Once completed, download the `myst-windows-custom` artifact containing the compiled `myst.exe`.
