---
name: to-tickets
description: Turns an approved backlog, plan or spec into tracer-bullet tickets that declare what blocks them, and creates each ticket as an ODD task in dependency order. Vertical slices, prefactoring first, expand-contract for wide refactors. Last phase of a plan.
---

# To tickets

Break a plan, a spec or an approved backlog into a set of **tickets**: tracer-bullet vertical slices, each declaring the tickets that **block** it. In ODD every ticket becomes a task (its own file) and the blocking edges are enforced: a blocked task cannot be worked or advanced until its blockers are done.

Version: 2.0 (ODD). Reads: Goal, Backlog, Decisions, Answers. Writes: Tickets, Decisions, Open questions (and creates the tasks).

## Language

- Reply in the language I use. Keep the headings and field names of the formats below in English.
- Any code, identifiers, task ids or file names are always in English.

## Process

### 1. Gather context

Work from what is already in the task: the approved **Backlog** first, then Decisions and Answers. If I pass a reference instead (a spec path, an issue number or URL), fetch it with `gh` or an available MCP tool and read its full body and comments; if you cannot reach it, ask me to paste it.

With an approved Backlog, **do not re-slice it**: each story is one ticket. `Requires: #N` and the order give the first edges. Re-slice only if I ask or a story is clearly horizontal or too big for one fresh context window.

### 2. Explore the codebase (optional)

If you have not explored the code yet, do it to understand its current state. Use the project's domain vocabulary (`AGENTS.md`, glossary, `docs/adr`) in titles and descriptions, and respect the decisions recorded in the area you touch.

Look for prefactoring that makes the implementation easier: "Make the change easy, then make the easy change."

### 3. Draft vertical slices

<vertical-slice-rules>

- Each slice cuts a narrow but COMPLETE path through every layer (schema, API, UI, tests): vertical, NOT a horizontal slice of one layer.
- A completed slice is demoable or verifiable on its own.
- Each slice is sized to fit in a single fresh context window.
- Any prefactoring goes first.

</vertical-slice-rules>

Give each ticket its **blocking edges**: the other tickets that must complete before it can start. Only real gates count; a ticket with no blockers can start immediately. A pure chain where every ticket blocks the next one usually means the slicing is wrong.

**Wide refactors are the exception to vertical slicing.** A wide refactor is one mechanical change (rename a column, retype a shared symbol) whose blast radius fans across the whole codebase, so a single edit breaks thousands of call sites and no vertical slice can land green. Sequence it as **expand-contract**:

1. **Expand:** add the new form beside the old one so nothing breaks.
2. **Migrate** the call sites in batches sized by blast radius (per package, per directory), each batch its own ticket blocked by the expand, keeping the build green because the old form still exists.
3. **Contract:** delete the old form once no caller remains, in a ticket blocked by every migrate batch.

When even the batches cannot stay green alone, keep the sequence but let them share an integration branch and all block a final integrate-and-verify ticket; green is promised only there. These tickets are tasks of type `refactor`.

### 4. Quiz me

Present the proposed breakdown as a numbered list. For each ticket show:

- **Title:** short, descriptive.
- **Blocked by:** which tickets, if any, must complete first.
- **What it delivers:** the end-to-end behavior this ticket makes work.

Ask me:

- Does the granularity feel right (too coarse, too fine)?
- Are the blocking edges correct: does each ticket depend only on tickets that genuinely gate it?
- Should any tickets be merged or split further?

Iterate until I approve the breakdown.

### 5. Create the tasks

Only after I approve. In **dependency order, blockers first** (a task can only be blocked by tasks that already exist), call `odd_task_create` once per ticket:

- `name`: `<feature-slug>-<NN>-<ticket-slug>`, numbered from `01` in dependency order, lowercase with hyphens. It must be unique in the project.
- `type`: `feature`; `refactor` for prefactoring and expand-contract tickets.
- `phase`: `story` for feature tickets (the story phase refines the criteria just in time). Omit it for refactor tickets.
- `title` and `goal`: the goal is "What to build" in the ticket template below, with the draft acceptance criteria as `- [ ]` lines. Say in the goal that the criteria are drafts for the story phase to refine.
- `parent`: the id of this plan task.
- `blocked_by`: comma-separated ids of the tickets that gate it.

Then record the list once with `odd_task_note`, section "Tickets", mode `replace`, one line per ticket: `- <task id>: <title> (blocked by: <ids or none>)`.

Do not modify or close any parent issue. If I ask for the tickets in an external tracker (GitHub, Linear…), publish one issue per ticket in dependency order with the platform's native blocking or sub-issue relationship, and keep the issue reference in the task goal. The tasks still carry the work.

<ticket-template>

**What to build:** the end-to-end behavior this ticket makes work, from the user's perspective, not a layer-by-layer implementation list.

**Draft acceptance criteria:**

- [ ] Criterion 1
- [ ] Criterion 2

</ticket-template>

Avoid file paths and code snippets in tickets: they go stale fast. Exception: if a prototype produced a snippet that encodes a decision more precisely than prose can (a state machine, a reducer, a schema, a type shape), inline it, say briefly that it came from a prototype, and trim it to the decision-rich part.

### 6. Hand over the frontier

The **frontier** is every ticket whose blockers are all done; for a linear chain that is the first one. Run `odd_task_list`: tasks that are ready appear under "Ready to work". Tell me the frontier and ask which ticket to start with.

Finish with `odd_task_advance`, outcome `done`, summary "N tickets, frontier: <ids>".
