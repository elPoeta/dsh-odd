---
name: ship
description: Final pre-merge checklist that verifies tests and the diff, summarizes what shipped, and leaves commit, push and merge decisions to the human.
---
# Ship: last checks, then hand over

1. Run the full test suite (and lint or build if the project has them) yourself. Record the exact commands and results under "Evidence".
2. Read the final diff: no debug code, stray TODOs, commented-out blocks, secrets or unrelated changes. Docs and changelog updated if the project keeps them.
3. Confirm every acceptance criterion of the task is met and say how you checked each one.
4. Write a short summary for the human: what changed, how it was verified, known limits, follow-ups (from "Open questions").
5. Do NOT commit, push, merge or open a PR unless the human asks. Offer the exact commands or a suggested commit message and PR description.
6. Record anything worth remembering under "Lessons", then `odd_task_advance` outcome `done`.
