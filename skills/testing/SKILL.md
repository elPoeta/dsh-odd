---
name: testing
description: Standards for writing and judging automated tests. What to test, how to structure a test, test doubles, determinism, and the signs of a weak test. Used while writing tests in pair, fix and refactor, and embedded in code reviews.
---

# Testing standards

Reference skill, no workflow phase of its own. Version: 2.0 (ODD).

## What to test

- Behavior observable through the public interface (a function's contract, an endpoint, CLI output, a rendered result), not private helpers or call order.
- Every acceptance criterion at least once, at the highest practical level. Add the failure paths the criteria imply (invalid input, missing data, permission denied), and only those.
- Boundaries that matter: empty, one, many, limits, absent values, and time zones or encodings when relevant.

## How to write

- One behavior per test, so there is one reason to fail. Name it as behavior ("rejects an expired token"), not as implementation ("calls validate").
- Arrange, act, assert, visible in the code. Assert the outcome that matters with specific values, not "truthy" or "no error".
- Expected values are literals taken from the criterion. Never recompute them with the code's own logic and never copy them from the current output.
- Test data is minimal and built by small helpers named for intent. No giant shared fixtures that hide what matters.

## Test doubles

- Use real objects wherever it is cheap. Fake or stub only at system boundaries: network, clock, filesystem, third parties, randomness.
- Do not mock the unit under test or code you own just to isolate it. Verify calls on a double only when the interaction is itself the behavior (an email was sent, an event was published).

## Determinism

- No dependence on test order, shared mutable state, wall-clock time, the real network, locale or machine-specific paths. Inject the clock and randomness. Clean up what you create.
- A flaky test is a failing test. Find the cause; do not add retries, sleeps or skips.

## Signs of a weak test (findings in a review)

- It would still pass if the behavior were broken: no assertion, an assertion on the mock, a tautology.
- The expected value is computed by the same logic as the code.
- Tests were skipped, weakened, deleted or loosened in the same change as the code.
- It is over-specified: private calls, exact call counts, snapshots of everything, so any refactor breaks it.
- Coverage numbers are treated as the goal. Judge by criteria covered.
- It is slow enough that nobody runs it. Prefer fast tests at the right level; one end-to-end smoke test per critical flow is enough.

## Quick check

Before calling a test done: if I broke the behavior in the most obvious way, would this test fail? If I refactored the internals, would it still pass?
