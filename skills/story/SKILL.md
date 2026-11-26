---
name: story
description: Takes ONE user story, adds 2-3 acceptance criteria and proposes a mini implementation plan for approval. Use right before building a story or a ticket. Writes no code, implementation is the pair phase's job. First phase of a feature.
---

# Story

We refine a single story, right before building it. You propose and I decide.

Version: 2.0 (ODD). Reads: Goal, Backlog, Decisions, Answers. Writes: Story, Acceptance criteria, Implementation plan, Out of scope, Suggestions. The `pair`, `code-review`, `verify` and `ship` phases read these sections, so keep the section names exactly as written.

## Language

- Reply in the language I use. Keep the section names and the `Given / when / then` keywords in English; write the content in my language.
- Any code, identifiers or file names are always in English.

## Steps

1. **Read the story.** In this order: the task Goal (a ticket from `to-tickets` carries "What to build" and draft criteria); the Backlog, if the task has one (the story I name, by default the first); text I paste. If the source is an issue or ticket (GitHub, Jira…), fetch it with `gh` or an available MCP tool; if you cannot access it, ask me to paste it. Do not guess its content. Then review the current code and `AGENTS.md` for context. If there is no code yet (first story of a new project), say so: the plan must include the minimum scaffolding the story needs, nothing more.
2. **Acceptance criteria.** Propose 2-3 in Given/When/Then. Draft criteria from the ticket are input, not a contract: keep, merge or drop them. They describe *what* the user sees or gets, never *how* it is implemented. At most **one** unhappy-path criterion, only if the story is unusable or unsafe without it.
3. **More than 3 criteria? Do not bloat the story: propose splitting it.** Show the new stories in backlog format (`As a…, I want…, so that…`), and continue with the first one. After I approve, note the rest under "Open questions" and ask whether to create tasks for them (`odd_task_create`, type `feature`, phase `story`, `blocked_by` this task).
4. **Mini plan.** 5 bullets max, no code and no file names: how it cuts through the layers, with the minimum that meets the criteria.
5. **Out of scope.** List what a reasonable reader might assume is included but is not (error cases beyond the one chosen, edge cases, related features, polish). Take it from what I said and what you left out of the criteria. Do not invent new requirements here.
6. **Wait for my approval** in the conversation. We adjust until I say yes.

## Rules

- **Do not invent requirements.** If information is missing, ask me: one question at a time, with your suggested answer.
- **The simplest thing that meets the criteria.** No abstractions, layers, configuration or patterns "for the future".
- **Suggest, do not decide.** If a pattern could help (Atomic Design, middleware composition, extracting a component…), mention it under "Suggestions" with its why. Only when there is a concrete signal in the code (for example, something that already repeats), never in advance. No signal: omit the section.
- **Do not write code** and do not edit project files.

## Record

After I approve, write each section once with `odd_task_note`, mode `replace`:

- "Story": `As a <actor>, I want <action>, so that <benefit>.`
- "Acceptance criteria": `- [ ] Given <context>, when <action>, then <result>.` one line each.
- "Implementation plan": the plan bullets.
- "Out of scope": what is left out of this story.
- "Suggestions": only if there is a concrete signal.

Then call `odd_task_advance` with outcome `done` and a summary such as "N criteria".
