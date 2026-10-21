# Prompt: build and test the Windows exe (paste into your coding agent)

Run this after the repo is at v0.7.0 or newer (the build script arrives in 0.7.0).

```
Build and test the ORBIT single-file executable. Do not change any source file. If something fails, stop and report
the full error; do not work around it by editing scripts.

SETTINGS
REPO_DIR: E:\Projects\SamjuniorsProducts\Orbit

STEPS
1. cd REPO_DIR. Run `node -v`: it must be 20.12 or newer (22 LTS recommended), otherwise stop and tell me.
   Run `git status` and tell me if the tree is dirty (do not change it).
2. `npm run check` then `npm test`. Both must pass. Report the pass count.
3. `npm run build:exe`. It needs internet once (it downloads the postject tool). On success it prints
   "Built ...dist\orbit.exe". On failure paste the whole output and stop.
4. Test the exe from a DIFFERENT folder (not the repo):
   a. `<REPO_DIR>\dist\orbit.exe --version` must print the same version as package.json.
   b. Make a temp folder, `git init -b main` in it, then run `orbit.exe` with no arguments: it should say there is
      no plan and suggest `orbit setup`.
   c. `orbit.exe adapters` lists the agents and shows which are installed.
   d. `orbit.exe install-skill --dir <that temp folder>` must create .claude\skills\orbit\SKILL.md
      (this proves the embedded skill file works inside the exe).
   e. `orbit.exe doctor --dir <that temp folder>` runs without crashing.
5. Report: exe path and size, the result of each check above, and whether Windows SmartScreen or antivirus
   warned or blocked anything. Do not commit dist\ (it is git-ignored).
```
