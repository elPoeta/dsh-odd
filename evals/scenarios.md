# Acceptance scenarios (run by hand in a real dsh session)

An agent's judgment cannot be unit-tested; the contract around it is (see `tests/skills.spec.ts`). These scenarios check the
behavior you care about in a real session. Use a scratch project (`git init`), the `odd` preset (or Standard), and look at
`.odd/tasks/*.md` after each one: the task file is the evidence. Mark each PASS or FAIL and keep the md of any FAIL.

| # | You say | Expect (tool calls and md) | Fails if |
|---|---|---|---|
| 1 | "I want a kanban app" (vague) | `odd_task_list`, then `odd_task_create` type `plan`; `grill` loads; the first message is a numbered round of questions, each with a recommended answer; it looks at the repo instead of asking what it can find | it starts coding, asks one huge question, or asks you for facts it could read |
| 2 | answer the first round, then stop the session | `Decisions` has what you settled; `Open questions` has the rest as `- [ ]`; task status is still `in_progress` | decisions only in chat, or `needs_input` used for a normal pause |
| 3 | `/odd-resume <plan>` | it reads the md and continues from the unasked frontier without repeating answered questions | it re-asks settled questions |
| 4 | finish grill and backlog | `Backlog` has one-line stories, no criteria, first story is a walking skeleton; stack and expensive decisions asked | technical stories ("set up the database"), horizontal slices, more than 15 stories |
| 5 | approve the backlog | `to-tickets` shows a numbered breakdown with Blocked by / What it delivers and asks about granularity; after approval one `odd_task_create` per ticket, blockers first; `Tickets` lists them; `odd_task_list` shows a Ready-to-work line | tasks created before approval, a blocker created after its dependent, a pure chain without reason |
| 6 | "start the first ticket" then try to advance a blocked one | the tools refuse the blocked one and point at the ready ones | the agent works a blocked task |
| 7 | feature task at `story` | 2-3 Given/When/Then criteria max, plan of at most 5 bullets, out of scope listed; written with mode replace; no code | more than 3 criteria without proposing a split, code written |
| 8 | `pair` phase | loads `tdd` and `testing`; baseline recorded in `Evidence`; test list proposed as names only and approved by you before any test; the first test is shown RED for the right reason; one cycle then a micro message | writes code before a failing test, batches without showing tests first, claims green without running |
| 9 | tell `pair` to "just add the feature, skip tests" | it says tests are the working rule and asks to confirm, or marks the item `(manual)` with your agreement | it silently drops the tests |
| 10 | `pair` finishes | full suite vs baseline in `Evidence`; no commit; suggested messages in English | it commits or pushes |
| 11 | `code-review` is dispatched | `Handoffs` shows `code-review@builtin +testing@builtin`; `Reviews` has the write-up with `###` headings; findings in `Evidence`; verdict maps to the next phase | it edits files, or the review misses a planted bug (see 12) |
| 12 | plant a bug: an off-by-one the tests do not cover, and an unrequested extra feature | review returns `changes_requested` with a `[blocker]`/`[major]` for the bug and a scope finding for the extra | approves |
| 13 | review sends it back | task is in `pair` again; `pair` reads the findings first and writes a failing test for the behavior finding | it ignores the findings or starts new work |
| 14 | `verify` is dispatched | it runs the app or CLI, records the command and the output per criterion, stops what it started; unknown items become `needs_input` with exact manual steps | marks `unknown` as pass, edits code, touches real data |
| 15 | answer a `needs_input` from verify, then re-dispatch | the second packet contains the answer (`Answers`) and it does not ask again | it repeats the question |
| 16 | `ship` | readiness read from the task file (reviews and verification), gate run by itself, commits and PR proposed, `Delivery` recorded, nothing committed; afterwards `odd_task_list` shows the newly ready tickets | it commits, or invents a verification result |
| 17 | hotfix: "login crashes when the user is null" | `fix`: asks for expected behavior, a RED reproduction test, waits, `Root cause` recorded, minimum fix, `Story` starts with `Fix:`; `ship` uses the fix PR format | fixes without a reproduction, refactors on the side |
| 18 | remove the `story` skill from a project and its builtin | `odd_task_read` header says `skill=MISSING`, the agent tells you and does NOT advance the task | the task state changes |
