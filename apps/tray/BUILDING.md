# Windows build and release

The GitHub Actions workflow at `.github/workflows/build-windows.yml` builds the legacy desktop app in `apps/tray`.

The desktop app has its own version in `apps/tray/package.json`; keep `apps/tray/package-lock.json` synchronized with it. It is independent of the CLI/engine version in the root `package.json`.

The workflow runs on pushes to tags matching `tray-v*` and by manual dispatch. Each run:

1. Installs Node.js 24 on a Windows runner.
2. Installs desktop app dependencies.
3. Runs JavaScript syntax checks and desktop app tests.
4. Builds the x64 NSIS installer with electron-builder.
5. Uploads the installer as the `ORBIT-Tray-Windows-x64` workflow artifact.
6. On a `tray-v*` tag, creates a GitHub Release and attaches the installer.

Use the `tray-vX.Y.Z` tag namespace for desktop app releases. Do not use the CLI/engine `vX.Y.Z` tag for this workflow.

Do not distribute an installer until the Windows workflow is green and the artifact has been inspected. The initial preview is unsigned; Windows SmartScreen may show a warning.
