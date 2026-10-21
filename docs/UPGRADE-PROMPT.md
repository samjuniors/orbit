# Prompt: apply the newest ORBIT patch (paste into your coding agent)

Edit the three settings, then give the whole file to your agent.

```
You are upgrading the ORBIT repository by applying patch files from my patch folder.
Follow these steps exactly. If anything is unexpected, STOP and report; do not improvise.

SETTINGS
REPO_DIR: E:\Projects\SamjuniorsProducts\Orbit
PATCH_DIR: <full path to my patch folder>
MERGE_TO_MAIN: no        # "no" = push a branch and open a pull request. "yes" = after tests pass, merge into main, push and tag.

RULES
- Never force-push, rewrite history, delete branches or tags, or edit the patch files.
- Never change source code to make a failing check pass. If a check fails, stop and report.
- Work only in REPO_DIR. Extract zips to a temp folder outside the repo. Never commit anything from PATCH_DIR
  (if PATCH_DIR is inside REPO_DIR, add its relative path to .git/info/exclude first).

STEPS
1. cd REPO_DIR. `git status` must show a clean tree on branch main (untracked files are fine). Otherwise stop.
   If a remote exists, run `git pull --ff-only`.
2. Read "version" from package.json. Call it CURRENT.
3. List PATCH_DIR. Patches are zips or folders named like orbit-patch-vA-to-vB or orbit-patches-vA-to-vB
   (A and B are versions; use the versions in the NAME, never file dates). Extract each zip to a temp folder.
   Each contains numbered *.patch files and an APPLY.txt.
4. Build the chain: pick the patch whose A equals CURRENT; after it, CURRENT becomes B; repeat until no patch has
   A equal to CURRENT. Never skip a version or apply out of order. If no patch starts at CURRENT, report
   "nothing to apply (current X, patches found: ...)" and stop. Call the last B in the chain FINAL.
5. Create one branch from main: `git switch -c upgrade/vFINAL`.
6. For each patch in the chain, in order: `git am --3way` with its *.patch files in numeric order.
   - If it stops on a conflict: run `git am --abort`, switch back to main, leave the branch alone, report the
     conflicted files and the full git output, and stop.
   - After each patch run `npm run check` and `npm test`. Compare the pass count with the "expect" line in that
     patch's APPLY.txt. Any failure or mismatch: stop and report the output.
7. Confirm package.json "version" equals FINAL.
8. `git push -u origin upgrade/vFINAL`.
   - If MERGE_TO_MAIN is no: if the GitHub CLI `gh` is available, open a PR into main titled
     "Upgrade ORBIT to vFINAL" with the matching CHANGELOG section as the body; otherwise print the compare URL.
     Do NOT tag. Tell me to run, after I merge:
       git switch main && git pull && git tag -a vFINAL -m "vFINAL" && git push origin vFINAL
   - If MERGE_TO_MAIN is yes: `git switch main && git merge --ff-only upgrade/vFINAL && git push origin main`.
     Then for every version in the chain whose tag does not exist yet, tag the commit whose message starts with
     that version (example: `git log --grep="^v0.5.0:" --format=%H -n 1`) as an annotated tag, and push the tags.
     Tag FINAL at HEAD.
9. Append one line per applied patch (name, date) to PATCH_DIR\applied.txt.
10. Final report: versions applied, branch, test counts, PR link or tag status, and anything odd you noticed.
```
