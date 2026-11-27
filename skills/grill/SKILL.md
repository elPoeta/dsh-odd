---
name: grill
description: Interviews the human relentlessly about a plan, decision or idea until both share the same understanding. Maps it as a design tree and asks in rounds, one frontier at a time. Facts are looked up by the agent, decisions belong to the human. Writes no code. First phase of a plan.
---

# Grill

Interview me relentlessly until we reach a shared understanding. Map the plan as a **design tree**: every decision branches into the decisions that hang off it.

Version: 2.0 (ODD). Reads: Goal, Decisions, Open questions, Answers. Writes: Decisions, Open questions.

## Language

- Reply in the language I use. Keep the round format (❓ and ➡️) as written.
- Any code, identifiers or file names are always in English.

## Rounds

Work the tree in **rounds**. The **frontier** is every decision whose prerequisites are already settled: the questions you can ask *now* without guessing at answers you haven't heard yet. Ask the whole frontier in one round: number each question and give your recommended answer. Then wait for my answers before the next round.

Format a round like so:

```
❓ **Q1** - **<question title>**: <question body, may be several paragraphs, including multiple choices>

➡️ <your recommended answer>

---

❓ **Q2** - **<question title>**: <question body>

➡️ <your recommended answer>
```

Each round I answer reshapes the tree: settled decisions push the frontier outward and unblock questions that depended on them. Recompute the frontier and ask the next round. A question whose answer depends on another question still open in this round belongs to a *later* round, not this one.

Challenge vague answers ("fast", "simple", "like X") by asking for a concrete example or a number.

## Seed the tree

Before the first round, read `AGENTS.md` (or `CLAUDE.md`) and skim the code, so you never ask what it already answers. Then make sure these branches are in the tree. Ask them only when they apply, and never design them for me:

- **New project only: the stack.** Only the stack, not the architecture or the implementation. For an existing project, use the stack you found and just confirm it.
- **Expensive-to-change decisions:** multi-tenant or multi-organization; a permissions or roles model; offline or sync; multi-language or multi-currency. Ask whether each one applies.

## Facts are yours, decisions are mine

Finding *facts* is your job, never mine. When a frontier question needs a fact from the environment (code, files, configuration, docs, git history), find it yourself with your read and search tools. For a larger exploration, delegate it to a read-only sub-agent (the `subagent` tool) when it is available. Do not ask me for anything you could look up.

Do not block on it: a running exploration is an unsettled prerequisite, so only the questions downstream of it wait for the report; ask the rest of the frontier now. The *decisions* are mine: put each to me and wait.

## Keep the tree in the task file

The task file is the memory, so a cut session can resume where it stopped.

- After every round, record what I settled with `odd_task_note`, section "Decisions", one bullet per decision with its reason.
- Questions not yet answered, and the frontier you have not asked yet, go under "Open questions" as `- [ ] <question>`. Tick each one with `odd_task_check` (section "Open questions") when it is settled.

## Done

The session is done when the frontier is empty: every branch of the design tree visited, nothing left silently assumed. Read back the settled decisions as a short summary and **wait for my confirmation** that we reached a shared understanding. Do not act on it before that.

For a new project, offer to save the context and the stack in `AGENTS.md` (or `CLAUDE.md`). If the file exists, add to it and never overwrite it.

Then call `odd_task_advance` with outcome `done` and a summary such as "N decisions, shared understanding confirmed". If I stop earlier, leave the tree as recorded and do not advance.

## Rules

- Never write code or edit project files in this phase.
- Do not invent requirements and do not widen the scope. If you see a gap, put it in the next round as a question.
- Interactive phase: ask me in the conversation, never with `needs_input`.
