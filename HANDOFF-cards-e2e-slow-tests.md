# Handoff: cards e2e — every `test.slow()` test times out in CI (2026-08-15)

Cards' E2E job fails on CI and has done since **2026-08-07** — every run on
`main` since then is red. It is **not** caused by the workflow-rules work
(cards #31); that PR adds four declaration files and one Go file and touches
none of the failing specs. It is recorded here because it blocks cards #31
from merging and will block anything else landing in cards.

## The signal

From cards #31's run
([31865313333](https://github.com/tinycld/cards/actions/runs/31865313333)):
**10 failed / 72 passed in 25.4 minutes**, of which **8 are
`Test timeout of 90000ms exceeded`**.

The ten failures:

| Spec | Test |
|---|---|
| `board-presence.spec.ts:44` | shows who else is on the board |
| `board-sharing.spec.ts:47` | viewer and commentor gates, last-owner lock |
| `card-attachments.spec.ts:230` | a viewer can read but not add/remove |
| `card-description-collab.spec.ts:106` | one person types, the other sees it |
| `card-description-collab.spec.ts:154` | you can see the other person's cursor |
| `card-description-collab.spec.ts:228` | the full-page card is collaborative |
| `card-description-collab.spec.ts:299` | a viewer cannot edit the description |
| `card-description-toolbar.spec.ts:316` | a viewer gets no toolbar |
| `comment-editing.spec.ts:266` | only your own comments offer edit |
| `public-board.spec.ts:148` | a non-member is refused a dead link |

## What they have in common

**Every one of them calls `test.slow()`.** That is Playwright's "triple this
test's timeout" — 30s becomes 90s, which is exactly the number in the errors.

Eleven tests across seven specs call it. Ten of them failed. That correlation
is the finding: this is not general flakiness, it is specifically the tests
already marked as needing more time, running out of the extra time they were
given.

Note what it is NOT. An earlier reading blamed multi-browser-context
collaboration tests — that is wrong: only `public-board.spec.ts` opens a
second context. The common factor is `test.slow()`, not concurrency.

## They pass locally

On cards' `feat/automation` branch, on a developer machine:

- `board-sharing.spec.ts` — **1 passed in 16.5s** (CI gave it 90s and it timed
  out)
- `board-presence.spec.ts` + `card-description-collab.spec.ts` together —
  **5 passed in 1.1m**

So the tests are not wrong about the product. They are slower on CI hardware
than the tripled budget allows, on a runner already deep into a 25-minute
suite.

## What NOT to do

Raising the timeout further, or forcing `--workers=1`, would turn the job
green while hiding the cause. Both are explicitly banned by `CLAUDE.md`
("No e2e workarounds. No bumped timeouts, no forced-serial runs, no papering
over root causes"). A test that only passes with a bigger number is a test
whose slowness has never been explained.

## Where to start

The question to answer first is **why these tests need `test.slow()` at all**
— that marker is a symptom someone already noticed. Each one drives a
multi-step arc (create a board, invite a user, open a card, assert a gate) and
the expensive step is usually the invite/share flow, not the assertions the
test exists for.

Likely angles, cheapest first:

1. **Measure where the time goes.** `--reporter=list --trace on` for one of
   them locally, then compare to the CI trace artifact. If setup dominates,
   the fix is fixtures, not timeouts.
2. **Share the expensive setup.** Several of these build the same
   board+member arrangement per test. A worker-scoped fixture would cut the
   repeated invite flow.
3. **Check whether the app is genuinely slower under load**, e.g. the Metro
   bundle being recompiled mid-run, which would be a real product-adjacent
   finding rather than a test one.

## Current state

- **cards #31** (workflow rules) is otherwise green — `Typecheck, Unit &
  Access Rules` passes, its own 5 new Go tests pass, the full cards Go suite
  passes locally (92s). It is blocked only by this.
- Cards `main` is red for the same reason, so this is not a regression the PR
  introduced.
