# Windows build and release

The GitHub Actions workflow at `.github/workflows/build-windows.yml` runs on pushes to `main`, on version tags, and by manual dispatch.

Each run performs:
1. Install Node.js 24 on a Windows runner.
2. Install project dependencies.
3. Run JavaScript syntax checks.
4. Run the adapter unit tests.
5. Build the x64 NSIS installer with electron-builder.
6. Upload the installer as the `ORBIT-Worker-Windows-x64` workflow artifact.

Pushing a version tag such as `v0.1.0` also creates a GitHub Release and attaches the installer executable.

Do not distribute an installer until the Windows workflow is green and the artifact has been inspected. The initial preview is unsigned; Windows SmartScreen may show a warning.