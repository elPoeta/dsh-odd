---
name: tdd
description: Test-driven development discipline shared by the implementation phases (pair, fix, refactor). Covers setup in any stack, the test list, the red-green-refactor cycle, step size and stop conditions. Load it before writing the first test.
---

# TDD

Shared working rules for `pair`, `fix` and `refactor`. You are the driver: you write the code. I am the navigator: I review, decide and tell you yes or no.

Version: 2.0 (ODD). Reads: Acceptance criteria, Test list, Evidence. Writes: Test list, Evidence.

## Language

- Talk to me in the language I use.
- **All code is in English:** identifiers, comments, test names, error messages, commit messages. Only user-facing strings follow the product's own language.
- Keep the micro message labels (✅, `Decided:`) as they are.

## When it applies

Use it for behavior a test can observe. Not worth forcing, and you say so instead: throwaway spikes, pure configuration, copy changes, visual or timing-dependent behavior. Mark those criteria **(manual)** in the test list; never drop them silently.

## Setup (once per phase)

1. Detect the test command: `AGENTS.md` / `CLAUDE.md`, `package.json` scripts, `Makefile`, `pyproject.toml` / `tox.ini`, `Cargo.toml`, `go.mod`, `pom.xml` / `build.gradle`, `mix.exs`, CI config. If there are two plausible commands, or none, ask me. Do not assume a stack.
2. `git status`. Tell me if the tree is dirty. If we are on `main` / `master`, suggest a branch (I create it).
3. Run the full suite once for a **baseline** and record it with `odd_task_note` (section "Evidence"): exact command, passing and failing counts, and the tests that already fail. Pre-existing failures are not part of this work: list them, do not touch them.
4. No test infrastructure: propose the smallest setup as part of the first cycle and wait for my approval. Never install dependencies without asking.

## The test list

From the acceptance criteria, propose the list: **names only, not written yet**, in English, each saying *where* it is tested (the highest practical level: endpoint, service, component, CLI command). Criteria that cannot be tested well are marked `(manual)`.

Wait for my approval. This list is the spec: I approve it, not you. Then record it with `odd_task_note` (section "Test list", mode `replace`) as a checklist, one line per test: `- [ ] <name> (<where>)`. Tick items with `odd_task_check` when they go green.

## The cycle (one test at a time)

1. **Red.** Write the test. Run it and **show that it fails for the right reason**: the assertion fails because the behavior is missing. A compile error, a missing import, a typo or a setup error is not red; fix that first.
2. **Green.** Write the **minimum code** that makes it pass. Nothing the test does not require.
3. Run the tests and show that they pass. Tick the item.
4. **Refactor** only with everything green, as a separate step, and only if I agree.

By default do **one** cycle and stop. If I say "do N", do N complete cycles one after another (test, code, green), never "N tests and then the code". In a batch, show the tests first: they are what I most need to review.

When you stop, send a micro message:

```
✅ Passes "<test name>". <what I did in one line> (<file:line>)
Decided: <judgment call, if any>
Done: <n>/<total>. Pending: <next tests>
Change anything or continue with "<next test>"?
```

## Stop immediately, even mid-batch, if

- you need a design decision that is not in the plan;
- you think of adding something I did not ask for, even if it seems reasonable (mention it; it goes under "Open questions");
- making a test pass would require changing, skipping or deleting a test;
- you have had two attempts without reaching green;
- the step exceeds ~50 lines or touches more than 3 files: propose splitting it;
- you would need to do something risky: install or upgrade dependencies, touch migrations, config, CI, secrets or production data, or run a destructive command. Ask first.

## Test rules

- The expected value comes from the acceptance criterion (or from behavior I confirmed), **never computed with the same logic as the code**.
- Test behavior through the public interface, not internal details.
- Never weaken a test to get green. Quality standards live in the `testing` skill.
- Never write "tests pass" without having run them. Record the exact command and the real result in Evidence.

## Variants

- **Bug (`fix`).** The first test reproduces the bug and must fail because of the bug. Without a reproduction there is no fix.
- **Refactor.** Behavior is already defined by the code: pin it with characterization tests first (green from the start), then change structure in small steps with the suite green after each one.
- **Review findings.** When you come back after a code review or a verification, turn each behavior finding into a failing test first; fix the rest directly and show the suite green.

## Never commit

When there is a good point (tests green, a logical unit), tell me and suggest the commit message in English, with functionality and refactor in separate commits. I make the commit.
