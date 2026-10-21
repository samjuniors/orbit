# Versions and releases

ORBIT's CLI/engine release version is defined only by the root `package.json`. The root `package-lock.json` must match it. The legacy desktop app is a separately versioned package: its version lives in `apps/tray/package.json`, and `apps/tray/package-lock.json` must match that package. Do not force the two products to share a version.

## Versioning policy (pre-1.0)

ORBIT is currently pre-1.0 and uses stable `MAJOR.MINOR.PATCH` release numbers:

- While `MAJOR` is `0`, increment **MINOR** for new features or behavior/API changes. Compatibility is not guaranteed between minor releases.
- Increment **PATCH** for backwards-compatible bug fixes, documentation corrections, and packaging fixes.
- Reserve `1.0.0` for the first release whose public behavior and compatibility expectations are treated as stable.
- Release tags use `vX.Y.Z` for the CLI/engine. The legacy desktop app uses the separate `tray-vX.Y.Z` tag namespace.

## Every change

```bash
git switch -c feat/short-name        # never work directly on main
# ...edit, then:
npm run check && npm test            # must pass
git add -A && git commit -m "engine: what changed and why"
git push -u origin feat/short-name   # open a pull request into main
```

Add a line under `## [Unreleased]` in `CHANGELOG.md` as you go.

## Cutting a CLI/engine release (from main, after merging)

1. Update `CHANGELOG.md`: move the Unreleased notes under the next `## [X.Y.Z] - description` heading.
2. On the clean main checkout, run `npm run release:patch` or `npm run release:minor`. This updates the root package metadata, creates the version commit, and creates the matching `vX.Y.Z` Git tag.
3. Run `npm run validate:release`. It verifies the root package and lockfile versions, the tag at HEAD, and the latest released CHANGELOG heading.
4. Push the commit and tag: `git push origin main --tags`.
5. Push the tag. The `CLI and engine release` workflow creates the GitHub Release only after CI, builds, metadata validation, and required-asset preflight succeed; it then uploads the versioned assets, checksums, and provenance manifest.

Do not publish if validation fails. Do not edit the package version manually without regenerating/updating its lockfile. The `CLI and engine release` GitHub Actions workflow runs the engine CI matrix (Ubuntu, Windows, macOS on Node 20 and 22), then builds and tests the Windows x64 release targets. The release job runs only after the matrix succeeds.

## Legacy desktop app

The desktop app has its own version in `apps/tray/package.json`. Build with `npm --prefix apps/tray run dist:win`; its installer filename is derived from that package version. The legacy workflow publishes only on `tray-v*` tags (or manual dispatch). Keep its package lock and `apps/tray/BUILDING.md` in sync.

## First time only: connect this folder to GitHub

```bash
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main --tags
```


## Release asset verification

The automated CLI/engine release workflow is tag-triggered and is gated by the full engine CI matrix. Before creating a GitHub Release, its Windows build job runs release metadata validation, legacy desktop checks/tests, builds all declared Windows assets, and runs the asset preflight. The preflight fails if any required asset is missing, is not a regular file, or is empty.

The publisher uploads these verification files alongside the binaries:

- `SHA256SUMS.txt`: SHA-256 digest for each release binary/installer.
- `release-manifest.json`: schema version, canonical tag, full source commit SHA, build Node/platform metadata, and each asset's filename, byte size, and SHA-256 digest.

After downloading an asset, verify it from the same directory with:

```bash
sha256sum -c SHA256SUMS.txt
```

On Windows PowerShell, compare the output of `Get-FileHash -Algorithm SHA256 .\\<asset-name>` with the matching digest in `SHA256SUMS.txt`. Confirm that `release-manifest.json` names the expected tag and source commit. Current published executable/installer build targets are Windows x64; the engine test matrix also covers Ubuntu and macOS, but this does not imply native release binaries for those platforms.
