# Writing tasks that finish

In `PLAN.md` a task is a checkbox line plus indented detail. The same structure works as a Linear/GitHub issue body. Keep each task small enough to verify in one sitting; if you can't write a believable "Definition of done", it is two tasks.

Keep one gate small enough to verify in a single sitting. If you can't write a believable "Definition of done" for it in a few bullets, it's probably two gates.

```
## Context
<1-3 sentences: what this gate is part of, and what the previous gate left in place.>

## Build
<What to actually implement in this gate. Be concrete about files/areas if you know them.
If this is a fix-forward gate (resuming prior work), say so explicitly and summarize what's
already done -- don't describe it as if starting fresh.>

## Definition of done
- <specific, checkable outcome>
- <specific, checkable outcome>
- Verification command passes: <the exact command ORBIT's "Verification command" setting runs>

## Out of scope for this gate
<Explicitly list anything adjacent that should NOT be touched -- this is what keeps the agent
from quietly expanding the gate.>

## Notes / links
<Prior ADR, design doc, or related issue links, if any.>
```

## Rules this template exists to enforce
- One task per checkbox; append new ideas as new tasks instead of rewriting finished ones.
- "Definition of done" must be checkable by the verification command where possible, not just by reading the agent's own summary.
- New ideas while a gate is running go in a separate note/ADR, not into this issue mid-flight.
