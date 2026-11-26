---
name: refactor
description: Improve structure without changing behavior, protected by tests and done in small verified steps.
---
# Refactor: same behavior, better structure

1. Read the Goal: which structural problem we are solving and what must not change.
2. Safety net first. Check that tests cover the behavior you will touch; if not, write characterization tests that pin the current behavior before changing anything. Run them green and record the command under "Evidence".
3. Change in small steps. Run the tests after each step; if red, revert that step instead of debugging forward.
4. No behavior change, no new features, no drive-by fixes. If you find a bug, note it under "Open questions" and leave it.
5. Keep public APIs stable unless the Goal says otherwise; if they must change, ask the human first.
6. Finish with the full suite green (record the exact command and result) and a short note of what moved where under "Decisions".
7. Record what you learned under "Lessons", then `odd_task_advance` outcome `done` (or `failed` / `blocked` with the reason).
