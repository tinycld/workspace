# Helix Skill — Design

**Status:** approved design, not yet implemented
**Skill location:** `~/.claude/skills/helix/`

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
    checkpoints.md      # decomposition + plan format + ledger
    gates.md            # the three per-checkpoint gates, reviewer mandates,
                        # deferral rules, stop-the-run conditions
```

The one outward reach is gate 3, which dispatches `pr-review-toolkit` agents.
Those are agent definitions rather than skill flows, so there is no flow to
inherit or override.

## Artifacts

All live in the target package's own repo, versioned with the code:

```
<package>/docs/specs/<feature>-design.md        # agreed behavior
<package>/docs/plans/<feature>-checkpoints.md   # the decomposition
<package>/docs/plans/<feature>-ledger.md        # full run history (retained)
<package>/docs/helix-lessons.md                 # durable, capped, carried forward
```

Only the scratch mockup route is deleted before the PR. The ledger is retained —
it is the detailed run history; the PR is only a summary.

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
with it. At the end of the run the skill *offers* to promote it to the package's
manifest `seed`; seed data ships to real deployments, so it is never assumed.

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

The human approves the checkpoint list. **Then the skill asks once whether to
insert a mid-run stop:** none, after the first checkpoint that renders
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

**Gate 2 — Visual.** Only where something renders. Playwright drives the running
app to the real screen with the fixture data, screenshots per breakpoint, and
compares against the corresponding region of the fidelity reference. Appearance
only — layout, spacing, type, token usage, light and dark. Reported as a
judgment rather than a pixel score, since the reference is a mockup and some
divergence is correct. The skill states what differs and whether it matters.

**Gate 3 — Two adversarial reviewers**, dispatched in parallel with deliberately
different mandates, neither seeing the other's findings:
- correctness and silent failures
- design-system and CLAUDE.md conformance (semantic tokens not hex, pbtsdb not
  raw PocketBase, no cross-package imports, no `useState`/`useEffect` where a
  better primitive exists, no biome-ignore comments)

Both also run the **deferral hunt** (below). Findings are triaged by the skill
rather than applied blindly; a wrong finding is rebutted in the ledger with
reasoning.

Gate 3 does not adapt or weaken. With human approval moved to the end there is
no per-checkpoint signal to learn from, and two reviewers every checkpoint is
the price of running unattended.

Then commit — one per checkpoint — update the ledger, and start the next. If
this checkpoint is the agreed mid-run stop, present what has been built so far
and wait; otherwise continue unattended.

**When the run stops** — a gate cannot be passed, or an out-of-scope fix is
required — committed checkpoints stay committed, the incomplete checkpoint's
work is left in the working tree rather than committed or discarded, and the
ledger records why. The human decides whether to resume, revise the spec, or
abandon. The skill never reaches the end by lowering a bar.

### Deferrals

A deferral is anything agreed in the spec or checkpoint that was not built as
specified: a stubbed function, a skipped edge case, a simplified query, a test
asserting less than required, a TODO.

Deferrals are permitted only for genuine blockers — a missing upstream
dependency, a decision only the human can make. **Difficulty is never a reason.**
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

One presentation, at the end:
- **deferrals first and prominent**, with reasoning. A clean run states "no
  deferrals" explicitly, so the absence is informative.
- what was built, per-checkpoint gate results, full visual comparison

Then: scratch route deleted, fixture promotion to seed data offered, lessons
distilled, PR opened against the package repo. Short description per user
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
**Capped** — the skill prunes and rewrites rather than appending forever, since
an unbounded lessons file reproduces the problem it solves.
