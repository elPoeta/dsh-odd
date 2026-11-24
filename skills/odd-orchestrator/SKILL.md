---
name: odd-orchestrator
description: Use when starting, resuming or advancing an ODD task (feature, hotfix or refactor). The markdown file in .odd/tasks/ is the source of truth; follow this protocol so work survives session restarts.
---

# ODD orchestrator protocol (the orchestrator runs in the main agent)

The task file `.odd/tasks/<name>.md` is the only source of truth. Never rely on chat history.

## Resume or start
1. Resuming: call `odd_task_read` first. Read **Next step** before anything else.
2. Starting: call `odd_task_create` (name is kebab-case; type is feature | hotfix | refactor).

## Run one phase
0. `odd_task_read` starts with `[odd] phase=<p> mode=<inline|subagent>`.
   - `mode=subagent`: call `odd_dispatch` with the task name. Do NOT run the phase yourself. It builds a minimal handoff packet, runs the phase in a clean-context subagent, records the result in the md and advances the workflow. Read its answer: if the status is `needs_input`, ask the human the question, then `odd_task_answer`, then `odd_dispatch` again; if `blocked`, stop and report.
   - `mode=inline`: continue with step 1 below.
   - The header also shows `skill=<name>@<source>`. If it says `MISSING`, tell the human to run `/odd-skills check` instead of improvising.
1. The current phase is in the frontmatter (`phase`). Load its instructions with `odd_skill_load` (name = the phase: grill, story, pair, fix, refactor, ship) and follow them. Use `odd_skill_load`, not the native skill tool: it applies ODD precedence (project skills override global ones) and can see `.odd/skills`.
2. Keep the result short. Record decisions with `odd_task_note` (section `Decisions`), proof with section `Evidence` (exact test command and result), and what you handed to the phase with section `Handoffs`.
3. Never claim tests pass without running them yourself and recording the output in Evidence.
4. Close the phase with `odd_task_advance`:
   - `done`: phase finished, move on.
   - `changes_requested`: only from code-review; returns to the implementation phase.
   - `needs_input`: you need a human answer; include `question`. Then stop and ask the human.
   - `failed`: the phase did not succeed; it will retry up to the configured limit.
   - `blocked`: you cannot continue; explain why.
5. After the human answers a question, call `odd_task_answer`, then re-run the same phase.

## Rules
- If status is `blocked`, stop and tell the human why. Do not work around the circuit breaker.
- Do not commit or push unless the human asks.
- A dispatched subagent never writes the md and cannot see it; only you (the orchestrator) record results.
- Do not edit the task file by hand; use the `odd_task_*` tools (they lock and validate).
