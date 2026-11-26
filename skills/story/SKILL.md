---
name: story
description: Split the agreed plan into small, ordered, independently testable user stories with acceptance criteria.
---
# Story: slice the plan into shippable stories

Input: Goal, Decisions and Acceptance criteria in the task file.

1. Slice vertically: each story delivers a thin, working path through the stack (not "build the data layer"). Each should fit in one pair session and be testable on its own.
2. Order by dependency first, then by value and risk (riskiest unknowns early).
3. Write each story as:
   - S<n>: As a <user>, I want <capability> so that <benefit>
     - AC: Given <context>, when <action>, then <observable result> (one to four criteria, each testable)
     - Out of scope: <what it does not do> (only when it prevents confusion)
4. Check coverage: every acceptance criterion of the task maps to at least one story, and no story adds scope the human did not agree to.
5. Show the list to the human, adjust it, and wait for approval in the conversation (do not use `needs_input`).
6. Record with `odd_task_note`: section "Stories", one bullet per story including its AC. Notable splitting decisions go under "Decisions".
7. `odd_task_advance` outcome `done`, summary "N stories".

Keep stories small. If one needs more than a day, split it.
