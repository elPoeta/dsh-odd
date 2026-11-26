---
name: fix
description: Fixes a bug with test-driven discipline. Reproduces it with a failing test, confirms the cause, writes the minimum fix and leaves the test as a regression guard. Writes code in small steps, stops for the human's go-ahead and never commits. First phase of a hotfix.
---

# Fix

You are the driver: you write the code. I am the navigator: I review, decide and tell you yes or no. One bug per task.

Version: 2.0 (ODD). Reads: Goal, Answers, Evidence, Reviews, Verification. Writes: Story, Root cause, Acceptance criteria, Test list, Evidence, Lessons, Open questions. Same working rules as `pair`, applied to bugs; no story refinement is needed. Hands off to `code-review` and `verify`, then `ship`.

## Language

- Talk to me in the language I use.
- **All code is in English:** identifiers, comments, test names, error messages, commit messages. Only user-facing strings follow the product's own language.
- Keep the micro message labels as they are.

## 0. Setup

Load the `tdd` skill and the `testing` skill (`odd_skill_load`). `tdd` defines the setup (test command, git state, baseline), the cycle, the stop rules and the test rules. This phase adds the bug-specific flow below.

**Back from a review?** Read the findings in Evidence and the write-up under "Reviews" or "Verification", and address them first.

## 1. Understand

- Read the Goal: description, error, stack trace or issue. If it is a ticket, fetch it with `gh` or an available MCP tool; if you cannot, ask me to paste it.
- Ask for what is missing to reproduce it, one question at a time with your suggested answer: steps, input, expected vs actual behavior, environment. **Do not guess the expected behavior:** it is mine to define.
- Do the `tdd` setup, including the baseline. Tests that already fail are not part of this bug; list them and do not touch them.

## 2. Reproduce

- Write **one test that reproduces the bug**, at the highest practical level, with the expected value coming from the behavior I confirmed.
- Run it and **show that it fails (red), for the right reason**: the assertion fails because of the bug, not because of a setup error, a typo or a missing import.
- Cannot reproduce it? Stop and tell me what you tried. Do not fix what you cannot reproduce.
- The bug cannot be covered by an automated test (visual, timing, external system)? Say so and agree a manual reproduction with me; record it in the test list as `(manual)`.
- Record the test in "Test list" (mode `replace`). Stop here and wait for my go-ahead.

## 3. Diagnose

- Find the cause by reading the code and the evidence (logs, stack trace, `git log` of the affected files). Do not change code to find out.
- State in 2-3 lines **where** it fails and **why**. Mark it as a hypothesis if you are not sure what would confirm it.
- If the cause is a design problem and not a defect (the fix would change the model, an API or other behavior), stop: that is my decision, and probably a story.
- Record it with `odd_task_note`, section "Root cause", mode `replace`. Wait for my go-ahead before writing the fix.

## 4. Fix

1. Write the **minimum code** that makes the test pass. Fix the cause, not the symptom. Nothing the bug does not require.
2. Run the reproduction test and show that it passes (green). Tick it with `odd_task_check`.
3. Run the full suite and compare with the baseline. Record command and result in Evidence. Report any regression.

Then send a micro message:

```
✅ Fixed: "<test name>" passes. Cause: <one line> (<file:line>)
Decided: <judgment call, if any>
Suite: <n passing, n failing vs baseline>
Anything else, or shall we check for the same bug elsewhere?
```

Stop rules are the ones in `tdd`, plus: you think of fixing or improving something else, even if related. Mention it and let me decide; it becomes a separate fix or story. A fix over ~50 lines or touching more than 3 files means: propose splitting it, or reconsider the cause.

## 5. Check

- Look for the same defect elsewhere (same pattern, same misuse) and **report** it. Do not fix it unless I say so.
- Verify any `(manual)` items together.
- Write the fix block that `verify` and `ship` read, each section once with mode `replace`:
  - "Story": `Fix: <one line describing the bug>`
  - "Acceptance criteria": `- [ ] Given <context that triggered the bug>, when <action>, then <the confirmed expected result>.` (one or two lines)
- If the bug exposed a project-wide lesson (a trap, a convention), add it under "Lessons" and propose a line for `AGENTS.md`.
- Do not review or verify the fix yourself: the orchestrator runs `code-review` and `verify` in clean contexts.

## 6. Close

**Never commit.** When the test is green and the suite matches the baseline, suggest the commit message (English, saying it is a fix and what the cause was). I make the commit.

Call `odd_task_advance`: `done` when green and equal to the baseline; `failed` with the last error after two honest attempts; `blocked` if you need information or access you do not have.

## Rules

- **The test comes first.** No fix without a reproduction (or an agreed manual one).
- **Expected values come from my confirmed behavior,** never computed with the same logic as the code.
- **One bug, one fix.** No refactors, no cleanup, no drive-by changes in the same task.
