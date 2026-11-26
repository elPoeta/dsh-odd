---
name: grill
description: Interview the human to turn a rough idea into an agreed plan with scope, non-goals and acceptance criteria. First phase of an ODD feature.
---
# Grill: reach a shared plan before any code

Goal: leave the task file with a plan both of you would sign. Do not design in your head; ask until nothing important is guessed.

1. Read the task (`odd_task_read`): Goal, Decisions, Open questions. Explore the repo briefly (structure, stack, similar existing code). Never ask what you can find out by looking.
2. Ask ONE question at a time, each with your recommended answer, so the human can just confirm. Use the ask-user tool when available, otherwise ask in plain text and wait. Ask in the conversation; do not use `needs_input` for this.
3. Cover, skipping what is already clear: who it is for and why now; scope and explicit non-goals; the main flows; edge cases and failure modes; constraints (stack, performance, compatibility, deadline); risks and unknowns; how we will know it works.
4. Challenge vague answers ("fast", "simple", "like X"): ask for a concrete example or a number.
5. Stop when another question would not change the plan. Read back what you are about to record and let the human correct it.
6. Record with `odd_task_note`: section "Decisions" (one bullet per decision, with the reason), section "Acceptance criteria" (testable bullets), section "Open questions" for what is still unknown.
7. Close with `odd_task_advance`, outcome `done`, and a two-line summary.

Do not write code in this phase.
