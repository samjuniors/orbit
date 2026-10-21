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

## Traditional Windows Setup Wizard (`Orbit-Setup.exe`)
For an installable traditional Windows setup (with GUI wizard, Next -> Next -> Finish, automatic PATH registration, Start Menu shortcuts, and uninstaller in Windows Apps & Features):

Run:
```powershell
npm run build:installer
```
This produces:
- `dist\Orbit-Setup-<version>.exe` (and `dist\Orbit-Setup.exe`)
- Highly compressed with LZMA2 (~24 MB instead of 90 MB)
- Double-clicking opens the traditional Windows installer wizard
- Installs to `%LOCALAPPDATA%\Programs\Orbit` without requiring UAC administrator elevation (or system-wide if run as administrator)
- Registers `orbit` in the user's `PATH` environment variable so it works in any terminal
- Adds Start Menu shortcuts and a registered uninstaller in Windows Settings > Apps

## In-App Updates (`orbit update`)
ORBIT includes built-in update detection and self-updating:

- **Check for updates:**
  ```powershell
  orbit update --check
  ```
- **Fetch and install update:**
  ```powershell
  orbit update
  ```
  - When running as the packaged Windows `.exe`, it fetches the new release asset and atomically replaces the executable in place.
  - When running from a git checkout, it fetches tags and updates the repository.
- **Passive notifications:**
  When running regular commands like `orbit`, `orbit doctor`, or `orbit status`, ORBIT checks GitHub periodically in the background (cached for 6 hours) and prints a reminder whenever a new version is available:
  ```
  * Update available: v0.7.0 -> v0.8.0. Run 'orbit update' to upgrade.
  ```

## Caveats (be aware)
- **Unsigned.** Windows SmartScreen may show "unrecognized app" and some antivirus tools flag any self-extracting Node exe. Code-signing needs a certificate; not included.
- **Node runtime.** The standalone `orbit.exe` is ~90 MB because it bundles the Node engine; the installer `Orbit-Setup.exe` compresses it down to ~24 MB.
- **Rebuilding.** You can update at any time with `orbit update` or by running `npm run build:installer`.
