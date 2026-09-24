# User Groups: Drive Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Share a drive item (and so any text or calc document) with a group, using the core groups mechanism, with the same guarantees boards has.

**Architecture:** `drive_shares` gains an optional `group` relation and an optional `user`. A grant row (`group` set, `user` empty) is written by the item creator from the share dialog through core's `useGroupGrants`; core's Go `groups` service expands it into one derived row per member (both set), which the existing `drive_shares_via_item.user` rules, `driveshare.ResolveRole`, WebDAV and realtime already honour. Rules on `drive_shares` deny client writes to derived rows and the owner role on grants. The Go share endpoints stop treating a derived row as an existing direct share.

**Tech Stack:** PocketBase 0.39 (forked, Go 1.26), JS migrations, pbtsdb + TanStack DB, Expo/React Native, Vitest, Playwright, Go `testing` + `rlstest`.

**Spec:** `docs/superpowers/specs/2026-09-23-user-groups-design.md` (section "Package integrations", Drive). **Reference integration:** boards, on branch `user-groups`: `boards/pb-migrations/2040000001_group_grants_on_members.js`, `boards/server/register.go`, `boards/server/group_grants_rls_test.go`, `boards/tinycld/boards/hooks/useProjectGroupGrants.ts`, `boards/tinycld/boards/components/sharing/ShareDialog.tsx`, `boards/tests/e2e/board-group-sharing.spec.ts`.

## Global Constraints

- **Prerequisite:** the core checkout `~/code/tinycld/tinycld` must be on branch `user-groups` (it holds `core/server/groups`, `core/lib/groups`, `core/components/groups`). Check with `git -C ~/code/tinycld/tinycld branch --show-current` before every task. Do not switch it without the owner's say-so; if it is on another branch, stop and report.
- Repo: `~/code/tinycld/drive` (own git repo). Branch name **`user-groups`** (drive CI resolves core by the PR branch name).
- Membership row kinds on `drive_shares`: direct (`user` set, `group` empty), grant (`user` empty, `group` set, client-written), derived (both set, written only by core Go). A grant never carries `role = "owner"`. Guests are never group members.
- Rules change on `drive_shares` only. The live rules are in `pb-migrations/1782000000_exclude_disabled_from_drive.js` (creator-only management); restate them verbatim there and append the new clauses. Rules on `drive_items`, `drive_item_versions`, `drive_share_links`, `drive_item_state`, `comment_mentions`, `text_comments`, `calc_comments` stay untouched; they test `drive_shares_via_item.user`, which derived rows satisfy.
- PocketBase rule traps: on **update** a bare field is the STORED value and only `@request.body.x` sees the body; `?=` conditions along one relation path correlate to one joined row; `@request.auth.disabled != true`, never `= false`; name write roles explicitly.
- A shipped migration is immutable. New file: `pb-migrations/2040000002_group_grants_on_shares.js` (must sort after core's `2040000000_create_groups.js`; the merged install directory is filename-sorted).
- `groups.RegisterGrantTable` requires a unique index on `(item, user, group)`.
- Data access only via pbtsdb (`useStore`, `useLiveQuery`, `useMutation`); core's `useGroupGrants` does the grant writes. E2E drives the UI for every write.
- Style: biome (4-space indent, single quotes, ES5 trailing commas, no semicolons); never `any`; never `biome-ignore`; JSX minimal, logic in hooks; conditional children via `isVisible` props returning `null`; comments explain why; no `console.*`; imports `~/tinycld/drive/*` or relative, never `../../tinycld/...`.
- Go tests with `-count=1` after any rule change. Drive Go suite: `cd ~/code/tinycld/drive/server && go test -count=1 ./...`.
- Quality gate: `cd ~/code/tinycld/drive && pnpm exec tinycld-pkg check` (biome + tsc + vitest). Fix every error it reports.
- Regenerate types after adding the migration: `cd ~/code/tinycld/tinycld && pnpm run packages:generate` (adds `group` to `DriveShares` in `tinycld/core/types/pbSchema.ts`).
- Commits: conventional-commit subjects; no mention of Claude or any AI tool. Text and calc need no code change: they lazy-load drive's `ShareDialog`.
- Release note (not a task): drive's `manifest.ts` pins `'@tinycld/core': '>=0.5.1 <0.6.0'`; the release bumps it to `>=0.6.0 <0.7.0` alongside boards.
- Known consequences, accepted: `notifyDriveShare` fires once per derived row, so every member gets a "shared with you" notice (desired). The `file-shared` automation trigger fires for the grant row and each derived row.

## File Structure

| Path | Responsibility |
|---|---|
| `pb-migrations/2040000002_group_grants_on_shares.js` | `group` field, optional `user`, index, rules |
| `server/groups_stub_test.go` | `stubGroupsCollection` fixture helper shared by every migration-applying test |
| `server/guest_rls_test.go`, `server/automation_test.go`, `server/comment_mentions_adapt_test.go` | call the stub before `rlstest.Apply` |
| `server/shipped_rules_test.go` | literal-clause assertions for `drive_shares` (new file) |
| `server/group_grants_rls_test.go` | API tests for the three row kinds and rule correlation |
| `server/register.go` | `groups.RegisterGrantTable` |
| `server/endpoints_share.go`, `server/endpoints_share_otp.go` | existing-share lookups ignore derived rows |
| `server/endpoints_share_otp_test.go`, `server/search_disabled_test.go` | hand-built `drive_shares` fixtures gain `group` |
| `tinycld/drive/collections.ts` | `group` relation |
| `tinycld/drive/lib/share-roles.ts` | `GROUP_ROLE_OPTIONS` (editor, commentor, viewer) |
| `tinycld/drive/hooks/use-share-data.ts` | direct shares only; `canManage` |
| `tinycld/drive/hooks/use-item-group-grants.ts` | drive wrapper around core `useGroupGrants` |
| `tinycld/drive/hooks/useDriveMutations.ts` | `getSharesForItem` direct only |
| `tinycld/drive/components/ShareDialog.tsx` | render `GroupShareSection` |
| `tests/use-share-data.test.tsx` | filter + canManage unit test |
| `tests/drive-group-sharing.spec.ts` | e2e |
| `help/sharing.md` | groups section |

---

### Task 1: Migration, fixtures and rule tests

**Files:**
- Create: `server/groups_stub_test.go`
- Modify: `server/guest_rls_test.go` (`setupDriveGuestApp` or `applyDriveRules`), `server/automation_test.go` (`setupFileAddedApp`), `server/comment_mentions_adapt_test.go` (the `rlstest.Apply` call site)
- Create: `server/shipped_rules_test.go`
- Create: `server/group_grants_rls_test.go`
- Create: `pb-migrations/2040000002_group_grants_on_shares.js`

**Interfaces:**
- Produces: `drive_shares.group` (relation → `pbc_groups_01`, cascade), `user` optional, unique index `(item, user, group)`, rules per this task.
- Produces: `stubGroupsCollection(t testing.TB, app core.App)` and `driveGroup(t, app, name) *core.Record` helpers.

- [ ] **Step 1: Shared groups stub for the fixtures**

`server/groups_stub_test.go`:

```go
package drive

import (
	"testing"

	"github.com/pocketbase/pocketbase/core"
)

// stubGroupsCollection creates the core `groups` collection with the id that
// 2040000002 names as the relation target. The fixtures are bare test apps
// that apply only drive's migrations, so core's collection has to exist
// before the relation field can be saved.
func stubGroupsCollection(t testing.TB, app core.App) {
	t.Helper()
	if _, err := app.FindCollectionByNameOrId("groups"); err == nil {
		return
	}
	groups := core.NewBaseCollection("groups")
	groups.Id = "pbc_groups_01"
	groups.Fields.Add(&core.TextField{Name: "name", Required: true})
	if err := app.Save(groups); err != nil {
		t.Fatalf("stub groups collection: %v", err)
	}
}

func driveGroup(t testing.TB, app core.App, name string) *core.Record {
	t.Helper()
	col, err := app.FindCollectionByNameOrId("groups")
	if err != nil {
		t.Fatalf("find groups: %v", err)
	}
	g := core.NewRecord(col)
	g.Set("name", name)
	if err := app.Save(g); err != nil {
		t.Fatalf("save group: %v", err)
	}
	return g
}
```

In `guest_rls_test.go`, `automation_test.go` and `comment_mentions_adapt_test.go`, call `stubGroupsCollection(t, app)` immediately before each `rlstest.Apply(t, app, rlstest.MigrationsDir(t, "../pb-migrations"))`. In `guest_rls_test.go` the right place is inside `applyDriveRules` (which `disabled_rls_test.go` also uses).

- [ ] **Step 2: Shipped-rules test (red)**

`server/shipped_rules_test.go`, modelled on `boards/server/shipped_rules_test.go`:

```go
package drive

import (
	"testing"

	"tinycld.org/core/rlstest"
)

// The drive_shares rules are asserted as literals so an edit that weakens a
// clause fails here, not in production. Grant rows (group set, user empty)
// are client-written; derived rows (both set) are core's and must be
// untouchable through the API.
func TestDriveSharesShippedRules(t *testing.T) {
	env := setupDriveGuestApp(t)
	applyDriveRules(t, env.app)

	cases := []struct{ kind, clause string }{
		{"list", `@request.auth.disabled != true`},
		{"view", `@request.auth.disabled != true`},
		{"create", `item.created_by ?= @request.auth.id`},
		{"create", `(user = "" || group = "")`},
		{"create", `(group = "" || role != "owner")`},
		{"update", `(user = "" || group = "")`},
		{"update", `(group = "" || @request.body.role:isset = false || @request.body.role != "owner")`},
		{"update", `(@request.body.item:isset = false || @request.body.item = item)`},
		{"update", `(@request.body.user:isset = false || @request.body.user = user)`},
		{"update", `(@request.body.group:isset = false || @request.body.group = group)`},
		{"delete", `(user = "" || group = "")`},
	}
	for _, c := range cases {
		rlstest.RequireRuleContains(t, env.app, "drive_shares", c.kind, c.clause)
	}
}
```

- [ ] **Step 3: RLS tests for the row kinds (red)**

Read `server/guest_rls_test.go` first: `setupDriveGuestApp` returns `env.app`, `env.member`, `env.guest`, `env.memberToken`, `env.guestToken`; `driveGuestUser(t, app, email, role)` makes a user; `shareItemWith(...)` makes an item plus a share (read its signature). Requests are made with `tests.ApiScenario` (see `runListScenario` and neighbours); one scenario per Test function.

`server/group_grants_rls_test.go` (adapt the request-runner to the file's existing helper; the shape below states the contract):

```go
package drive

import (
	"net/http"
	"testing"

	"github.com/pocketbase/pocketbase/core"
)

// Fixture: creator owns an item; viewer holds a direct viewer share; a group
// "keepers" exists. Grants are creator-only under the drive_shares rules.
type groupGrantEnv struct {
	*driveGuestEnv
	creator, viewer           *core.Record
	creatorToken, viewerToken string
	item                      *core.Record
	group                     *core.Record
}

func setupGroupGrantEnv(t *testing.T) *groupGrantEnv {
	t.Helper()
	base := setupDriveGuestApp(t)
	applyDriveRules(t, base.app)
	creator := driveGuestUser(t, base.app, "creator@test.local", "member")
	viewer := driveGuestUser(t, base.app, "viewer@test.local", "member")
	item := makeDriveItem(t, base.app, creator, "plans.txt") // use the file's existing item helper name
	makeDirectShare(t, base.app, item, viewer, "viewer", creator)
	group := driveGroup(t, base.app, "keepers")
	ct, _ := creator.NewAuthToken()
	vt, _ := viewer.NewAuthToken()
	return &groupGrantEnv{driveGuestEnv: base, creator: creator, viewer: viewer, creatorToken: ct, viewerToken: vt, item: item, group: group}
}

// makeDirectShare / makeDerivedShare write rows the way the client / core do.
func makeDirectShare(t *testing.T, app core.App, item, user *core.Record, role string, creator *core.Record) *core.Record { /* item, user, role, created_by, group "" */ }
func makeGrant(t *testing.T, app core.App, item, group *core.Record, role string, creator *core.Record) *core.Record { /* item, group, role, created_by, user "" */ }
func makeDerived(t *testing.T, app core.App, item, group, user *core.Record, role string, creator *core.Record) *core.Record { /* both set */ }

func TestGroupGrants_CreatorCreatesViewerGrant(t *testing.T)          { /* POST drive_shares {item, group, role: viewer, created_by} as creator → 200 */ }
func TestGroupGrants_CreatorCannotGrantOwner(t *testing.T)            { /* same with role owner → 400 */ }
func TestGroupGrants_NobodyCreatesDerivedRowViaAPI(t *testing.T)      { /* POST with user AND group set as creator → 400 */ }
func TestGroupGrants_ViewerCannotCreateGrant(t *testing.T)            { /* POST grant as viewer → 400 (creator-only) */ }
func TestGroupGrants_CreatorCannotPromoteGrantToOwner(t *testing.T)   { /* seed grant viewer; PATCH {role: owner} as creator → 404; stored role still viewer */ }
func TestGroupGrants_CreatorMayReroleGrantToEditor(t *testing.T)      { /* PATCH {role: editor} → 200; stored editor */ }
func TestGroupGrants_CreatorCannotRepointGrant(t *testing.T)          { /* PATCH {group: other} → 404 */ }
func TestGroupGrants_DerivedRowIsReadableByItsUserAndUntouchable(t *testing.T) {
	// seed derived row for viewer2 (a third user) via makeDerived (superuser context)
	// GET drive_items/{item} as viewer2 → 200 (derived row grants access)
	// PATCH drive_shares/{derived} {role: editor} as creator → 404
	// DELETE drive_shares/{derived} as creator → 404
	// DELETE drive_shares/{derived} as viewer2 (own recipient row) → 404
}
func TestGroupGrants_EditorGrantDoesNotLiftAViewer(t *testing.T) {
	// Correlation guard (trap 4): seed an editor GRANT row (user "") on the item.
	// PATCH drive_items/{item} {name: "x"} as viewer → 404: the viewer's own row
	// is the one the rule correlates on, not the grant row.
}
```

Fill each body with the file's request helper. Status contract: create refused → 400; view/update/delete refused → 404.

- [ ] **Step 4: Run to verify failure**

Run: `cd ~/code/tinycld/drive/server && go test -count=1 ./ -run 'TestDriveSharesShippedRules|TestGroupGrants_' -v 2>&1 | tail -30`
Expected: FAIL (`group` field unknown; clauses absent).

- [ ] **Step 5: Write the migration**

`pb-migrations/2040000002_group_grants_on_shares.js`:

```js
/// <reference path="../../tinycld/server/pb_data/types.d.ts" />
//
// Group grants on drive_shares.
//
// A row is one of three kinds, told apart by two fields:
//   direct  — user set, group empty  (every row before this migration)
//   grant   — user empty, group set  (client-written: "share with this group")
//   derived — both set               (core Go expands a grant into one row per
//                                     member; server-owned, never client-written)
// Every other collection's rules test `drive_shares_via_item.user`, so a
// derived row grants access exactly like a direct one and a grant row (no
// user) never matches. Nothing outside this collection changes. See
// core/server/groups. Numbered above core's 2040000000_create_groups.js
// because the merged install directory is filename-sorted.
//
// Rules are restated verbatim from 1782000000 with the new clauses appended,
// never read back off the collection (shipped_rules_test.go asserts literals).
migrate(
    app => {
        const shares = app.findCollectionByNameOrId('drive_shares')

        shares.fields.getById('drv_shares_user').required = false

        shares.fields.addAt(
            shares.fields.length,
            new Field({
                id: 'drv_shares_group',
                name: 'group',
                type: 'relation',
                required: false,
                collectionId: 'pbc_groups_01',
                cascadeDelete: true,
                maxSelect: 1,
            })
        )

        shares.indexes = [
            ...shares.indexes.filter(idx => !idx.includes('idx_drv_shares_unique')),
            'CREATE UNIQUE INDEX `idx_drv_shares_unique` ON `drive_shares` (`item`, `user`, `group`)',
            'CREATE INDEX `idx_drv_shares_group` ON `drive_shares` (`group`)',
        ]

        const enabled = '@request.auth.disabled != true'
        const ownShareRecipient = 'user = @request.auth.id'
        const isItemCreator = 'item.created_by ?= @request.auth.id'
        // A client writes direct rows and grants; derived rows (both set) are
        // core's. A grant never carries owner: driveshare.CheckDelete treats an
        // owner share as delete rights, and ownership stays personal.
        const notDerived = '(user = "" || group = "")'
        const groupNeverOwnerOnCreate = '(group = "" || role != "owner")'
        // On update a bare field is the STORED value, so the owner check must
        // read the body.
        const groupNeverOwnerOnUpdate =
            '(group = "" || @request.body.role:isset = false || @request.body.role != "owner")'
        const pinItem = '(@request.body.item:isset = false || @request.body.item = item)'
        const pinUser = '(@request.body.user:isset = false || @request.body.user = user)'
        const pinGroup = '(@request.body.group:isset = false || @request.body.group = group)'

        shares.listRule = `${enabled} && (${ownShareRecipient} || ${isItemCreator})`
        shares.viewRule = `${enabled} && (${ownShareRecipient} || ${isItemCreator})`
        shares.createRule = `${enabled} && ${isItemCreator} && ${notDerived} && ${groupNeverOwnerOnCreate}`
        shares.updateRule = `${enabled} && ${isItemCreator} && ${notDerived} && ${groupNeverOwnerOnUpdate} && ${pinItem} && ${pinUser} && ${pinGroup}`
        shares.deleteRule = `${enabled} && ${notDerived} && (${ownShareRecipient} || ${isItemCreator})`

        app.save(shares)
    },
    app => {
        const shares = app.findCollectionByNameOrId('drive_shares')

        app.db().newQuery('DELETE FROM drive_shares WHERE `group` != ""').execute()

        shares.fields.removeById('drv_shares_group')
        shares.fields.getById('drv_shares_user').required = true
        shares.indexes = [
            ...shares.indexes.filter(
                idx => !idx.includes('idx_drv_shares_unique') && !idx.includes('idx_drv_shares_group')
            ),
            'CREATE UNIQUE INDEX `idx_drv_shares_unique` ON `drive_shares` (`item`, `user`)',
        ]

        const enabled = '@request.auth.disabled != true'
        const ownShareRecipient = 'user = @request.auth.id'
        const isItemCreator = 'item.created_by ?= @request.auth.id'
        shares.listRule = `${enabled} && (${ownShareRecipient} || ${isItemCreator})`
        shares.viewRule = `${enabled} && (${ownShareRecipient} || ${isItemCreator})`
        shares.createRule = `${enabled} && ${isItemCreator}`
        shares.updateRule = `${enabled} && ${isItemCreator}`
        shares.deleteRule = `${enabled} && (${ownShareRecipient} || ${isItemCreator})`
        app.save(shares)
    }
)
```

Before saving, open `1782000000_exclude_disabled_from_drive.js` and confirm the restated list/view/create/update/delete strings match its `drive_shares` block character for character; if they differ, use the file's strings.

- [ ] **Step 6: Run the drive Go suite**

Run: `cd ~/code/tinycld/drive/server && go test -count=1 ./... 2>&1 | tail -30`
Expected: all PASS, including every new test. If `TestGroupGrants_EditorGrantDoesNotLiftAViewer` fails with 200, stop: the rule engine does not correlate the role clause with the user clause on this path, and the drive_items rules need a subquery form; report BLOCKED with the evidence rather than weakening the test.

- [ ] **Step 7: Regenerate types and commit**

Run: `cd ~/code/tinycld/tinycld && pnpm run packages:generate && grep -n "group" ../drive/tinycld/drive/types.ts | head -3`
Expected: `DriveShares` carries `group: string`.

```bash
cd ~/code/tinycld/drive && git checkout -b user-groups
git add pb-migrations/2040000002_group_grants_on_shares.js server/groups_stub_test.go server/guest_rls_test.go server/automation_test.go server/comment_mentions_adapt_test.go server/shipped_rules_test.go server/group_grants_rls_test.go
git commit -m "feat(drive): group grants on drive_shares"
```

### Task 2: Go registration and share-endpoint lookups

**Files:**
- Modify: `server/register.go`
- Modify: `server/endpoints_share.go` (`handleShare`), `server/endpoints_share_otp.go` (`findOrCreateGuestDriveShare`)
- Modify: `server/endpoints_share_otp_test.go`, `server/search_disabled_test.go` (hand-built `drive_shares` fixtures)
- Create: `server/share_existing_lookup_test.go`

**Interfaces:**
- Consumes: `groups.RegisterGrantTable` from `tinycld.org/core/groups`.

- [ ] **Step 1: Write the failing lookup test**

Both share endpoints ask "does this user already have a share on this item?" with `item = {:item} && user = {:user}`. A derived row now answers yes, so a creator who shares directly with a group member gets nothing written, and the person loses access the moment they leave the group. The lookups must ignore derived rows.

`server/share_existing_lookup_test.go` (use the fixture helpers from Task 1; `handleShare` is exercised through its HTTP route the way `endpoints_share_otp_test.go` drives its handler):

```go
package drive

import (
	"net/http"
	"testing"
)

// A member who already holds a DERIVED row (via a group) must still get a
// DIRECT row when the creator shares with them by name; otherwise leaving
// the group silently revokes a share the creator believes they made.
func TestHandleShare_DerivedRowDoesNotBlockDirectShare(t *testing.T) {
	env := setupGroupGrantEnv(t)
	other := driveGuestUser(t, env.app, "other@test.local", "member")
	makeDerived(t, env.app, env.item, env.group, other, "viewer", env.creator)

	// POST /api/drive/share as creator: {itemId, recipients: [{userId: other.Id}], role: "editor"}
	// (match the request body shape handleShare decodes)
	// expect 200 and a drive_shares row with item, user = other, group = "" and role editor.
	_ = http.StatusOK
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cd ~/code/tinycld/drive/server && go test -count=1 ./ -run TestHandleShare_DerivedRowDoesNotBlockDirectShare -v 2>&1 | tail -20`
Expected: FAIL (no direct row created; the derived row was taken as existing).

- [ ] **Step 3: Register and fix the lookups**

`server/register.go`: add the import `"tinycld.org/core/groups"` and, directly after the `offboard.RegisterReassignable` loop in `registerShared`:

```go
	// Core expands a group grant (group set, user empty) on this table into one
	// derived row per member, inside the same transaction. Every rule in drive,
	// text and calc tests `drive_shares_via_item.user`, so a derived row is a
	// share like any other; driveshare.ResolveRole already takes the highest
	// role across a user's rows.
	groups.RegisterGrantTable(groups.GrantTable{
		Collection:    "drive_shares",
		ResourceField: "item",
	})
```

`server/endpoints_share.go` `handleShare`: change the existing-share filter to

```go
			existing, _ := app.FindFirstRecordByFilter(
				"drive_shares",
				// Direct rows only: a derived row (via a group) must not stop a
				// direct share, or leaving the group would revoke it.
				`item = {:item} && user = {:user} && group = ""`,
				map[string]any{"item": req.ItemID, "user": r.UserID},
			)
```

and set `share.Set("group", "")` is unnecessary (relation default is empty) — leave the insert as is.

`server/endpoints_share_otp.go` `findOrCreateGuestDriveShare`: the same `&& group = ""` on its lookup, same comment. Update the comment that refers to the `(item,user)` unique index to say `(item, user, group)`.

Hand-built fixtures: in `endpoints_share_otp_test.go` and `search_disabled_test.go`, where the test builds a `drive_shares` collection by hand, add an optional relation field `group` pointing at a stub `groups` collection (call `stubGroupsCollection(t, app)` first) so the new filter resolves. Keep their existing assertions.

- [ ] **Step 4: Run the suite**

Run: `cd ~/code/tinycld/drive/server && go build ./... && go vet ./... && go test -count=1 ./... 2>&1 | tail -20`
Expected: PASS. If `tinycld.org/core/groups` does not resolve, run `cd ~/code/tinycld/tinycld && pnpm run packages:generate` (refreshes `server/go.work`) and confirm the core checkout is on `user-groups`.

- [ ] **Step 5: Commit**

```bash
cd ~/code/tinycld/drive && git add server/register.go server/endpoints_share.go server/endpoints_share_otp.go server/endpoints_share_otp_test.go server/search_disabled_test.go server/share_existing_lookup_test.go
git commit -m "feat(drive): register drive_shares as a group grant table"
```

### Task 3: Client — direct-only lists, `canManage`, group grants hook

**Files:**
- Modify: `tinycld/drive/collections.ts`
- Create: `tinycld/drive/lib/share-roles.ts`
- Modify: `tinycld/drive/hooks/use-share-data.ts`
- Modify: `tinycld/drive/hooks/useDriveMutations.ts` (`getSharesForItem`)
- Create: `tinycld/drive/hooks/use-item-group-grants.ts`
- Create: `tests/use-share-data.test.tsx`

**Interfaces:**
- Produces: `GROUP_ROLE_OPTIONS: GroupRoleOption<DriveShareRole>[]` (editor, commentor, viewer); `useShareData(itemId)` returns `{ orgMembers, shares, currentUserId, removeShare, canManage }` where `shares` are direct rows only and `canManage` is `item.created_by === currentUserId`; `useItemGroupGrants(itemId)` returns the spread for `GroupShareSection`.

- [ ] **Step 1: Write the failing test**

`tests/use-share-data.test.tsx` (pattern: `boards/tests/*.mount.test.tsx` and `tinycld/core/tests/unit/delete-account-modal.test.tsx` — mock `@tinycld/core/lib/pocketbase` with `localOnlyCollectionOptions` collections and `@tinycld/core/lib/auth`):

```tsx
// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tinycld/core/lib/auth', () => ({ useAuth: () => ({ user: { id: 'me' } }) }))

vi.mock('@tinycld/core/lib/pocketbase', async () => {
    const { createCollection, localOnlyCollectionOptions } = await import('@tanstack/db')
    const mk = <T extends { id: string }>(id: string, initialData: T[]) =>
        createCollection(localOnlyCollectionOptions({ id, getKey: (r: T) => r.id, initialData }))
    const registry: Record<string, unknown> = {
        users: mk('users', [
            { id: 'me', name: 'Me', email: 'me@x.test', role: 'member' },
            { id: 'u2', name: 'Bo', email: 'bo@x.test', role: 'member' },
        ]),
        drive_items: mk('drive_items', [{ id: 'it1', name: 'plans', created_by: 'me' }, { id: 'it2', name: 'other', created_by: 'u2' }]),
        drive_shares: mk('drive_shares', [
            { id: 's-owner', item: 'it1', user: 'me', group: '', role: 'owner', created_by: 'me' },
            { id: 's-direct', item: 'it1', user: 'u2', group: '', role: 'viewer', created_by: 'me' },
            { id: 's-grant', item: 'it1', user: '', group: 'g1', role: 'viewer', created_by: 'me' },
            { id: 's-derived', item: 'it1', user: 'u2', group: 'g1', role: 'viewer', created_by: 'me' },
        ]),
    }
    return { useStore: (...names: string[]) => names.map(n => registry[n]) }
})

import { useShareData } from '../tinycld/drive/hooks/use-share-data'

function wrapper() {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    return ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
}

afterEach(cleanup)

describe('useShareData', () => {
    it('lists direct shares only and marks the creator as manager', async () => {
        const { result } = renderHook(() => useShareData('it1'), { wrapper: wrapper() })
        await waitFor(() => expect(result.current.shares.length).toBeGreaterThan(0))
        expect(result.current.shares.map(s => s.id).sort()).toEqual(['s-direct', 's-owner'])
        expect(result.current.canManage).toBe(true)
    })

    it('is not manageable by a non-creator', async () => {
        const { result } = renderHook(() => useShareData('it2'), { wrapper: wrapper() })
        await waitFor(() => expect(result.current.canManage).toBe(false))
    })
})
```

Adjust the mocked user shape if `useShareData` reads more from `useAuth()` (open the hook first).

- [ ] **Step 2: Run to verify failure**

Run: `cd ~/code/tinycld/drive && pnpm exec vitest run tests/use-share-data.test.tsx`
Expected: FAIL (`canManage` undefined; grant/derived rows listed).

- [ ] **Step 3: Implement**

`tinycld/drive/collections.ts`: add `group: coreStores.groups` to the `drive_shares` relations.

`tinycld/drive/lib/share-roles.ts`:

```ts
import type { GroupRoleOption } from '@tinycld/core/lib/groups/types'
import type { DriveShareRole } from '../types'

// A group is never an owner: driveshare treats an owner share as delete
// rights, and ownership of a file stays with a person.
export const GROUP_ROLE_OPTIONS: readonly GroupRoleOption<DriveShareRole>[] = [
    { value: 'editor', label: 'Editor' },
    { value: 'commentor', label: 'Commentor' },
    { value: 'viewer', label: 'Viewer' },
]
```

`tinycld/drive/hooks/use-share-data.ts`:
- Add `const [itemsCollection] = useStore('drive_items')` and a live query for the item: `query.from({ item: itemsCollection }).where(({ item }) => eq(item.id, itemId))`, `[itemId]`.
- In the `shares` memo, filter `.filter(s => s.item === itemId && s.group === '')` with the comment `// Direct shares only: grant rows have no user, derived rows are shown under their group.`
- Return `canManage: (itemRows?.[0]?.created_by ?? '') === userId` (the drive_shares rules let only the item creator manage shares, so the client offers management to exactly that person). Extend the `ShareData` interface.

`tinycld/drive/hooks/useDriveMutations.ts` `getSharesForItem`: filter to `group === ''` (direct rows carry the people the creator named; derived rows are shown under their group).

`tinycld/drive/hooks/use-item-group-grants.ts`:

```ts
import { useAuth } from '@tinycld/core/lib/auth'
import { useGroupGrants } from '@tinycld/core/lib/groups/use-group-grants'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { GROUP_ROLE_OPTIONS } from '../lib/share-roles'

/**
 * Group grants on one drive item, ready to spread into GroupShareSection.
 * Core owns the query and the writes; this only says which collection,
 * which item, and how a drive_shares row is built.
 */
export function useItemGroupGrants(itemId: string) {
    const { user } = useAuth()
    const [sharesCollection] = useStore('drive_shares')
    return useGroupGrants({
        collection: sharesCollection,
        roles: GROUP_ROLE_OPTIONS,
        isForResource: row => row.item === itemId,
        buildRow: grant => ({
            ...grant,
            item: itemId,
            created_by: user.id,
        }),
    })
}
```

If `useAuth()` in drive is used with `{ throwIfAnon: false }` in the share dialog's callers, mirror that and use `user?.id ?? ''`. If tsc reports that `buildRow`'s return does not match the collection's insert type, add the missing required field it names; never cast.

- [ ] **Step 4: Check and commit**

Run: `cd ~/code/tinycld/drive && pnpm exec tinycld-pkg check`
Expected: biome clean, tsc clean, vitest PASS including the new test.

```bash
cd ~/code/tinycld/drive && git add tinycld/drive/collections.ts tinycld/drive/lib/share-roles.ts tinycld/drive/hooks/use-share-data.ts tinycld/drive/hooks/useDriveMutations.ts tinycld/drive/hooks/use-item-group-grants.ts tests/use-share-data.test.tsx
git commit -m "feat(drive): direct-only share lists and a group grants hook"
```

### Task 4: Share dialog integration

**Files:**
- Modify: `tinycld/drive/components/ShareDialog.tsx`
- Modify: `tinycld/drive/components/ShareDialogConnected.tsx`

**Interfaces:**
- Consumes: `useItemGroupGrants`, `GROUP_ROLE_OPTIONS`, `GroupShareSection` (`@tinycld/core/components/groups/GroupShareSection`), `canManage` from `useShareData`.

- [ ] **Step 1: Thread `canManage`**

`ShareDialogConnected.tsx`: destructure `canManage` from `useShareData(itemId)` and pass `canManage={canManage}` to `<ShareDialog …>`.

`ShareDialog.tsx`: add `canManage: boolean` to its props. Every other opener of `ShareDialog` (grep `<ShareDialog` in `drive/tinycld`, `text/tinycld`, `calc/tinycld`) must go through `ShareDialogConnected`; if any renders `ShareDialog` directly, list them in the report and pass `canManage` from `useShareData` there too.

- [ ] **Step 2: Render the section**

In `ShareDialog.tsx`:

```ts
import { GroupShareSection } from '@tinycld/core/components/groups/GroupShareSection'
import { useItemGroupGrants } from '../hooks/use-item-group-grants'
import { GROUP_ROLE_OPTIONS } from '../lib/share-roles'
```

Inside the dialog component body, near the other hooks: `const groupGrants = useItemGroupGrants(itemId)`.

In the JSX, directly after the "People with access" block (the `otherShares.map` list, before the "General access" `GeneralAccessSection`), add:

```tsx
                <GroupShareSection {...groupGrants} roles={GROUP_ROLE_OPTIONS} canManage={canManage} />
```

Keep the existing per-row Trash button behaviour for direct rows; do not add client gating beyond `canManage` for the group section (the server rules are the authority for direct rows, as today).

- [ ] **Step 3: Check and commit**

Run: `cd ~/code/tinycld/drive && pnpm exec tinycld-pkg check && cd ~/code/tinycld/text && pnpm exec tinycld-pkg typecheck && cd ~/code/tinycld/calc && pnpm exec tinycld-pkg typecheck`
Expected: all clean (text and calc consume the dialog's props).

```bash
cd ~/code/tinycld/drive && git add tinycld/drive/components/ShareDialog.tsx tinycld/drive/components/ShareDialogConnected.tsx
git commit -m "feat(drive): share a file with a group from the share dialog"
```

### Task 5: E2E — share a file with a group

**Files:**
- Create: `tests/drive-group-sharing.spec.ts`

Drive's Playwright specs live in `tests/` (not `tests/e2e/`). Core helpers come from `@tinycld/core/e2e-helpers`; drive helpers from `./helpers`.

- [ ] **Step 1: Write the spec**

Copy the group helpers from `boards/tests/e2e/board-group-sharing.spec.ts` (`openGroupsSettings`, `createGroupWithCollaborator`, `removeCollaboratorFromGroup`; they close the drawer with the "Close" button before navigating). Then:

```ts
import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import {
    login,
    navigateToPackage,
    signInAsCollaborator,
    TEST_COLLABORATOR_EMAIL,
} from '@tinycld/core/e2e-helpers'
import { driveItem, revealDriveRow } from './helpers'

// Group sharing end to end, all through the UI: owner creates a group holding
// the collaborator, creates a folder, shares it with the group as Viewer; the
// collaborator sees it under Shared with me; the owner removes the
// collaborator from the group; after a remount the folder is gone.
// Share FIRST, sign the collaborator in AFTER: realtime does not announce a
// newly-visible item. Never page.reload(); remount via navigateToPackage.

// (paste openGroupsSettings / createGroupWithCollaborator / removeCollaboratorFromGroup here)

async function createFolderViaUI(page: Page, name: string) {
    // Reuse the "New folder" flow from tests/drive-2-actions.spec.ts verbatim
    // (button label, name input, confirm). If drive has no UI flow for a new
    // folder, use createDriveItem from ./helpers and say so in the spec header:
    // that helper is the established fixture path for drive specs.
}

async function shareItemWithGroup(page: Page, name: string, groupName: string) {
    const row = await revealDriveRow(page, name)
    await row.click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Share' }).click()
    await expect(page.getByTestId('share-dialog')).toBeVisible()
    await page.getByRole('button', { name: 'Add group' }).click()
    await page.getByTestId('group-picker-role-viewer').click()
    await page.getByTestId('group-picker-search').fill(groupName)
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(page.getByTestId('group-share-section').getByText(groupName)).toBeVisible()
    await expect(page.getByTestId('group-share-section').getByText('1 member')).toBeVisible()
    await page.getByRole('button', { name: 'Done', exact: true }).click()
    await expect(page.getByTestId('share-dialog')).toHaveCount(0)
}

test.describe('Drive — sharing with a group', () => {
    test('group members see the item; leaving the group removes it', async ({ page }) => {
        await login(page)
        const stamp = Date.now()
        const groupName = `Launch crew ${stamp}`
        const folderName = `group-share-${stamp}`

        await createGroupWithCollaborator(page, groupName)

        await navigateToPackage(page, 'drive')
        await createFolderViaUI(page, folderName)
        await shareItemWithGroup(page, folderName, groupName)

        const { page: bobPage, close } = await signInAsCollaborator(page)
        try {
            await navigateToPackage(bobPage, 'drive')
            await bobPage.getByText('Shared with me', { exact: true }).click()
            await expect(driveItem(bobPage, folderName)).toBeVisible()

            await removeCollaboratorFromGroup(page, groupName)

            await navigateToPackage(bobPage, 'settings')
            await navigateToPackage(bobPage, 'drive')
            await bobPage.getByText('Shared with me', { exact: true }).click()
            await expect(driveItem(bobPage, folderName)).toHaveCount(0)
        } finally {
            await close()
        }
    })
})
```

Verify every locator against the source before running: the share menu item label and the dialog's "Done" button text in `ShareDialog.tsx` / `DriveContextMenu.tsx`, the "Shared with me" sidebar label in drive's `sidebar.tsx`, and `share-dialog` (`ShareDialog.tsx`). Adjust to the real strings.

- [ ] **Step 2: Run the spec**

Run: `cd ~/code/tinycld/drive && pnpm exec tinycld-pkg test:e2e -- drive-group-sharing`
Expected: PASS. On failure read the trace and fix the root cause (a locator, or a real UI defect in the owning repo as a separate `fix(...)` commit). Never a timeout bump, retry, reload, or raw PocketBase write. If the web server fails to build because a sibling package is on a branch that does not build against core `user-groups`, stop and report which sibling; do not switch its branch.

- [ ] **Step 3: Commit**

```bash
cd ~/code/tinycld/drive && git add tests/drive-group-sharing.spec.ts
git commit -m "test(drive): e2e for sharing a file with a group"
```

### Task 6: Help, gates, PR

**Files:**
- Modify: `help/sharing.md`

- [ ] **Step 1: Document group sharing**

In `help/sharing.md`, after the "## Adding people" section, add:

```md
## Sharing with a group

Under the list of people in the share dialog is a **Groups** section. Choose
**Add group**, pick a role, and pick a group. Everyone in the group gets that
role on the file, including people who join the group later. Remove the group
or change its role from the same section. Only the file's creator can manage
its groups, the same as its people.

A group can be an editor, commentor or viewer, never an owner. If someone is
shared with directly and also through a group, the stronger role applies.

Text documents and spreadsheets are files, so the same section appears in
their share dialogs. Admins create and manage groups under **Settings →
Groups**; see [Groups](help://core:groups).
```

- [ ] **Step 2: Gates, commit, push, PR**

Run: `cd ~/code/tinycld/tinycld && pnpm run packages:generate && cd ~/code/tinycld/drive && pnpm exec tinycld-pkg check && cd server && go test -count=1 ./... 2>&1 | tail -5`
Expected: all green.

```bash
cd ~/code/tinycld/drive && git add help/sharing.md
git commit -m "docs(drive): sharing a file with a group"
git push -u origin user-groups
gh pr create --title "Share a file with a group" --body "$(cat <<'EOF'
Drive integration for core user groups (core PR #283 and boards PR #108 use the same branch name). Covers text and calc, which use drive's share dialog.

- Migration 2040000002: optional `group` relation on `drive_shares`, `user` optional, unique (item, user, group), rules deny client writes to derived rows and the owner role on grants (create and update)
- `groups.RegisterGrantTable` in `register.go`; share endpoints no longer treat a derived row as an existing direct share
- Share dialog renders core's `GroupShareSection` for the item creator; people list shows direct shares only
- Rule tests, unit test, e2e, help
EOF
)"
```

---

## Self-review notes

- Spec coverage (Drive): `drive_shares` migration + rules (T1), registration (T2), share dialog + direct-only list (T3, T4), e2e and help (T5, T6). `driveshare.go` and `POST /api/drive/share` semantics unchanged apart from the derived-row lookup fix, which the spec's "existing rules and Go mirrors unchanged" goal did not foresee and which is required for correctness.
- Cross-task names: `stubGroupsCollection`, `driveGroup`, `setupGroupGrantEnv`, `makeDirectShare`, `makeGrant`, `makeDerived` (T1) are reused in T2's test. `GROUP_ROLE_OPTIONS`, `useItemGroupGrants`, `canManage` (T3) are consumed in T4.
- Open risk named in T1 step 6: `?=` correlation between the role and user clauses on the drive_items rules with a grant row present. The test decides; a failure is BLOCKED, not a weakened assertion.
