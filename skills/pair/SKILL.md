---
name: pair
description: Implement the stories one at a time with the human, test first, running the tests yourself and recording evidence. Also used to address code-review findings.
---
# Pair: implement, verify, iterate

1. Read the task: Stories, Decisions and Evidence. If you are back here after a review, the findings are in Evidence ("code-review finding"): fix those first, before any new work.
2. Work one story at a time, in order. Restate its acceptance criteria in one sentence.
3. Red: write a failing test for the first criterion and watch it fail for the right reason. Green: the smallest change that passes. Refactor with tests green. Repeat per criterion.
4. Follow the project's conventions: look at neighboring code, AGENTS.md and existing tests. Do not add libraries or new patterns without asking.
5. Run the project's test command yourself. Record the exact command and the real result with `odd_task_note`, section "Evidence". Never write "tests pass" without running them.
6. Ask the human in the conversation when a decision is theirs (naming, trade-offs, scope) and record it under "Decisions".
7. After each story, add a line to "Evidence" ("S1 done: what changed, which tests"). Do not commit or push unless the human asks.
8. When every story is done and the full suite is green, call `odd_task_advance` with outcome `done`. If you cannot get to green after honest attempts, outcome `failed` with the last error; if you need something you cannot get, `blocked`.

Do not expand scope. Anything extra you notice goes under "Open questions", not into the code.
