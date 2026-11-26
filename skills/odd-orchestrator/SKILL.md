---
name: odd-orchestrator
description: Use when starting, resuming or advancing an ODD task (feature, hotfix or refactor). The markdown file in .odd/tasks/ is the source of truth; follow this protocol so work survives session restarts.
---

# ODD orchestrator protocol (the orchestrator runs in the main agent)

Talk to the human in their own language.

The task file `.odd/tasks/<name>.md` is the only source of truth. Never rely on chat history.

## Resume or start
1. Call `odd_task_list` first. It shows this project's tasks (status, phase, next step) and works even if ODD is not set up yet.
2. If a task clearly matches the request, resume it: call `odd_task_read` and read **Next step** before anything else.
3. Otherwise create one with `odd_task_create` (name is kebab-case; type is feature | hotfix | refactor). It sets up `.odd/` in the project by itself. Never ask the human to run `/odd-init`; if another tool says ODD is not initialized, call `odd_init` yourself.
4. If a tool says the session is in the home folder or filesystem root, tell the human to start dsh inside the project. Do not work around it.
5. Quick questions and tiny edits do not need a task. Use ODD for features, hotfixes and refactors.

## Run one phase
0. `odd_task_read` starts with `[odd] phase=<p> mode=<inline|subagent>`.
   - `mode=subagent`: call `odd_dispatch` with the task name. Do NOT run the phase yourself. It builds a minimal handoff packet, runs the phase in a clean-context subagent, records the result in the md and advances the workflow. Read its answer: if the status is `needs_input`, ask the human the question, then `odd_task_answer`, then `odd_dispatch` again; if `blocked`, stop and report.
   - `mode=inline`: continue with step 1 below.
   - The header also shows `skill=<name>@<source>`. If it says `MISSING`, do not improvise and do NOT call `odd_task_advance`: a gap in the tooling is not a result of the phase and must not change the task state. Tell the human which skill is missing and where it can live (`.odd/skills/<name>/SKILL.md`, `~/.agents/skills/`, or map your own skill with `phase_skills` in `.odd/config.yml`), then stop.
1. The current phase is in the frontmatter (`phase`). Load its instructions with `odd_skill_load` (use the exact name from the header) and follow them. Use `odd_skill_load`, not the native skill tool: it applies ODD precedence (project skills override global ones) and can see `.odd/skills`.
2. Keep the result short. Record decisions with `odd_task_note` (section `Decisions`), proof with section `Evidence` (exact test command and result), and what you handed to the phase with section `Handoffs`.
3. Never claim tests pass without running them yourself and recording the output in Evidence.
4. Interactive phases (grill, story, pair): ask the human directly in the conversation and wait for the answer. Use `needs_input` only when you must stop now and the answer will come in a later session.
5. Close the phase with `odd_task_advance`:
   - `done`: phase finished, move on.
   - `changes_requested`: only from code-review; returns to the implementation phase.
   - `needs_input`: you need a human answer in a later session; include `question`. Then stop.
   - `failed`: the phase did not succeed; it will retry up to the configured limit.
   - `blocked`: you cannot continue; explain why.
6. After the human answers a pending question, call `odd_task_answer`, then re-run the same phase.
7. If the human interrupts or says stop, stop. Do not call `odd_task_advance` with an invented outcome: the task file already says where to resume.

## Rules
- If status is `blocked`, stop and tell the human why. Do not work around the circuit breaker.
- Do not commit or push unless the human asks.
- A dispatched subagent never writes the md and cannot see it; only you (the orchestrator) record results.
- Do not edit the task file by hand; use the `odd_task_*` tools (they lock and validate).

## Memory (only when Engram is enabled)
Engram is derived memory. The task file is the source of truth: if they disagree, the task file wins.
- Right after `odd_task_create` (the tool says when Engram is enabled): call `odd_memory_recall`, run the calls it lists, and use only what clearly applies. If a memory changes what you do, write it as a Decision in the task file and cite the observation id.
- While working, record durable knowledge in the task file, not in Engram: `odd_task_note` with section `Decisions` (choices and why), `Lessons` (what you would tell the next person) and, for hotfixes, `Root cause`.
- When the task is `done` or `blocked`: call `odd_memory_capture` and run the `mem_save` calls exactly as given. Do not add logs, test output, transcripts or secrets.
- Subagents never see or write memory unless the project explicitly allows read access for a role.
