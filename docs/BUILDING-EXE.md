# Building a single-file executable

`npm run build:exe` produces `dist\orbit.exe` (Windows) or `dist/orbit` (macOS/Linux): the ORBIT CLI plus the Node runtime in one file, so people can use it without installing Node. Git and your coding agent are still needed.

## Requirements
- Node 20.12 or newer (22 LTS recommended). The exe embeds the Node version you build with.
- Internet once, for the inject step (`npx postject`).

## How it works
1. `scripts/bundle.js` joins `bin/orbit.js` and its modules into one CommonJS file (`dist/orbit.cjs`). No third-party bundler.
2. Node's `--experimental-sea-config` turns that file (plus the skill text as an asset) into a blob.
3. The blob is injected into a copy of the Node binary with `postject`.
4. The script smoke-tests the result: it must report the right version and enforce the git guard.

Inside the exe the command guard re-launches the exe itself (`orbit.exe __guard git ...`), so no source files are needed on the machine.

## Using it
Put `orbit.exe` in a folder on your PATH (for example `C:\Tools`), open a new terminal, and type `orbit setup`.

## Caveats (be aware)
- **Unsigned.** Windows SmartScreen may show "unrecognized app" and some antivirus tools flag any self-extracting Node exe. Code-signing needs a certificate; not included.
- **~80-100 MB** (it contains Node).
- **Unverified on real machines.** The bundle, the SEA blob and the guard are tested in CI-like conditions; the inject step and the final exe have not yet been run on Windows by the author. If the build fails, send the full output.
- Rebuild for every release; the exe does not auto-update.
