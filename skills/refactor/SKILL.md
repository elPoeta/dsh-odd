---
name: refactor
description: Improves the structure of existing code without changing its behavior. Pins current behavior with characterization tests, then changes structure in small steps with the suite green after each one. Never mixes in new functionality and never commits.
---

# Refactor

You are the driver: you write the code. I am the navigator: I review, decide and tell you yes or no. **Behavior must not change.**

Version: 2.0 (ODD). Reads: Goal, Test list, Decisions, Answers, Evidence, Reviews. Writes: Test list, Implementation plan, Decisions, Evidence, Open questions, Lessons. Hands off to `code-review`, then `ship`.

## Language

- Talk to me in the language I use.
- **All code is in English:** identifiers, comments, test names, commit messages. Only user-facing strings follow the product's own language.
- Keep the micro message labels as they are.

## 0. Setup

Load the `tdd` skill and the `testing` skill (`odd_skill_load`). `tdd` defines the setup (test command, git state, baseline), the stop rules and the test rules. **Back from a review?** Read the findings in Evidence and under "Reviews" and address them first.

## 1. Understand

- Read the Goal: which structural problem we are solving, and what must not change. Ask for what is missing, one question at a time with your suggested answer.
- Fix the scope with me: which files or modules, and what is explicitly out. Public APIs stay as they are unless the Goal says otherwise.
- Do the `tdd` setup, including the baseline.

## 2. Safety net

- Check which tests cover the code you will touch. Where behavior is not pinned, propose **characterization tests**: names only first, for my approval, recorded in "Test list" (mode `replace`). They assert today's observable behavior, even if it looks odd, and they pass on the current code: green from the start is the point.
- A characterization test that exposes a bug: note it under "Open questions" and leave it alone. This is not the moment to fix it.
- No safety net is possible (visual code, no seams)? Say so, propose smaller steps with manual checks, and let me decide whether to continue.

## 3. Steps

- Plan the refactor as a list of small, behavior-preserving steps (rename, extract, move, inline, remove duplication), one structural change per step. Show it, wait for my approval, and record it under "Implementation plan" (mode `replace`).
- For each step: make the change, run the tests, show them green, tick what applies, and send a micro message:

```
✅ Step done: <what moved or changed, one line> (<files>)
Suite: <n passing, n failing vs baseline>
Done: <n>/<total steps>. Next: <next step>
Change anything or continue?
```

- Red after a step: **revert that step** instead of debugging forward, and tell me.
- Stop rules are the ones in `tdd`, plus: any change in observable behavior, any change to a public API, and any characterization test that would have to change (that means behavior changed).

## 4. Check

- Run the full suite and compare with the baseline: the results must be the same. Record the command and the result in Evidence.
- Record what moved where under "Decisions", and what you learned under "Lessons".
- No new functionality, no drive-by fixes. Bugs and ideas you found go under "Open questions".

## 5. Close

**Never commit.** Suggest the commit messages (English), structure-only, and I make the commits.

Call `odd_task_advance`: `done` when the suite equals the baseline and every step is complete; `failed` with the last error after honest attempts; `blocked` if you need something you cannot get.
