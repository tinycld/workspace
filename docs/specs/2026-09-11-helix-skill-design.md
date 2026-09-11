# Helix Skill — Design

**Status:** implemented at `~/code/tinycld/.claude/skills/helix/` (project-local, like heal-ci and release); revised after an
adversarial review of the skill files (2026-09-11)
**Skill location:** `~/code/tinycld/.claude/skills/helix/` (project-local, like heal-ci and release)

## Goal

A skill that takes a screenshot of an existing app plus a description, and drives
it through to a merged-ready PR in an existing tinycld package — via a dialogue
to fix the spec, mockups to fix the UX, and a checkpoint loop where each slice
must pass hard gates before the next one starts.

Modelled on the "Helix" process: the first output is not expected to be correct,
and an imperfect attempt cannot move forward until it becomes a good result.

## Scope

**In scope:** a new or reworked screen inside an *existing* tinycld package.
The skill requires both a screenshot and a target package, and refuses to start
without them.

**Out of scope:** building a whole new package. Too many non-visual concerns
(Go server, migrations, seeds, manifest) for a screenshot to usefully drive.

**The screenshot is inspiration, not a target.** The skill never attempts a 1:1
reproduction. It contributes two things, which travel down separate paths and
never remix:

- **Feature inventory (A-track)** — the capabilities it shows. Spec material.
- **Aesthetic sparks (C-track)** — at most 3 qualities worth carrying over.

## Packaging

Self-contained. The skill does not invoke `superpowers:*` skills — their flows
are built for open-ended work and would fight this one (brainstorming assumes no
design has happened; writing-plans has a different task format). The genuinely
useful parts are copied into `references/` instead.

```
helix/
  SKILL.md              # flow, gates, state, when to stop
  references/
    dialogue.md         # question discipline + spec self-review
    intake.md           # screenshot decomposition (A-track / C-track)
    mockups.md          # cheap artboards -> fidelity scratch route
    checkpoints.md      # decomposition + plan format + plan review
    gates.md            # the three gates, reviewer mandates, deferral rules, final
    ledger.md           # the one file read across phases
  scripts/
    plan-check.mjs      # spec→plan coverage, placeholders, interface names (exit 1 on errors)
    review-diff.mjs     # stage, list out-of-plan files, emit the staged diff for gate 3
    finish.mjs          # phase-6 cleanup + full check + full e2e, first failure stops
  templates/
    helix-capture.spec.ts   # manifest-driven screenshot grid, copied into the package per run
```

The scripts are dependency-free Node and exist for repeatability: each
replaces a step that is mechanical, repeated every run, and would otherwise
be done slightly differently each time. Nothing lands in any tinycld repo
permanently; the capture spec is copied into the target package for the
run and removed at the end.

Every subagent (implementer, plan reviewer, gate-3 reviewers, fix reviewer)
is a fresh `general-purpose` agent with a verbatim mandate written in the
reference files. The `pr-review-toolkit` agents were considered and not used:
their prompts cannot carry the deferral hunt, which every reviewer needs.

## Artifacts

All live in the target package's own repo, versioned with the code:

```
<package>/docs/specs/<feature>-design.md        # agreed behavior
<package>/docs/plans/<feature>-checkpoints.md   # the decomposition
<package>/docs/plans/<feature>-ledger.md        # full run history (retained)
<package>/docs/plans/<feature>-reference/       # gate-2 reference PNGs (retained)
<package>/docs/helix-lessons.md                 # durable, capped, carried forward
<package>/tinycld/<slug>/lib/<feature>-fixture.ts   # synthetic data, imported by seed.ts
```

Two scratch files exist only for the run: the mockup route
(`tinycld/<slug>/screens/helix-mockup.tsx`) and the capture spec
(`tests/e2e/helix-capture.spec.ts`, copied from the skill's templates). Both
are added to the package's `.git/info/exclude` at branch creation so
`git add -A` is safe throughout, and `finish.mjs` deletes them. The reference
capture manifest (`docs/plans/<feature>-capture.json`) is retained with the
reference PNGs; built (gate-2) screenshots live in the session scratchpad. The ledger is retained — it is the
detailed run history; the PR is only a summary.

## Flow

### 1. Intake

Reads the screenshot and description, produces two extractions:

**Feature inventory** — a flat list of observable capabilities, written as
behavior rather than UI nouns ("detail pane opens inline, not as a route").
Anything a static image cannot answer becomes a dialogue question, never an
assumption.

**Aesthetic sparks** — at most 3, each naming the *quality* rather than the
implementation ("rows dense enough that ~12 fit without scrolling", not "8px
padding"). The cap forces a choice about what actually caught the eye; an
unbounded list is just a description of the screenshot.

Each spark is triaged against the design system immediately, before dialogue:

- **expressible** — maps to existing semantic tokens and core components; the
  mapping is stated.
- **needs extension** — requires a new token or core component. Surfaced as an
  explicit proposal. If accepted it becomes checkpoint zero, landing in a core
  PR that must merge before the package checkpoints open.
- **dropped** — cannot be expressed and is not worth a core change. Said
  explicitly rather than silently ignored.

Triage runs up front because a "needs extension" spark changes the plan's shape
and can block on an external merge.

Both extractions are presented for correction before questioning starts.

### 2. Spec dialogue

One question at a time, multiple choice where the options are genuinely
discrete, always with a recommendation and its reasoning. Questions come from
four wells:

- **Inventory gaps** — empty states, loading, click behavior, pagination, scale.
- **Data shape** — which collections, whether new ones are needed, whether the
  query is one `.join()` or several. Determines whether there is a migration
  checkpoint.
- **Scope** — the YAGNI pass. The skill actively proposes cutting inventory
  items rather than treating the screenshot as a requirements document. Cuts are
  named explicitly and confirmed.
- **Platform** — native and web are both required. Any item that is
  platform-specific in practice surfaces here with its drawbacks stated, since
  sign-off is required.

Ends when the behavior can be stated without hedging. Spec is written,
self-reviewed (placeholders, contradictions, ambiguity, scope), fixed inline,
and read by the human before anything visual happens.

### 3. Mockups

**Pass 1 — artboards.** Two or three directions on one pan/zoom canvas,
published as an Artifact. HTML approximations, not real components; the point is
comparing directions cheaply. Each direction states what it does differently and
which accepted spark it carries. Two directions that are the same idea with
different spacing count as one.

**Pass 2 — fidelity reference.** The winner is rebuilt as a scratch route in the
target package using real core components and real semantic tokens.

Before the route is built, a **synthetic fixture** is generated: enough rows to
show grouping, long values that test truncation, an empty case, and edge cases
the inventory implies. Written to a real path in the package as a structured
fixture — not inline in the route — so deleting the route does not take the data
with it.

The fixture is also how gate 2 gets data: the real screen reads live queries,
raw PocketBase writes are banned everywhere, and the e2e stack seeds its DB
only through each package's `seed.ts`. So the migration checkpoint (or
checkpoint 1 if there is none) wires the fixture into `seed.ts`. That import
also keeps the fixture type-checked against the real schema for the life of
the repo. At the end of the run the human decides whether the seed wiring
stays (seed data ships to real deployments) or is reverted, leaving the
fixture as test data.

If the collection schema does not exist yet (likely — migrations are a later
checkpoint), the fixture is written against the spec's data shape and the
migration checkpoint is responsible for reconciling them. The plan flags that
dependency so the two cannot drift silently.

This pass is where "expressible in the design system" stops being a claim. A
spark that survived triage but cannot be built from the component library dies
here, and the skill says so rather than reaching for a one-off style.

The route yields gate 2's reference: same renderer, same components, so a diff
means something. It is static — no mutations, no live queries. **Gate 2 compares
appearance only, never behavior.** Behavior belongs to gates 1 and 3. Keeping
that boundary sharp stops gate 2 becoming a second, worse test suite.

### 4. Checkpoint plan

**Right-sizing:** the smallest slice that passes its gates independently and
could be meaningfully rejected while its neighbor is approved. Setup, config and
scaffolding fold into the checkpoint whose deliverable needs them.

**Ordering is forced, not preferred:**
- a core design-system extension is checkpoint zero and blocks on its PR merging
- migrations and collections precede anything querying them
- screens precede the e2e driving them

**Each checkpoint carries:** exact files to create and modify; an interfaces
block naming what it consumes and produces with real types (each is built by a
fresh subagent that sees only its own checkpoint); which gates apply (gate 2
only where something renders); the region of the visual reference it is
accountable to; its test obligations.

**No placeholders.** No "TBD", no "add appropriate error handling", no "similar
to checkpoint N", no references to types no checkpoint defines. A checkpoint
that says what to do without showing how is a plan failure.

Self-reviewed against the spec — every requirement maps to a checkpoint, types
and names are consistent across checkpoints — and fixed inline.

Before the human sees the plan, `plan-check.mjs` must exit clean (verbatim
coverage of every Behavior bullet, no Cut item present, no placeholders,
required blocks, interface names) and then one fresh subagent reviews it
against the spec: the checkpoint text is where scope quietly narrows, and gate-3
reviewers compare code to the *checkpoint*, so a narrowed checkpoint is
invisible to them. The human is then shown the plan file path (they may edit
it directly; the skill re-reads it after approval) plus, per checkpoint, the
quoted spec bullets and test obligations. **Then the skill asks once whether
to insert a mid-run stop**, with a computed recommendation: none, after the first checkpoint that renders
something, or at a named checkpoint. Complex features want one; simple ones do
not. Asked at this moment because the human has just seen the mockups and the
decomposition, and so has the best information to judge. It does not ask again;
if a stop is taken and everything looks right, it continues unattended.

### 5. The loop

Per checkpoint, a fresh implementer subagent sees only: its own checkpoint, the
interfaces block, the spec, and the lessons file. Never the session history.

Three gates run per checkpoint, in order, cheapest first, so a gate 1 failure
does not cost two reviewer dispatches. Human approval is deliberately *not* a
per-checkpoint gate — it happens once, at the end (step 6), with the optional
mid-run stop from step 4 as the only exception. **All three are hard** — a
checkpoint that cannot pass does not commit, and the run stops rather than
proceeding degraded.

**Gate 1 — Tests.** `pnpm exec tinycld-pkg check` in the package (biome, tsc,
vitest) plus Playwright where the checkpoint touches it. Failures are diagnosed
and fixed at the source. Never re-run, never bump a timeout, never force serial,
never skip. If the fix is genuinely out of scope the run stops and surfaces it;
it does not proceed to gate 2.

**Gate 2 — Visual.** Only where something renders. The capture spec (guarded
by `HELIX_CAPTURE=<manifest.json>` so ordinary suites skip it; driven by a
JSON manifest of shots so nothing is hand-written per checkpoint) runs
through the package's own e2e stack — whose seeded DB now carries the fixture — and screenshots the built
screen per state, width, and color scheme. The built set must match the
reference set's file count. Comparison is a judgment rather than a pixel
score, since the reference is a mockup and some divergence is correct, but
the ledger records one concrete observation per screenshot pair — never a
blanket "minor differences". Appearance only.

**Gate 3 — Two adversarial reviewers**, dispatched in parallel with deliberately
different mandates, neither seeing the other's findings:
- correctness and silent failures
- design-system and CLAUDE.md conformance (semantic tokens not hex, pbtsdb not
  raw PocketBase, no cross-package imports, no `useState`/`useEffect` where a
  better primitive exists, no biome-ignore comments)

Reviewer B also hunts web-only APIs (no gate executes native, and the final
review says so outright), migration access rules and immutability, core
isolation for checkpoint 0, and help-body accuracy. Reviewer A maps every
test obligation to an assertion that would fail if the behavior broke. Both
run the **deferral hunt** (below) and flag any file the checkpoint's Files
block did not name. Reviewers see the staged diff of exactly this
checkpoint's work, assembled by `review-diff.mjs`, which also lists the
out-of-plan files for them.

Findings are triaged by the skill rather than applied blindly. A rebuttal must
quote the spec, the checkpoint, the code, or a codebase rule; a rebuttal of a
deferral finding must quote the checkpoint text showing the thing was never
asked for. **Every rebuttal is shown to the human at the end.** Any fix that
touches non-test source gets one fresh reviewer-A pass over the fix diff —
a bright line, not a judgment call.

Gate 3 does not adapt or weaken. With human approval moved to the end there is
no per-checkpoint signal to learn from, and two reviewers every checkpoint is
the price of running unattended.

Then commit — one per checkpoint — update the ledger, and start the next. If
this checkpoint is the agreed mid-run stop, present what has been built so far
and wait; otherwise continue unattended.

**When the run stops** — a gate cannot be passed, an out-of-scope fix is
required, or a deferral needs a human decision — committed checkpoints stay
committed, the ledger records why and is committed alone, and the incomplete
checkpoint's work is left in the working tree rather than committed or
discarded. The human decides whether to resume, revise the spec, or abandon;
a resume hands the next implementer the in-progress diff and needs no
screenshot. The skill never reaches the end by lowering a bar.

### Deferrals

A deferral is anything agreed in the spec or checkpoint that was not built as
specified: a stubbed function, a skipped edge case, a simplified query, a test
asserting less than required, a TODO.

Deferrals are permitted only for genuine blockers. A missing upstream
dependency may remain a deferral while the run continues; a decision only the
human can make **stops the run**, because building further checkpoints on a
guess is the one failure the mid-run stop cannot catch. **Difficulty is never
a reason.**
An implementer that finds a checkpoint hard implements it anyway or stops the
run. This is stated plainly in the implementer's instructions, because
implementers (like humans) will otherwise route around hard problems.

They are tracked as first-class findings:
- gate 3 reviewers hunt for them explicitly — a fresh reviewer reading the
  checkpoint against the diff is exactly who notices that the code does less
  than the checkpoint asked
- the implementer must also self-declare them
- self-declared and reviewer-caught are recorded separately; the gap is itself
  signal, since a silent deferral is a different problem from a flagged one
- each records what was agreed, what was built instead, the stated reason, and
  the checkpoint

### 6. Final review and PR

After `finish.mjs` (scratch files removed, routes regenerated, nothing
references them, lessons capped, full check, full e2e), one presentation:
- **deferrals first and prominent**, with reasoning. A clean run states "no
  deferrals" explicitly, so the absence is informative.
- every rebuttal, verbatim; every out-of-plan file change
- "native: not executed in this run"
- what was built, per-checkpoint gate results, full visual comparison
- approve / corrections / abandon

Then, after approval: lessons distilled (from the ledger *and* the human's
comments — so they are written after the review, not before), the seed
keep-or-revert decision with its consequence stated, PR opened against the
package repo. Short description per user
preference — what the feature does, plus the deferral list. No Claude
attribution, no session links.

## Memory across runs

**Ledger** (`<feature>-ledger.md`) — one run's raw history. Gate outcomes,
findings and triage, rebuttals, deferrals, visual notes. Retained.

**Lessons** (`helix-lessons.md`) — distilled carry-forward, read by every
implementer and reviewer at the start of every checkpoint. Written at the end of
a run from its findings plus the human's final-review comments.

Package-scoped, not ecosystem-wide: the global CLAUDE.md already serves as the
ecosystem lessons file, and a second competing one would drift from it.
**Capped** at 30 lines — the skill prunes rather than appending forever, since
an unbounded lessons file reproduces the problem it solves. Pruning order:
lines the code or CLAUDE.md now state on their own, then rebuttal-derived
lines, then lines no run has needed since. Human corrections are never
dropped to keep a reviewer nit. Rebuttals become lessons only after the
human has seen and not overturned them.
