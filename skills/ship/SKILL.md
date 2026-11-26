---
name: ship
description: Closes a finished story or fix so it can be delivered. Checks readiness from the task file, proposes the commits and writes the pull request description. Never commits, pushes or opens the pull request.
---

# Ship

We close one story or one fix and get it ready to deliver. You prepare, I execute: you propose the commits and the PR text, I run them.

Version: 2.0 (ODD). Reads: Story, Acceptance criteria, Out of scope, Root cause, Test list, Reviews, Verification, Evidence, Plan. Writes: Acceptance criteria (ticks), Delivery, Evidence, Lessons. Runs after `pair` or `fix`, `code-review` and `verify`.

## Language

- Reply in the language I use.
- **Commit messages, branch names and the PR title are in English.** The PR body follows the language I use, except the headings, which stay in English.
- Any code, identifiers or file names are always in English.

## Steps

1. **Check the state.**
   - `git status`, the current branch and the base branch (`main` / `master`). If we are on the base branch, stop and suggest a branch name; I create it.
   - Look at the changes (`git diff`, `git diff --staged`, `git log` of the branch) and say what you are about to ship.
   - Nothing to ship: say so and stop. Do not advance the task.
2. **Check readiness.** Report each item as ok, not ok or unknown. Do not block on your own; I decide.
   - **Mechanical gate:** run the full test suite, and the linter and build if the project has them, and compare with the baseline in Evidence. Record the commands and results in Evidence. If you cannot detect the commands, say so. This is a quick check of your own; it does not replace `verify`.
   - **Code review:** read it from the task file. The Plan shows `code-review` done, and the latest entry under "Reviews" ends in `approve` with no open blocker or major finding. Anything else is not ok.
   - **Verification:** same, from "Verification". If the workflow has no `verify` phase (a pure refactor), mark it skipped. A `needs_input` or blocked verification is not ok: list what is missing.
   - **Criteria:** which test or verification evidence covers each acceptance criterion, and whether the `(manual)` items were checked. Tick a criterion with `odd_task_check` (section "Acceptance criteria") only when you have that evidence.
   - **Leftovers:** debug code, commented-out code, stray files, secrets, unrelated changes in the diff.
3. **Propose the commits.** Split by logical unit, with functionality and refactor in separate commits. For each one give the message and the exact files it includes. Use the project's commit convention if `AGENTS.md` or `git log` shows one; otherwise a short imperative subject (about 72 characters at most) and a body only when the *why* is not obvious. If the working tree mixes unrelated changes, say so and suggest how to separate them.
4. **Write the PR description** (format below). Take the story, criteria and "Out of scope" from the task file; do not invent them. If a section is empty, say so and leave it as "not provided".
   - **Fix variant:** when the Story starts with `Fix:`, it is a fix. Use the fix format, the problem and criterion from the task file, and the cause from "Root cause". A fix has no "Out of scope". Commit messages for a fix say it is a fix and what the cause was.
5. **Record the delivery.** Write the proposed commits and the PR text with `odd_task_note`, section "Delivery", mode `replace`. Headings are demoted automatically so they cannot split the file.
6. **Wait for my go-ahead.** I make the commits and open the PR. You may give me the commands to run, but you do not run them.
7. **Close.** Add anything worth remembering under "Lessons". When I approve the proposal, call `odd_task_advance` with outcome `done`. Other tasks that were blocked by this one become ready: run `odd_task_list` and tell me the new frontier.

## Rules

- **Never commit, push, merge, tag or open the PR.** Only read-only git commands.
- **Do not invent anything.** Not criteria, not test results, not what "was verified". If you did not see it, mark it unknown.
- **Describe what is there.** The PR describes the diff, not what we intended to build.
- **Keep it short.** A reviewer should understand the PR in one minute. No marketing, no filler.
- **Flag, do not fix.** If you find a problem while checking, report it and suggest going back to `pair` or `fix`. Do not edit code.

## Output format

```markdown
## Readiness
- Mechanical gate: <ok / not ok / unknown>: <tests, lint, build; commands and results>
- Code review: <ok / not ok / unknown>
- Verification: <ok / not ok / unknown / skipped>
- Criteria: <n/n covered>; manual verification: <done / pending / none>
- Leftovers: <none, or list>

## Commits
1. `<message>`: <files>
2. `<message>`: <files>

## Pull request
**Title:** <short, imperative, English; for a fix, say what is fixed>

## Story
As a <actor>, I want <action>, so that <benefit>.

## What changed
- <2-5 bullets describing the behavior and anything a reviewer must know>

## Acceptance criteria
- [x] Given <context>, when <action>, then <result>.

## Out of scope
- <from the story>

## How to verify
- <commands or manual steps; include the manual verification items>
```

Fix variant of the pull request (replaces `Story` and `Out of scope`):

```markdown
## Problem
<the bug, one or two lines>

## Cause
<where and why it failed, one or two lines>

## What changed
- <the fix, and the regression test that guards it>

## Acceptance criteria
- [x] Given <context that triggered the bug>, when <action>, then <the confirmed expected result>.

## How to verify
- <the original steps to reproduce, and what should happen now>
```

End by asking whether I want to adjust anything before I run the commits.
