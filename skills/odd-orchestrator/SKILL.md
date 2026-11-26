---
name: odd-orchestrator
description: Use when starting, resuming or advancing an ODD task (plan, feature, hotfix or refactor). The markdown file in .odd/tasks/ is the source of truth. Follow this protocol so work survives session restarts.
---

# ODD orchestrator protocol

Talk to the human in their own language. The task file `.odd/tasks/<name>.md` is the only source of truth, never the chat history. You are the orchestrator: you read the task, run or dispatch the current phase, record the result and move the workflow forward. Only you write the task file.

## 1. Start or resume

1. Call `odd_task_list` first. It shows this project's tasks with status, phase and next step, which of them are blocked, and which are **ready**. It works even if ODD is not set up yet.
2. If a task clearly matches the request, resume it: `odd_task_read`, then read **Next step** before anything else.
3. Otherwise create one with `odd_task_create`. It sets up `.odd/` by itself: never ask the human to run `/odd-init`; if another tool says ODD is not initialized, call `odd_init` yourself.
4. Pick the type and the starting phase:

| The request is | Type | Starts at |
|---|---|---|
| A vague idea, a new project, or several stories | `plan` | `grill` (use `phase: backlog` when the idea is already clear) |
| One concrete story or ticket | `feature` | `story` |
| A story whose acceptance criteria are already agreed | `feature` | `pair` (`phase: pair`) |
| A bug or an error | `hotfix` | `fix` |
| A structure-only change | `refactor` | `refactor` |

When unsure, ask the human which one it is. Quick questions and tiny edits do not need a task.

5. **Dependencies.** A task with `blocked_by` must not be worked or advanced until every blocker is done: the tools refuse. Work a task listed as ready. A `plan` task ends in `to-tickets`, which creates one task per ticket with its blockers; after that, offer the human the first ready ticket. Use `odd_task_unblock` only when the human agrees the dependency is no longer needed.
6. If a tool says the session is in the home folder or the filesystem root, tell the human to start dsh inside the project. Do not work around it.

## 2. Run one phase

0. `odd_task_read` starts with `[odd] phase=<phase> mode=<inline|subagent> skill=<name>@<source>`.
   - `mode=subagent` (code-review, verify): call `odd_dispatch` with the task name. Do NOT run the phase yourself: the point is a clean context. It builds a minimal handoff packet, runs the phase in a subagent, records the report in the task file and advances the workflow. If the status is `needs_input`, ask the human the question, then `odd_task_answer`, then `odd_dispatch` again (the answer reaches the next run). If `blocked`, stop and report. If a review or verification sends the task back, you will be in the implementation phase again: its findings are in Evidence and in the Reviews or Verification section.
   - `mode=inline`: continue with step 1.
   - If the header says `skill=MISSING`, do not improvise and do NOT call `odd_task_advance`: a gap in the tooling is not a result of the phase and must not change the task state. Tell the human which skill is missing and where it can live (`.odd/skills/<name>/SKILL.md`, `~/.agents/skills/`, or map one of their own skills with `phase_skills` in `.odd/config.yml`), then stop.
1. Load the phase instructions with `odd_skill_load` (the exact name from the header) and follow them. Use `odd_skill_load`, not the native skill tool: it applies ODD precedence (project skills override global ones) and can see `.odd/skills`.
2. Record as you go with `odd_task_note`. Sections: Goal, Backlog, Story, Acceptance criteria, Implementation plan, Out of scope, Suggestions, Tickets, Test list, Root cause, Decisions, Answers, Lessons, Reviews, Verification, Delivery, Evidence, Open questions. Mode `append` adds a line; mode `replace` rewrites a section (use it for the structured ones). Tick checklist items with `odd_task_check`. Headings inside notes are demoted automatically.
3. Never claim tests pass without running them yourself and recording the exact command and result under Evidence.
4. Interactive phases (grill, backlog, to-tickets, story, pair, fix, refactor, ship): ask the human directly in the conversation and wait. Use `needs_input` only when you must stop now and the answer will come in a later session.
5. Close the phase with `odd_task_advance`:
   - `done`: the phase finished; the task moves on.
   - `changes_requested`: only from a review or a verification; returns to the implementation phase.
   - `needs_input`: you need a human answer in a later session; include `question`. Then stop.
   - `failed`: the phase did not succeed; it retries up to the configured limit.
   - `blocked`: you cannot continue; explain why.
6. After the human answers a pending question, call `odd_task_answer`, then re-run the same phase.
7. If the human interrupts or says stop, stop. Do not call `odd_task_advance` with an invented outcome: the task file already says where to resume.

## Rules

- If the status is `blocked`, stop and tell the human why. Do not work around the circuit breaker.
- Do not commit or push unless the human asks.
- A dispatched subagent never writes the task file and cannot see it; only you record results.
- Do not edit the task file by hand; use the `odd_task_*` tools (they lock, validate and keep the structure intact).

## Memory (only when Engram is enabled)

Engram is derived memory. The task file is the source of truth: if they disagree, the task file wins.

- Right after `odd_task_create` (the tool says when Engram is enabled): call `odd_memory_recall`, run the calls it lists, and use only what clearly applies. If a memory changes what you do, write it as a Decision in the task file and cite the observation id.
- While working, record durable knowledge in the task file, not in Engram: `Decisions` (choices and why), `Lessons` (what you would tell the next person) and, for hotfixes, `Root cause`.
- When the task is `done` or `blocked`: call `odd_memory_capture` and run the `mem_save` calls exactly as given. Do not add logs, test output, transcripts or secrets.
- Subagents never see or write memory unless the project explicitly allows read access for a role.
