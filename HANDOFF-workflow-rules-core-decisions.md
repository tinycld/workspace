# Handoff: workflow rules — two open core decisions (2026-08-15)

The package rollout is done: **21 triggers / 12 actions across eight
packages**, up from 2 and 2. Nine PRs merged (tinycld #189/#190–192/#195, mail
#62, contacts #30, calendar #33, drive #59/#60, text #54, calc #55). One is
still open — cards #31, blocked on an unrelated e2e problem tracked in
`HANDOFF-cards-e2e-slow-tests.md`.

What remains are two decisions in core that the rollout surfaced but
deliberately did not make, plus one deferred action. They interact, so they
are written up together.

---

## 1. Native actions cannot declare a relation param

**What it is.** A `native` action cannot offer a record picker. Declaring one
anyway produces a permanently empty dropdown, with no error at build time.

Two independent locks:

- `NativeActionDef.params` is `TypedParamDef[]`, and `TypedParamDef` is
  `{ key, type, label?, options? }` — **no `field`**. Only `ColumnParamDef`
  (record-ops only) can name a column.
- Even given a `field`, `resolveParam` (`core/server/automation/catalog.go`)
  fills `RelationTarget` only when `p.Field != "" && col != nil`, and
  `resolveAction` leaves `col` nil for every native action — a native action
  declares no collection. The param falls to the typed branch, which never
  sets `RelationTarget`.

**Why it is nasty.** `type: 'relation'` typechecks and passes
`packages:generate`. It fails only at runtime: `RelationTarget` stays `""`,
`RelationRecordPicker` calls `collectionByName('')`, the query no-ops *by
design*, and the user gets a menu with nothing in it.

**Who it blocks.** Six unbuilt actions:

| Action | Wants a relation param for |
|---|---|
| `cards:create-card` | destination list |
| `cards:add-assignee` | the user |
| `cards:add-label` | the label |
| `cards:set-due-date` | (date math; native regardless) |
| `drive:share-with-user` | the recipient |

Worked around twice already: `calendar:create-event` drops the `calendar`
param and resolves the owner's own calendar instead. By contrast
`drive:move-to-folder` gets a real folder picker **because it is a record-op**
— its param names the real `parent` column.

**Likely fix.** ~a dozen lines: let `TypedParamDef` carry an explicit
`relationTarget` and have `resolveParam` pass it through.

**The catch.** It restores the ergonomics but not the safety — see below.

---

## 2. The native-action pkgaccess gap — and why the obvious fix is wrong

**What it is.** `ExecuteAction` returns from the `Kind == "native"` branch
*before* `checkPersonalAccess` runs, so the pkgaccess floor applies to
record-ops only. 7 of the 12 shipped actions are native; each self-enforces.

**The obvious fix — move `checkPersonalAccess` above the native branch — is
not the fix.** This is a correction to earlier advice in the rollout plan,
and the rollout's own evidence is what changed it.

`checkPersonalAccess` → `pkgaccess.WriteError` answers one question: *may this
user write to this package at all* (full / readonly / none, per user per
package slug). It says nothing about **which record**.

Every real bug this rollout produced in a native handler was a *which-record*
bug, all three caught in review, all three now on `main`:

| Fix | The actual defect |
|---|---|
| `applyToAudience` (mail) | aborted on the first per-user failure, half-applying an org rule across a shared mailbox |
| `ruleRecipient` (mail) | forwarded to the mailbox's own address/aliases — a self-feeding loop, reachable because `{{sender_email}}` is a documented recipe |
| `writableCalendarRoles` (calendar) | created events on a calendar the rule owner was only a **viewer** on |

**`pkgaccess` would have caught none of them.** In all three the owner had full
package write access; the error was *where inside the package* they wrote.

So moving the check adds a gate that passes cleanly while the real hole stays
open — and it makes things worse in one specific way. Today the registry doc
says plainly: *"a native handler must self-enforce any access control it
needs, the engine does not gate it for you."* That is unambiguous. A partial
gate upstream invites the next author to read "the engine checks this now".

Secondary points, weaker but real:

- Actions that deliberately act as something other than the rule owner (on
  behalf of a board or mailbox) would newly be gated on the *owner's* package
  access, which may not be what they mean. Core-owned actions are exempt via
  the `pkg == "core"` early return, so `core:notify` / `core:send-email` are
  unaffected either way.
- Handlers already receive `req.OwnerID` and can call `pkgaccess.WriteError`
  in one line. It was never hard — only easy to forget.

**Options, least to most work:**

1. **Move it anyway**, and land a registry-doc change in the same commit
   saying explicitly that it is a package-level floor which does NOT replace
   record-level checks. Cheap; only honest if the doc lands with it.
2. **Strengthen the contract instead** — e.g. have `RegisterAction` take an
   explicit audience/authorization resolver, so the type system asks the
   question a comment currently asks. More work; addresses the actual failure
   mode.
3. **Leave it.** Four packages now ship working reference implementations —
   `actionAudience` (mail), `ownedCalendarFor` (calendar),
   `driveshare.ParticipantIDs` (text/calc), `cardOwnerResolver` (cards) —
   which is arguably better guidance than a partial gate.

On the rollout's evidence (three record-level bugs, zero package-level ones),
**(2) or (3)** look better than (1).

**Decide this together with #1.** Restoring relation params hands native
handlers caller-supplied record ids — exactly the input that needs
record-level authorization. Fixing the picker without settling this makes the
gap easier to hit.

---

## 3. Deferred: `core:webhook`

Not built. It is new outbound-HTTP capability with no precedent in core, so it
needs SSRF guards — lift `validateICSURL` / `isDisallowedIP` out of
`calendar/server/subscription.go`. The rollout plan itself suggests deferring
it, and it should be its own reviewed change rather than riding along with
additive catalog work.

---

## Reference: what the rollout established

Worth knowing before touching any of the above.

- **Ingress must finish before it fires a trigger.** Rules dispatch on
  `OnRecordAfterCreateSuccess`; outside a transaction that fires mid-function
  and races the ingress's own remaining writes. Cost mail a silent bug where
  a rule logged `status: "ok"` with no visible effect. Fixed in mail and
  calendar, documented in `tinycld/docs/automation.md`, and now step 0 of the
  per-package recipe.
- **Assert the visible effect in e2e, not the `rule_runs` row.** That row
  survives both failure modes above.
- **Auto-detection being available does not make it right.** text/calc's
  `author` column auto-detects perfectly and produces the wrong feature —
  "when I comment" instead of "when someone comments on my document".
