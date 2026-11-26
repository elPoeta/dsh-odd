---
name: fix
description: Fix a bug at the root by reproducing it, finding the cause, making the smallest fix and adding a regression test.
---
# Fix: reproduce, root-cause, smallest fix, regression test

1. Read the Goal (the symptom). Reproduce it first, ideally as a failing test. If you cannot reproduce it, say so and ask the human for the missing details; do not guess-fix.
2. Find the root cause, not the nearest symptom. Read the code path; add temporary logging or use a debugger if needed, and remove it afterwards.
3. Record it with `odd_task_note`, section "Root cause" (what was wrong and why it only showed up now).
4. Make the smallest change that removes the cause. No unrelated cleanup.
5. The failing test must now pass and the rest of the suite stay green. Run the commands yourself and record the exact command and result under "Evidence".
6. Record what would have prevented it under "Lessons" (one or two bullets).
7. `odd_task_advance` outcome `done`; `failed` if you cannot get it green; `blocked` if you need access or information you do not have.
