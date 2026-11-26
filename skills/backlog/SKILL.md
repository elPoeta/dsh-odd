---
name: backlog
description: Turns a software idea or a discussed feature into an ordered backlog of short, vertical user stories, agreed with the human. Produces no acceptance criteria or implementation details, that is the story phase's job. Second phase of a plan.
---

# Backlog

Your job is to help me split what I tell you into user stories. I bring the requirements; you order and slice them.

Version: 2.0 (ODD). Reads: Goal, Decisions, Answers. Writes: Backlog, Decisions, Open questions. The next phase (`to-tickets`) turns the approved backlog into tasks.

## Language

- Reply in the language I use. Keep the output format's headings (`Context`, `Backlog`) and field names (`Stack:`, `Requires:`) in English.
- Any code, identifiers or file names are always in English.

## Conversation

1. **Check the context.** If there is an existing codebase, read `AGENTS.md` (or `CLAUDE.md`) and skim the code before asking anything. Do not ask what the code already answers. Read the Decisions recorded by the grill phase, if any: they are settled. A new project skips this.
2. **Listen** to the idea or feature. If something is unclear, ask. One question at a time, with your suggested answer.
3. **New project only:** discuss the stack. Only the stack, not the architecture or the implementation. Existing project: use the stack you found and just confirm it.
4. **Ask whether any of these expensive-to-change decisions apply.** Only ask, do not design them:
   - Multi-tenant or multi-organization
   - Permissions or roles model
   - Offline or sync
   - Multi-language or multi-currency
5. **Propose the backlog.** I adjust it. Iterate until I approve.

## Rules

- **Do not invent requirements.** Only split what I told you. If you see a gap, ask me; do not fill it.
- **Each story delivers value on its own** and cuts through every layer (data, backend, UI). Never split by layer.
- **No technical stories.** The actor is never the developer or the system. "Set up the database" or "create the user model" are not stories; that infrastructure gets built inside the first story that needs it.
- **Few stories.** 10-15 max per backlog. I would rather add than cut. If what I told you needs more, group the stories into phases (Phase 1, Phase 2…) and detail only the first phase; list the others as one-line themes for me to confirm.
- **One line per story.** No acceptance criteria, no technical details, no estimates, no priority labels.
- **Order is the only prioritization.** Order by dependency first, then by value to the user. The first story is the smallest one usable end to end (walking skeleton).
- **`Requires: #N` is the exception, not the norm.** Add it only when a story truly makes no sense without another. If you add many, the slicing is probably wrong: re-slice.

## Output format

```markdown
Context: <one or two lines: what it is and who it is for>
Stack: <what we agreed>
Expensive decisions: <the ones that apply, or "none">

1. As a <actor>, I want <action>, so that <benefit>.
2. As a <actor>, I want <action>, so that <benefit>. Requires: #1
```

With phases, use `### Phase 1: <name>` headings inside the backlog; numbering continues across phases.

## Closing

When I approve the backlog:

1. Record it once with `odd_task_note`, section "Backlog", mode `replace`, in the format above. Record the stack and the expensive decisions under "Decisions".
2. Offer to save the context and stack in `AGENTS.md` (or `CLAUDE.md`). If the file exists, add to it and never overwrite it.
3. The task file is the record of the backlog; do not copy it into other files. Mirroring it to an external tracker is my call.
4. Call `odd_task_advance` with outcome `done` and a summary such as "N stories in M phases".
