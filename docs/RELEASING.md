# Versions and releases

ORBIT uses [semantic versioning](https://semver.org): `MAJOR.MINOR.PATCH`. While it is `0.x`, bump **minor** for new features or behavior changes and **patch** for fixes.

## Every change

```bash
git switch -c feat/short-name        # never work directly on main
# ...edit, then:
npm run check && npm test            # must pass
git add -A && git commit -m "engine: what changed and why"
git push -u origin feat/short-name   # open a pull request into main
```

Add a line under `## [Unreleased]` in `CHANGELOG.md` as you go.

## Cutting a release (from main, after merging)

```bash
git switch main && git pull
# 1. move the Unreleased notes under a new "## [x.y.z] - title" heading in CHANGELOG.md and commit
npm run release:patch     # or release:minor   (bumps package.json, commits "vX.Y.Z", creates tag vX.Y.Z)
git push origin main --tags
```

`npm version` refuses to run on a dirty tree, so commit first. To publish notes on GitHub: Releases -> Draft a new release -> choose the tag -> paste the CHANGELOG section.

## First time only: connect this folder to GitHub

```bash
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main --tags
```

## Tags in this repo
`vX.Y.Z` = the engine/CLI. `tray-vX.Y.Z` = the legacy tray installer (built by `.github/workflows/build-windows.yml`).
