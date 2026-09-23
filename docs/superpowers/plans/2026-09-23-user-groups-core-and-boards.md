# User Groups (core + boards) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admin-managed user groups in core, expanded by a core Go service into per-user membership rows, with boards as the first package that shares a project with a group.

**Architecture:** Core adds `groups` and `group_members` collections plus a Go package `groups` that keeps derived membership rows in registered package tables in sync (inside the triggering transaction, plus a boot reconcile). A package's membership table gets an optional `group` relation; a grant row has `group` set and `user` empty, a derived row has both set and is server-owned. Core exports `useGroupGrants`, `GroupShareSection` and `GroupPicker`; boards wires them into its Share dialog.

**Tech Stack:** PocketBase 0.39 (forked, Go 1.26), JS migrations, pbtsdb + TanStack DB, Expo/React Native, Zod + React Hook Form, Vitest, Playwright, Go `testing` + `tests.NewTestApp` + `rlstest`.

**Spec:** `docs/superpowers/specs/2026-09-23-user-groups-design.md`

## Global Constraints

- Repos: core work is in the `tinycld` repo (`~/code/tinycld/tinycld`, core at `tinycld/core`). Boards work is in `~/code/tinycld/boards`. Use the branch name `user-groups` in both.
- Core must not name a package (no `boards` in `tinycld/core/**`). Core tests use the fictional table `zoo_keepers`.
- Rules in a package's membership table only. Content rules, Go mirrors and realtime do not change.
- A group grant never carries `role = "owner"`. Guests are never group members.
- Membership row kinds: direct (`user` set, `group` empty), grant (`user` empty, `group` set), derived (both set, written only by core Go with superuser context).
- Biome: 4-space indent, single quotes, ES5 trailing commas, no semicolons. Never `any`, never `biome-ignore`, never `console.*` in runtime code. No raw hex colors.
- JSX minimal: logic in hooks and helpers above the return. Conditional children use an `isVisible` prop that returns `null`.
- Data access only through pbtsdb (`useStore`, `useLiveQuery`, `useMyLiveQuery`, `useMutation` from `@tinycld/core/lib/mutations`). E2E drives the UI for every write.
- Never `pnpm install` inside a member. Run `pnpm run packages:generate` from `~/code/tinycld/tinycld` after adding a migration.
- Go tests: `go test -count=1` after any rule change. Core: `cd ~/code/tinycld/tinycld/core/server`. Boards: `cd ~/code/tinycld/boards/server`.
- Quality gate per member: `pnpm exec tinycld-pkg check` (biome + tsc + vitest). Fix every error it reports, whether or not this work caused it.
- Commits: conventional-commit subjects, no mention of Claude.
- Core collection ids are fixed: `groups` is `pbc_groups_01`, `group_members` is `pbc_group_members_01`. Boards' migration and the boards Go test fixture reference `pbc_groups_01` literally.
- Deviation from spec, deliberate: the group delete confirmation does not show a grant count. Core has no client-side view of package tables and a count endpoint would be a data-read endpoint, which the house rules forbid. The confirmation states that every share granted to the group is removed.
- Release note (not a task here): boards' `manifest.ts` pins `'@tinycld/core': '>=0.5.1 <0.6.0'`. Core's groups feature ships as core 0.6.0 and the release process bumps boards' `peerVersions` to `>=0.6.0 <0.7.0`.

## File Structure

Core (`~/code/tinycld/tinycld`):

| Path | Responsibility |
|---|---|
| `core/server/pb_migrations/2040000000_create_groups.js` | `groups` + `group_members` collections, rules, indexes |
| `core/server/groups/registry.go` | grant-table registry, membership listeners, test reset |
| `core/server/groups/expand.go` | derived-row math: expand a grant, sync, remove |
| `core/server/groups/hooks.go` | PocketBase hooks, `Register`, guest guard, `RemoveUserMemberships` |
| `core/server/groups/reconcile.go` | boot reconcile |
| `core/server/groups/*_test.go` | unit tests against `zoo_keepers` |
| `core/server/coreserver/server.go` | wire `groups.Register` into `RegisterSharedCore` |
| `core/server/coreserver/audit.go` | audit registration for both collections |
| `core/server/offboard/offboard.go` | drop memberships during offboard |
| `core/server/coreserver/composition_parity_test.go` | hook-count update |
| `core/lib/pocketbase.ts` | `groups`, `group_members` stores |
| `core/lib/groups/types.ts` | `GroupGrantRow`, `NewGroupGrant`, `GroupRoleOption` |
| `core/lib/groups/use-group-grants.ts` | generic grants hook (query + mutations) |
| `core/lib/groups/use-groups-admin.ts` | admin CRUD hook for the settings page |
| `core/components/groups/GroupPicker.tsx` | searchable group dialog with role choice |
| `core/components/groups/GroupGrantRow.tsx` | one granted group: name, count, role menu, remove |
| `core/components/groups/GroupShareSection.tsx` | section a package drops under its member list |
| `core/components/settings/groups/GroupsList.tsx` | list of groups on the settings page |
| `core/components/settings/groups/GroupDrawer.tsx` | create/rename/members/delete drawer |
| `core/components/settings/members/MemberGroupChips.tsx` | read-only chips in the members drawer |
| `app/a/(app)/settings/groups.tsx` | settings page |
| `app/a/(app)/settings/index.tsx` | nav link |
| `core/help/groups.md` | admin help topic |
| `core/tests/unit/use-group-grants.test.tsx`, `use-groups-admin.test.tsx` | hook tests |

Boards (`~/code/tinycld/boards`):

| Path | Responsibility |
|---|---|
| `pb-migrations/1986000003_group_grants_on_members.js` | `group` field, optional `user`, index, rules |
| `server/register.go` | `groups.RegisterGrantTable` |
| `server/rls_setup_test.go` | stub `groups` collection in the fixture |
| `server/shipped_rules_test.go` | new literal clauses |
| `server/group_grants_rls_test.go` | rule tests for the three row kinds |
| `tinycld/boards/collections.ts` | `group` relation |
| `tinycld/boards/lib/highest-role.ts` | pick the strongest role across rows |
| `tinycld/boards/hooks/useProjectRole.ts` | use `highestRole` |
| `tinycld/boards/hooks/useProjectMembers.ts` | filter `group = ''` |
| `tinycld/boards/hooks/useProjectGroupGrants.ts` | boards wrapper around `useGroupGrants` |
| `tinycld/boards/components/sharing/roles.ts` | `GROUP_ROLE_OPTIONS` |
| `tinycld/boards/components/sharing/ShareDialog.tsx` | render `GroupShareSection` |
| `tests/highest-role.test.ts` | unit test |
| `tests/e2e/board-group-sharing.spec.ts` | e2e |
| `help/sharing-boards.md` | groups paragraph |

---

## Part A: core

### Task 1: Core migration for `groups` and `group_members`

**Files:**
- Create: `core/server/pb_migrations/2040000000_create_groups.js`
- Create: `core/server/groups/rules_test.go`

**Interfaces:**
- Produces: collections `groups` (`pbc_groups_01`: `name`, `description`) and `group_members` (`pbc_group_members_01`: `group`, `user`), unique index `(group, user)`.

- [ ] **Step 1: Write the failing rule test**

`core/server/groups/rules_test.go`:

```go
package groups

import (
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"github.com/pocketbase/pocketbase/tools/types"

	"tinycld.org/core/rlstest"
)

// newMigratedApp applies every shipped core migration so the rules under test
// are the rules the product ships. The username-index dance mirrors
// coreserver/guest_rls_test.go: the bundled fixture already carries the index
// that 1820000000 adds.
func newMigratedApp(t *testing.T) *tests.TestApp {
	t.Helper()
	app := rlstest.NewApp(t)
	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatal(err)
	}
	var kept types.JSONArray[string]
	for _, idx := range users.Indexes {
		if !strings.Contains(idx, "username") {
			kept = append(kept, idx)
		}
	}
	users.Indexes = kept
	users.PasswordAuth.IdentityFields = []string{"email"}
	if err := app.Save(users); err != nil {
		t.Fatalf("drop fixture username index: %v", err)
	}
	rlstest.Apply(t, app, rlstest.MigrationsDir(t, "../pb_migrations"))
	return app
}

func TestGroupsShippedRules(t *testing.T) {
	app := newMigratedApp(t)

	const notGuest = `@request.auth.role != "guest"`
	const admin = `@request.auth.role = "admin" || @request.auth.role = "owner"`

	rlstest.RequireRuleContains(t, app, "groups", "list", notGuest)
	rlstest.RequireRuleContains(t, app, "groups", "view", notGuest)
	rlstest.RequireRuleContains(t, app, "groups", "create", admin)
	rlstest.RequireRuleContains(t, app, "groups", "update", admin)
	rlstest.RequireRuleContains(t, app, "groups", "delete", admin)

	rlstest.RequireRuleContains(t, app, "group_members", "list", notGuest)
	rlstest.RequireRuleContains(t, app, "group_members", "view", notGuest)
	rlstest.RequireRuleContains(t, app, "group_members", "create", admin)
	rlstest.RequireRuleContains(t, app, "group_members", "create", `user.role != "guest"`)
	rlstest.RequireRuleContains(t, app, "group_members", "create", `user.disabled != true`)
	rlstest.RequireRuleContains(t, app, "group_members", "delete", admin)

	if rule, ok := rlstest.Rule(t, app, "group_members", "update"); ok {
		t.Fatalf("group_members update rule must be locked (nil), got %q", rule)
	}

	col, err := app.FindCollectionByNameOrId("group_members")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(strings.Join(col.Indexes, "\n"), "UNIQUE INDEX `idx_group_members_unique` ON `group_members` (`group`, `user`)") {
		t.Fatalf("missing unique (group,user) index: %v", col.Indexes)
	}
	groupsCol, err := app.FindCollectionByNameOrId("groups")
	if err != nil {
		t.Fatal(err)
	}
	if groupsCol.Id != "pbc_groups_01" || col.Id != "pbc_group_members_01" {
		t.Fatalf("collection ids are load-bearing for package migrations: %s %s", groupsCol.Id, col.Id)
	}
	_ = core.NewRecord
}
```

Check `rlstest.Rule`'s return contract before relying on the `ok` value: open `core/server/rlstest/rlstest.go` lines 145-180. If `ok` reports "rule is set (non-nil)", the assertion above is right. If it reports "collection found", change the check to `rule == ""`.

- [ ] **Step 2: Run it to verify it fails**

Run: `cd ~/code/tinycld/tinycld/core/server && go test -count=1 ./groups/ -run TestGroupsShippedRules -v`
Expected: FAIL (the package directory does not exist yet; create it with the test file, then FAIL on missing collection `groups`).

- [ ] **Step 3: Write the migration**

`core/server/pb_migrations/2040000000_create_groups.js`:

```js
/// <reference path="../pb_data/types.d.ts" />
//
// Admin-managed user groups. A package shares a resource with a group by
// writing a grant row (group set, user empty) into its own membership table;
// core/server/groups expands it into one derived row per member. These two
// collections are the only thing the rest of the product needs to know.
//
// Ids are fixed and referenced by package migrations (`collectionId:
// 'pbc_groups_01'`), so they never change.
migrate(
    app => {
        const enabled = '@request.auth.disabled != true'
        const authed = '@request.auth.id != ""'
        const notGuest = '@request.auth.role != "guest"'
        const reader = `${authed} && ${enabled} && ${notGuest}`
        const admin =
            `${authed} && ${enabled} && ` +
            '(@request.auth.role = "admin" || @request.auth.role = "owner")'

        const groups = new Collection({
            id: 'pbc_groups_01',
            name: 'groups',
            type: 'base',
            system: false,
            listRule: reader,
            viewRule: reader,
            createRule: admin,
            updateRule: admin,
            deleteRule: admin,
            fields: [
                { id: 'groups_name', name: 'name', type: 'text', required: true, min: 1, max: 100 },
                { id: 'groups_description', name: 'description', type: 'text', required: false, max: 500 },
                { id: 'groups_created', name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
                { id: 'groups_updated', name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
            ],
            indexes: ['CREATE UNIQUE INDEX `idx_groups_name` ON `groups` (`name`)'],
        })
        app.save(groups)

        // No update rule: a membership is added or removed, never edited.
        // Guests and disabled users are refused at the rule, so the picker's
        // exclusion is a convenience and the rule is the backstop.
        const members = new Collection({
            id: 'pbc_group_members_01',
            name: 'group_members',
            type: 'base',
            system: false,
            listRule: reader,
            viewRule: reader,
            createRule: `${admin} && user.role != "guest" && user.disabled != true`,
            updateRule: null,
            deleteRule: admin,
            fields: [
                {
                    id: 'group_members_group',
                    name: 'group',
                    type: 'relation',
                    required: true,
                    collectionId: 'pbc_groups_01',
                    cascadeDelete: true,
                    maxSelect: 1,
                },
                {
                    id: 'group_members_user',
                    name: 'user',
                    type: 'relation',
                    required: true,
                    collectionId: '_pb_users_auth_',
                    cascadeDelete: true,
                    maxSelect: 1,
                },
                { id: 'group_members_created', name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
                { id: 'group_members_updated', name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
            ],
            indexes: [
                'CREATE UNIQUE INDEX `idx_group_members_unique` ON `group_members` (`group`, `user`)',
                'CREATE INDEX `idx_group_members_user` ON `group_members` (`user`)',
            ],
        })
        app.save(members)
    },
    app => {
        for (const name of ['group_members', 'groups']) {
            try {
                app.delete(app.findCollectionByNameOrId(name))
            } catch (e) {
                // may not exist
            }
        }
    }
)
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd ~/code/tinycld/tinycld/core/server && go test -count=1 ./groups/ -run TestGroupsShippedRules -v`
Expected: PASS

- [ ] **Step 5: Regenerate types and check the schema**

Run: `cd ~/code/tinycld/tinycld && pnpm run packages:generate && grep -n "interface Groups\b\|interface GroupMembers\b" core/types/pbSchema.ts`
Expected: both interfaces listed.

- [ ] **Step 6: Commit**

```bash
cd ~/code/tinycld/tinycld && git checkout -b user-groups
git add core/server/pb_migrations/2040000000_create_groups.js core/server/groups/rules_test.go
git commit -m "feat(core): add groups and group_members collections"
```

### Task 2: Go `groups` registry

**Files:**
- Create: `core/server/groups/registry.go`
- Create: `core/server/groups/registry_test.go`

**Interfaces:**
- Produces:
  - `type GrantTable struct { Collection string; ResourceField string }`
  - `func RegisterGrantTable(t GrantTable)` (idempotent, ignores blanks)
  - `func RegisteredGrantTables() []GrantTable`
  - `type MembershipEvent struct { UserID, GroupID string; Joined bool }`
  - `func OnMembershipChange(fn func(MembershipEvent) error)`
  - `func ResetForTesting()`

- [ ] **Step 1: Write the failing test**

`core/server/groups/registry_test.go`:

```go
package groups

import "testing"

func TestRegisterGrantTableIsIdempotentAndIgnoresBlanks(t *testing.T) {
	ResetForTesting()
	RegisterGrantTable(GrantTable{Collection: "zoo_keepers", ResourceField: "zoo"})
	RegisterGrantTable(GrantTable{Collection: "zoo_keepers", ResourceField: "zoo"})
	RegisterGrantTable(GrantTable{Collection: "", ResourceField: "zoo"})
	RegisterGrantTable(GrantTable{Collection: "zoo_keepers", ResourceField: ""})

	got := RegisteredGrantTables()
	if len(got) != 1 || got[0].Collection != "zoo_keepers" || got[0].ResourceField != "zoo" {
		t.Fatalf("registry = %+v, want one zoo_keepers entry", got)
	}
}

func TestMembershipListenersRunInOrderAndStopOnError(t *testing.T) {
	ResetForTesting()
	var seen []string
	OnMembershipChange(func(e MembershipEvent) error {
		seen = append(seen, "a:"+e.UserID)
		return nil
	})
	OnMembershipChange(func(e MembershipEvent) error {
		seen = append(seen, "b:"+e.UserID)
		return errStop
	})
	OnMembershipChange(func(e MembershipEvent) error {
		seen = append(seen, "c:"+e.UserID)
		return nil
	})
	err := notifyMembership(MembershipEvent{UserID: "u1", GroupID: "g1", Joined: true})
	if err == nil {
		t.Fatal("expected the second listener's error to surface")
	}
	if len(seen) != 2 || seen[0] != "a:u1" || seen[1] != "b:u1" {
		t.Fatalf("seen = %v", seen)
	}
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd ~/code/tinycld/tinycld/core/server && go test -count=1 ./groups/ -run 'TestRegisterGrantTable|TestMembershipListeners' -v`
Expected: FAIL, undefined: GrantTable, errStop, notifyMembership.

- [ ] **Step 3: Write the registry**

`core/server/groups/registry.go`:

```go
// Package groups owns admin-managed user groups and the expansion of group
// grants into per-user membership rows.
//
// A package shares a resource with a group by writing a GRANT row into its own
// membership table: `group` set, `user` empty. This package expands every grant
// into one DERIVED row per member (`group` and `user` both set), keeps those
// rows in sync as membership and grants change, and repairs them at boot. The
// package's existing rules, which test `user`, then work unchanged.
//
// Packages declare their membership tables with RegisterGrantTable from their
// Register(app), the same way they declare offboard.RegisterReassignable. Core
// never names a package; tests use a fictional zoo_keepers table.
package groups

import (
	"errors"
	"sync"
)

// GrantTable declares a package membership table that carries optional `user`
// and `group` relation fields. ResourceField names the column that points at
// the shared resource (e.g. "project"), which is how a grant's derived rows
// are told apart from another grant's on the same group.
type GrantTable struct {
	Collection    string
	ResourceField string
}

// MembershipEvent describes one user joining or leaving one group. It is
// delivered after the membership row commits.
type MembershipEvent struct {
	UserID  string
	GroupID string
	Joined  bool
}

var (
	mu        sync.RWMutex
	tables    []GrantTable
	listeners []func(MembershipEvent) error
	errStop   = errors.New("groups: listener refused")
)

// RegisterGrantTable adds a membership table to the registry. Idempotent, and
// a blank collection or resource field is ignored, so a half-filled struct
// cannot register a table the expander then fails on.
func RegisterGrantTable(t GrantTable) {
	if t.Collection == "" || t.ResourceField == "" {
		return
	}
	mu.Lock()
	defer mu.Unlock()
	for _, existing := range tables {
		if existing.Collection == t.Collection {
			return
		}
	}
	tables = append(tables, t)
}

// RegisteredGrantTables returns a snapshot of the registry.
func RegisteredGrantTables() []GrantTable {
	mu.RLock()
	defer mu.RUnlock()
	out := make([]GrantTable, len(tables))
	copy(out, tables)
	return out
}

// OnMembershipChange registers a listener for join/leave events. Listeners run
// in registration order; the first error stops the chain and is logged by the
// caller. Mail uses this to provision or disable a mailbox.
func OnMembershipChange(fn func(MembershipEvent) error) {
	mu.Lock()
	defer mu.Unlock()
	listeners = append(listeners, fn)
}

func notifyMembership(e MembershipEvent) error {
	mu.RLock()
	fns := make([]func(MembershipEvent) error, len(listeners))
	copy(fns, listeners)
	mu.RUnlock()
	for _, fn := range fns {
		if err := fn(e); err != nil {
			return err
		}
	}
	return nil
}

// ResetForTesting clears tables and listeners. Tests register their own.
func ResetForTesting() {
	mu.Lock()
	defer mu.Unlock()
	tables = nil
	listeners = nil
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd ~/code/tinycld/tinycld/core/server && go test -count=1 ./groups/ -v`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
cd ~/code/tinycld/tinycld && git add core/server/groups/registry.go core/server/groups/registry_test.go
git commit -m "feat(groups): grant-table registry and membership listeners"
```

### Task 3: Expansion service and hooks

**Files:**
- Create: `core/server/groups/expand.go`
- Create: `core/server/groups/hooks.go`
- Create: `core/server/groups/expand_test.go`

**Interfaces:**
- Consumes: `RegisteredGrantTables()`, `notifyMembership` from Task 2.
- Produces:
  - `func Register(app *pocketbase.PocketBase)` — binds every hook; production entry point.
  - `func registerCore(app core.App)` — same body on `core.App`, for tests.
  - `func RemoveUserMemberships(app core.App, userID string) error` — used by offboard (Task 4).
  - `func isGrant(r *core.Record) bool`, `func isDerived(r *core.Record) bool`.
  - `func expandGrant(app core.App, t GrantTable, grant *core.Record) error`
  - `func syncDerived(app core.App, t GrantTable, grant *core.Record) error`
  - `func removeDerivedForGrant(app core.App, t GrantTable, grant *core.Record) error`
  - `func deriveForMember(app core.App, groupID, userID string) error`
  - `func removeDerivedForMember(app core.App, groupID, userID string) error`

- [ ] **Step 1: Write the failing tests**

`core/server/groups/expand_test.go`:

```go
package groups

import (
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// newZooApp builds the two core collections plus a fictional package table,
// zoo_keepers (zoo text, user, group, role), and binds the hooks. It does NOT
// run migrations: the rules are covered by rules_test.go, and hooks fire on
// app.Save regardless of rules.
func newZooApp(t *testing.T) *tests.TestApp {
	t.Helper()
	ResetForTesting()
	a, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	t.Cleanup(a.Cleanup)

	users, err := a.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatal(err)
	}

	groups := core.NewBaseCollection("groups")
	groups.Id = "pbc_groups_01"
	groups.Fields.Add(&core.TextField{Name: "name", Required: true})
	if err := a.Save(groups); err != nil {
		t.Fatalf("save groups: %v", err)
	}

	members := core.NewBaseCollection("group_members")
	members.Id = "pbc_group_members_01"
	members.Fields.Add(&core.RelationField{Name: "group", Required: true, CollectionId: groups.Id, CascadeDelete: true, MaxSelect: 1})
	members.Fields.Add(&core.RelationField{Name: "user", Required: true, CollectionId: users.Id, CascadeDelete: true, MaxSelect: 1})
	members.AddIndex("idx_gm_unique", true, "`group`, `user`", "")
	if err := a.Save(members); err != nil {
		t.Fatalf("save group_members: %v", err)
	}

	keepers := core.NewBaseCollection("zoo_keepers")
	keepers.Fields.Add(&core.TextField{Name: "zoo", Required: true})
	keepers.Fields.Add(&core.RelationField{Name: "user", CollectionId: users.Id, CascadeDelete: true, MaxSelect: 1})
	keepers.Fields.Add(&core.RelationField{Name: "group", CollectionId: groups.Id, CascadeDelete: true, MaxSelect: 1})
	keepers.Fields.Add(&core.SelectField{Name: "role", Required: true, MaxSelect: 1, Values: []string{"owner", "editor", "viewer"}})
	keepers.AddIndex("idx_zk_unique", true, "`zoo`, `user`, `group`", "")
	if err := a.Save(keepers); err != nil {
		t.Fatalf("save zoo_keepers: %v", err)
	}

	RegisterGrantTable(GrantTable{Collection: "zoo_keepers", ResourceField: "zoo"})
	registerCore(a)
	return a
}

func zooUser(t *testing.T, app core.App, email string) *core.Record {
	t.Helper()
	users, _ := app.FindCollectionByNameOrId("users")
	u := core.NewRecord(users)
	u.SetEmail(email)
	u.Set("name", "T")
	u.SetVerified(true)
	u.SetPassword("Password123!")
	if err := app.Save(u); err != nil {
		t.Fatalf("save user %s: %v", email, err)
	}
	return u
}

func zooGroup(t *testing.T, app core.App, name string) *core.Record {
	t.Helper()
	col, _ := app.FindCollectionByNameOrId("groups")
	g := core.NewRecord(col)
	g.Set("name", name)
	if err := app.Save(g); err != nil {
		t.Fatalf("save group %s: %v", name, err)
	}
	return g
}

func zooMember(t *testing.T, app core.App, group, user *core.Record) *core.Record {
	t.Helper()
	col, _ := app.FindCollectionByNameOrId("group_members")
	m := core.NewRecord(col)
	m.Set("group", group.Id)
	m.Set("user", user.Id)
	if err := app.Save(m); err != nil {
		t.Fatalf("save membership: %v", err)
	}
	return m
}

func zooGrant(t *testing.T, app core.App, zoo string, group *core.Record, role string) *core.Record {
	t.Helper()
	col, _ := app.FindCollectionByNameOrId("zoo_keepers")
	r := core.NewRecord(col)
	r.Set("zoo", zoo)
	r.Set("group", group.Id)
	r.Set("role", role)
	if err := app.Save(r); err != nil {
		t.Fatalf("save grant: %v", err)
	}
	return r
}

// derivedRows lists derived rows (user AND group set) for one zoo, keyed
// "userId:role".
func derivedRows(t *testing.T, app core.App, zoo string) map[string]string {
	t.Helper()
	rows, err := app.FindRecordsByFilter("zoo_keepers", `zoo = {:zoo} && user != "" && group != ""`, "", 0, 0, map[string]any{"zoo": zoo})
	if err != nil {
		t.Fatal(err)
	}
	out := map[string]string{}
	for _, r := range rows {
		out[r.GetString("user")] = r.GetString("role")
	}
	return out
}

func TestGrantCreateExpandsToCurrentMembers(t *testing.T) {
	app := newZooApp(t)
	alice, bob := zooUser(t, app, "alice@x.test"), zooUser(t, app, "bob@x.test")
	g := zooGroup(t, app, "keepers")
	zooMember(t, app, g, alice)
	zooMember(t, app, g, bob)

	zooGrant(t, app, "bronx", g, "editor")

	got := derivedRows(t, app, "bronx")
	if got[alice.Id] != "editor" || got[bob.Id] != "editor" || len(got) != 2 {
		t.Fatalf("derived = %v", got)
	}
}

func TestMemberJoinAndLeaveFollowExistingGrants(t *testing.T) {
	app := newZooApp(t)
	alice := zooUser(t, app, "alice@x.test")
	g := zooGroup(t, app, "keepers")
	zooGrant(t, app, "bronx", g, "viewer")
	zooGrant(t, app, "sd", g, "viewer")

	m := zooMember(t, app, g, alice)
	if derivedRows(t, app, "bronx")[alice.Id] != "viewer" || derivedRows(t, app, "sd")[alice.Id] != "viewer" {
		t.Fatal("join did not derive rows for both grants")
	}

	if err := app.Delete(m); err != nil {
		t.Fatal(err)
	}
	if len(derivedRows(t, app, "bronx")) != 0 || len(derivedRows(t, app, "sd")) != 0 {
		t.Fatal("leave did not remove derived rows")
	}
}

func TestGrantUpdateCopiesRoleAndDeleteRemovesDerived(t *testing.T) {
	app := newZooApp(t)
	alice := zooUser(t, app, "alice@x.test")
	g := zooGroup(t, app, "keepers")
	zooMember(t, app, g, alice)
	grant := zooGrant(t, app, "bronx", g, "viewer")

	grant.Set("role", "editor")
	if err := app.Save(grant); err != nil {
		t.Fatal(err)
	}
	if derivedRows(t, app, "bronx")[alice.Id] != "editor" {
		t.Fatal("role change did not reach the derived row")
	}

	if err := app.Delete(grant); err != nil {
		t.Fatal(err)
	}
	if len(derivedRows(t, app, "bronx")) != 0 {
		t.Fatal("grant delete left derived rows behind")
	}
}

func TestUserInTwoGroupsGrantedOnOneResourceKeepsBothRows(t *testing.T) {
	app := newZooApp(t)
	alice := zooUser(t, app, "alice@x.test")
	g1, g2 := zooGroup(t, app, "keepers"), zooGroup(t, app, "vets")
	zooMember(t, app, g1, alice)
	zooMember(t, app, g2, alice)
	zooGrant(t, app, "bronx", g1, "viewer")
	zooGrant(t, app, "bronx", g2, "editor")

	rows, err := app.FindRecordsByFilter("zoo_keepers", `zoo = "bronx" && user = {:u}`, "", 0, 0, map[string]any{"u": alice.Id})
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 2 {
		t.Fatalf("want one derived row per group, got %d", len(rows))
	}

	// Leaving one group removes only that group's row.
	m, err := app.FindFirstRecordByFilter("group_members", "group = {:g} && user = {:u}", map[string]any{"g": g1.Id, "u": alice.Id})
	if err != nil {
		t.Fatal(err)
	}
	if err := app.Delete(m); err != nil {
		t.Fatal(err)
	}
	if got := derivedRows(t, app, "bronx"); got[alice.Id] != "editor" {
		t.Fatalf("after leaving keepers, alice should keep the vets row: %v", got)
	}
}

func TestGroupDeleteRemovesGrantsAndDerivedRows(t *testing.T) {
	app := newZooApp(t)
	alice := zooUser(t, app, "alice@x.test")
	g := zooGroup(t, app, "keepers")
	zooMember(t, app, g, alice)
	zooGrant(t, app, "bronx", g, "viewer")

	if err := app.Delete(g); err != nil {
		t.Fatal(err)
	}
	n, err := app.CountRecords("zoo_keepers")
	if err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Fatalf("want zoo_keepers empty after group delete, got %d rows", n)
	}
}

func TestDirectRowsAreLeftAlone(t *testing.T) {
	app := newZooApp(t)
	alice := zooUser(t, app, "alice@x.test")
	col, _ := app.FindCollectionByNameOrId("zoo_keepers")
	direct := core.NewRecord(col)
	direct.Set("zoo", "bronx")
	direct.Set("user", alice.Id)
	direct.Set("role", "owner")
	if err := app.Save(direct); err != nil {
		t.Fatal(err)
	}
	direct.Set("role", "editor")
	if err := app.Save(direct); err != nil {
		t.Fatal(err)
	}
	if err := app.Delete(direct); err != nil {
		t.Fatal(err)
	}
	n, _ := app.CountRecords("zoo_keepers")
	if n != 0 {
		t.Fatalf("direct row lifecycle should not create rows, got %d", n)
	}
}

func TestMembershipListenerFiresAfterCommit(t *testing.T) {
	app := newZooApp(t)
	var events []MembershipEvent
	OnMembershipChange(func(e MembershipEvent) error {
		events = append(events, e)
		return nil
	})
	alice := zooUser(t, app, "alice@x.test")
	g := zooGroup(t, app, "keepers")
	m := zooMember(t, app, g, alice)
	if err := app.Delete(m); err != nil {
		t.Fatal(err)
	}
	if len(events) != 2 || !events[0].Joined || events[1].Joined || events[0].UserID != alice.Id || events[1].GroupID != g.Id {
		t.Fatalf("events = %+v", events)
	}
}

func TestRemoveUserMemberships(t *testing.T) {
	app := newZooApp(t)
	alice := zooUser(t, app, "alice@x.test")
	g1, g2 := zooGroup(t, app, "keepers"), zooGroup(t, app, "vets")
	zooMember(t, app, g1, alice)
	zooMember(t, app, g2, alice)
	zooGrant(t, app, "bronx", g1, "viewer")

	if err := RemoveUserMemberships(app, alice.Id); err != nil {
		t.Fatal(err)
	}
	n, _ := app.CountRecords("group_members")
	if n != 0 {
		t.Fatalf("memberships left: %d", n)
	}
	if len(derivedRows(t, app, "bronx")) != 0 {
		t.Fatal("derived rows left after membership removal")
	}
}
```

If `AddIndex` does not exist on `core.Collection` in the forked PocketBase, append the SQL string to `col.Indexes` instead: ``members.Indexes = append(members.Indexes, "CREATE UNIQUE INDEX `idx_gm_unique` ON `group_members` (`group`, `user`)")``.

- [ ] **Step 2: Run to verify they fail**

Run: `cd ~/code/tinycld/tinycld/core/server && go test -count=1 ./groups/ -run 'Test.*' -v 2>&1 | head -20`
Expected: compile FAIL, undefined: registerCore, RemoveUserMemberships.

- [ ] **Step 3: Write `expand.go`**

```go
package groups

import (
	"fmt"

	"github.com/pocketbase/pocketbase/core"
)

// isGrant reports a client-written group grant: group set, user empty.
func isGrant(r *core.Record) bool {
	return r.GetString("user") == "" && r.GetString("group") != ""
}

// isDerived reports a server-owned expansion of a grant: both set.
func isDerived(r *core.Record) bool {
	return r.GetString("user") != "" && r.GetString("group") != ""
}

// copyGrantFields makes dst a clone of grant apart from identity and the user
// slot. Every other field (role, created_by, a per-member color, …) copies
// through, which is why the registry needs no per-package field list.
func copyGrantFields(dst, grant *core.Record) {
	for _, f := range grant.Collection().Fields {
		name := f.GetName()
		if name == "id" || name == "user" || f.Type() == core.FieldTypeAutodate {
			continue
		}
		dst.Set(name, grant.Get(name))
	}
}

func memberUserIDs(app core.App, groupID string) ([]string, error) {
	rows, err := app.FindRecordsByFilter("group_members", "group = {:g}", "", 0, 0, map[string]any{"g": groupID})
	if err != nil {
		return nil, fmt.Errorf("groups: list members of %s: %w", groupID, err)
	}
	ids := make([]string, 0, len(rows))
	for _, r := range rows {
		ids = append(ids, r.GetString("user"))
	}
	return ids, nil
}

func findDerived(app core.App, t GrantTable, grant *core.Record, userID string) (*core.Record, error) {
	rec, err := app.FindFirstRecordByFilter(
		t.Collection,
		fmt.Sprintf("group = {:g} && user = {:u} && %s = {:r}", t.ResourceField),
		map[string]any{"g": grant.GetString("group"), "u": userID, "r": grant.GetString(t.ResourceField)},
	)
	if err != nil {
		return nil, nil //nolint:nilerr // not found is the normal miss
	}
	return rec, nil
}

// upsertDerived ensures one derived row for (grant, user) that mirrors the
// grant's fields.
func upsertDerived(app core.App, t GrantTable, grant *core.Record, userID string) error {
	existing, _ := findDerived(app, t, grant, userID)
	if existing == nil {
		existing = core.NewRecord(grant.Collection())
	}
	copyGrantFields(existing, grant)
	existing.Set("user", userID)
	if err := app.Save(existing); err != nil {
		return fmt.Errorf("groups: derive %s row for user %s: %w", t.Collection, userID, err)
	}
	return nil
}

// expandGrant inserts a derived row for every current member of the grant's
// group.
func expandGrant(app core.App, t GrantTable, grant *core.Record) error {
	ids, err := memberUserIDs(app, grant.GetString("group"))
	if err != nil {
		return err
	}
	for _, id := range ids {
		if err := upsertDerived(app, t, grant, id); err != nil {
			return err
		}
	}
	return nil
}

// syncDerived re-copies the grant's fields onto its derived rows after the
// grant changed (typically a role change).
func syncDerived(app core.App, t GrantTable, grant *core.Record) error {
	return expandGrant(app, t, grant)
}

func derivedForGrant(app core.App, t GrantTable, grant *core.Record) ([]*core.Record, error) {
	return app.FindRecordsByFilter(
		t.Collection,
		fmt.Sprintf(`group = {:g} && user != "" && %s = {:r}`, t.ResourceField),
		"", 0, 0,
		map[string]any{"g": grant.GetString("group"), "r": grant.GetString(t.ResourceField)},
	)
}

// removeDerivedForGrant deletes every derived row of one grant. Rows already
// gone (a cascade from a group delete) are not an error.
func removeDerivedForGrant(app core.App, t GrantTable, grant *core.Record) error {
	rows, err := derivedForGrant(app, t, grant)
	if err != nil {
		return fmt.Errorf("groups: list derived rows of %s: %w", t.Collection, err)
	}
	for _, r := range rows {
		if err := app.Delete(r); err != nil {
			return fmt.Errorf("groups: delete derived %s row: %w", t.Collection, err)
		}
	}
	return nil
}

// deriveForMember inserts, in every registered table, a derived row for each
// grant of the group the user just joined.
func deriveForMember(app core.App, groupID, userID string) error {
	for _, t := range RegisteredGrantTables() {
		grants, err := app.FindRecordsByFilter(t.Collection, `group = {:g} && user = ""`, "", 0, 0, map[string]any{"g": groupID})
		if err != nil {
			return fmt.Errorf("groups: list grants in %s: %w", t.Collection, err)
		}
		for _, grant := range grants {
			if err := upsertDerived(app, t, grant, userID); err != nil {
				return err
			}
		}
	}
	return nil
}

// removeDerivedForMember deletes, in every registered table, the derived rows
// of (group, user). A row the user holds through another group stays.
func removeDerivedForMember(app core.App, groupID, userID string) error {
	for _, t := range RegisteredGrantTables() {
		rows, err := app.FindRecordsByFilter(t.Collection, "group = {:g} && user = {:u}", "", 0, 0, map[string]any{"g": groupID, "u": userID})
		if err != nil {
			return fmt.Errorf("groups: list derived rows in %s: %w", t.Collection, err)
		}
		for _, r := range rows {
			if err := app.Delete(r); err != nil {
				return fmt.Errorf("groups: delete derived %s row: %w", t.Collection, err)
			}
		}
	}
	return nil
}

// RemoveUserMemberships deletes every group_members row of a user. Each delete
// runs the membership hooks, so derived rows go with it. Called when a user
// becomes a guest and when a user is offboarded.
func RemoveUserMemberships(app core.App, userID string) error {
	rows, err := app.FindRecordsByFilter("group_members", "user = {:u}", "", 0, 0, map[string]any{"u": userID})
	if err != nil {
		return fmt.Errorf("groups: list memberships of %s: %w", userID, err)
	}
	for _, r := range rows {
		if err := app.Delete(r); err != nil {
			return fmt.Errorf("groups: delete membership %s: %w", r.Id, err)
		}
	}
	return nil
}
```

Remove the `//nolint` comment if the repo's linter flags it; return `nil, nil` on a not-found error is the intent (PocketBase returns `sql.ErrNoRows`). If `core.FieldTypeAutodate` is not the constant name in the fork, grep `FieldTypeAutodate` under `third_party/pocketbase/core` and use the exported name found.

- [ ] **Step 4: Write `hooks.go`**

```go
package groups

import (
	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"

	"tinycld.org/core/logging"
)

var log = logging.ForPackage("groups")

// Register binds the expansion hooks for group_members, users and every
// registered grant table, plus the boot reconcile. Packages must have called
// RegisterGrantTable before this runs, which RegisterSharedCore's position
// after RegisterExtras guarantees.
func Register(app *pocketbase.PocketBase) {
	registerCore(app)
	app.OnServe().BindFunc(func(e *core.ServeEvent) error {
		if err := Reconcile(e.App); err != nil {
			log.Error("boot reconcile failed", "err", err)
		}
		return e.Next()
	})
}

// registerCore is the core.App-typed body so tests can bind it on a
// *tests.TestApp. Model-level hooks run inside the write's transaction: e.App
// is the transactional app, so a failed derived write fails the client's
// request and nothing half-expanded is ever visible.
func registerCore(app core.App) {
	app.OnRecordCreate("group_members").BindFunc(func(e *core.RecordEvent) error {
		if err := e.Next(); err != nil {
			return err
		}
		return deriveForMember(e.App, e.Record.GetString("group"), e.Record.GetString("user"))
	})
	app.OnRecordDelete("group_members").BindFunc(func(e *core.RecordEvent) error {
		if err := e.Next(); err != nil {
			return err
		}
		return removeDerivedForMember(e.App, e.Record.GetString("group"), e.Record.GetString("user"))
	})

	// Listeners run after commit so a package side effect (mail provisioning)
	// never sees an uncommitted membership.
	app.OnRecordAfterCreateSuccess("group_members").BindFunc(func(e *core.RecordEvent) error {
		notify(e.Record, true)
		return e.Next()
	})
	app.OnRecordAfterDeleteSuccess("group_members").BindFunc(func(e *core.RecordEvent) error {
		notify(e.Record, false)
		return e.Next()
	})

	// A user demoted to guest leaves every group: guests are never members.
	app.OnRecordUpdate("users").BindFunc(func(e *core.RecordEvent) error {
		if err := e.Next(); err != nil {
			return err
		}
		if e.Record.GetString("role") != "guest" || e.Record.Original().GetString("role") == "guest" {
			return nil
		}
		return RemoveUserMemberships(e.App, e.Record.Id)
	})

	for _, t := range RegisteredGrantTables() {
		bindGrantTable(app, t)
	}
}

func bindGrantTable(app core.App, t GrantTable) {
	app.OnRecordCreate(t.Collection).BindFunc(func(e *core.RecordEvent) error {
		if err := e.Next(); err != nil {
			return err
		}
		if !isGrant(e.Record) {
			return nil
		}
		return expandGrant(e.App, t, e.Record)
	})
	app.OnRecordUpdate(t.Collection).BindFunc(func(e *core.RecordEvent) error {
		if err := e.Next(); err != nil {
			return err
		}
		if !isGrant(e.Record) {
			return nil
		}
		return syncDerived(e.App, t, e.Record)
	})
	app.OnRecordDelete(t.Collection).BindFunc(func(e *core.RecordEvent) error {
		if err := e.Next(); err != nil {
			return err
		}
		if !isGrant(e.Record) {
			return nil
		}
		return removeDerivedForGrant(e.App, t, e.Record)
	})
}

func notify(member *core.Record, joined bool) {
	err := notifyMembership(MembershipEvent{
		UserID:  member.GetString("user"),
		GroupID: member.GetString("group"),
		Joined:  joined,
	})
	if err != nil {
		log.Error("membership listener failed", "user", member.GetString("user"), "group", member.GetString("group"), "joined", joined, "err", err)
	}
}
```

Also create `core/server/groups/reconcile.go` now with a stub so the package compiles; Task 4 fills it in:

```go
package groups

import "github.com/pocketbase/pocketbase/core"

// Reconcile is implemented in Task 4.
func Reconcile(app core.App) error { return nil }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd ~/code/tinycld/tinycld/core/server && go test -count=1 ./groups/ -v`
Expected: PASS for all tests in `expand_test.go`, `registry_test.go`, `rules_test.go`.

If `TestGroupDeleteRemovesGrantsAndDerivedRows` fails because a cascade-deleted grant's hook runs after its derived rows are already gone, that is handled (`removeDerivedForGrant` tolerates an empty list). If it fails because the cascade does not fire record hooks in the fork, replace the assertion's setup with an explicit delete of the grant and the membership, and note in the test why.

- [ ] **Step 6: Commit**

```bash
cd ~/code/tinycld/tinycld && git add core/server/groups/
git commit -m "feat(groups): expand group grants into derived membership rows"
```

### Task 4: Boot reconcile, wiring, audit, offboard, hook counts

**Files:**
- Modify: `core/server/groups/reconcile.go` (replace the stub)
- Create: `core/server/groups/reconcile_test.go`
- Modify: `core/server/coreserver/server.go` (`RegisterSharedCore`)
- Modify: `core/server/coreserver/audit.go` (`RegisterAuditHooks`)
- Modify: `core/server/offboard/offboard.go` (`OffboardUser` transaction)
- Modify: `core/server/coreserver/composition_parity_test.go` (`hostHookCounts`)

**Interfaces:**
- Consumes: `expand.go` helpers, `RemoveUserMemberships`.
- Produces: `func Reconcile(app core.App) error`, idempotent.

- [ ] **Step 1: Write the failing reconcile test**

`core/server/groups/reconcile_test.go`:

```go
package groups

import (
	"testing"

	"github.com/pocketbase/pocketbase/core"
)

// Reconcile must repair both directions: a missing derived row is inserted, a
// stale derived row (no grant, or user no longer a member) is deleted, and a
// clean state is left alone.
func TestReconcileRepairsBothDirections(t *testing.T) {
	app := newZooApp(t)
	alice, bob := zooUser(t, app, "alice@x.test"), zooUser(t, app, "bob@x.test")
	g := zooGroup(t, app, "keepers")
	zooMember(t, app, g, alice)
	grant := zooGrant(t, app, "bronx", g, "viewer")

	// Simulate a crash between hook and commit: delete alice's derived row
	// with hooks bypassed, and forge a stale row for bob who is not a member.
	rows, err := app.FindRecordsByFilter("zoo_keepers", `user = {:u}`, "", 0, 0, map[string]any{"u": alice.Id})
	if err != nil || len(rows) != 1 {
		t.Fatalf("expected alice's derived row, got %d rows (err %v)", len(rows), err)
	}
	if _, err := app.DB().NewQuery("DELETE FROM zoo_keepers WHERE id = {:id}").Bind(map[string]any{"id": rows[0].Id}).Execute(); err != nil {
		t.Fatal(err)
	}
	col, _ := app.FindCollectionByNameOrId("zoo_keepers")
	stale := core.NewRecord(col)
	stale.Set("zoo", "bronx")
	stale.Set("group", g.Id)
	stale.Set("user", bob.Id)
	stale.Set("role", "viewer")
	if err := app.Save(stale); err != nil {
		t.Fatal(err)
	}
	// Role drift on the grant must also be repaired.
	if _, err := app.DB().NewQuery("UPDATE zoo_keepers SET role = 'editor' WHERE id = {:id}").Bind(map[string]any{"id": grant.Id}).Execute(); err != nil {
		t.Fatal(err)
	}

	if err := Reconcile(app); err != nil {
		t.Fatal(err)
	}
	got := derivedRows(t, app, "bronx")
	if len(got) != 1 || got[alice.Id] != "editor" {
		t.Fatalf("after reconcile derived = %v, want only alice as editor", got)
	}

	// Idempotent: a second pass changes nothing.
	if err := Reconcile(app); err != nil {
		t.Fatal(err)
	}
	if again := derivedRows(t, app, "bronx"); len(again) != 1 || again[alice.Id] != "editor" {
		t.Fatalf("second reconcile changed state: %v", again)
	}
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd ~/code/tinycld/tinycld/core/server && go test -count=1 ./groups/ -run TestReconcile -v`
Expected: FAIL (the stub does nothing; bob's stale row remains).

- [ ] **Step 3: Implement `Reconcile`**

Replace `core/server/groups/reconcile.go`:

```go
package groups

import (
	"fmt"

	"github.com/pocketbase/pocketbase/core"
)

// Reconcile diffs expected derived rows against actual rows for every
// registered table and repairs both directions. It runs once at boot and is
// the safety net for a crash between hook and commit. One broken table logs
// and does not block the others.
func Reconcile(app core.App) error {
	var firstErr error
	for _, t := range RegisteredGrantTables() {
		if err := reconcileTable(app, t); err != nil {
			log.Warn("reconcile: table skipped", "collection", t.Collection, "err", err)
			if firstErr == nil {
				firstErr = err
			}
		}
	}
	return firstErr
}

func reconcileTable(app core.App, t GrantTable) error {
	grants, err := app.FindRecordsByFilter(t.Collection, `user = "" && group != ""`, "", 0, 0, nil)
	if err != nil {
		return fmt.Errorf("list grants: %w", err)
	}
	// expected[group][resource][user] = true
	expected := map[string]map[string]map[string]bool{}
	for _, grant := range grants {
		groupID, resource := grant.GetString("group"), grant.GetString(t.ResourceField)
		members, err := memberUserIDs(app, groupID)
		if err != nil {
			return err
		}
		if expected[groupID] == nil {
			expected[groupID] = map[string]map[string]bool{}
		}
		if expected[groupID][resource] == nil {
			expected[groupID][resource] = map[string]bool{}
		}
		for _, userID := range members {
			expected[groupID][resource][userID] = true
		}
		// upsertDerived also repairs field drift on rows that exist.
		if err := expandGrant(app, t, grant); err != nil {
			log.Warn("reconcile: repaired grant expansion failed", "collection", t.Collection, "grant", grant.Id, "err", err)
		}
	}

	derived, err := app.FindRecordsByFilter(t.Collection, `user != "" && group != ""`, "", 0, 0, nil)
	if err != nil {
		return fmt.Errorf("list derived rows: %w", err)
	}
	for _, row := range derived {
		groupID, resource, userID := row.GetString("group"), row.GetString(t.ResourceField), row.GetString("user")
		if expected[groupID][resource][userID] {
			continue
		}
		log.Warn("reconcile: removing stale derived row", "collection", t.Collection, "row", row.Id)
		if err := app.Delete(row); err != nil {
			return fmt.Errorf("delete stale row %s: %w", row.Id, err)
		}
	}
	return nil
}
```

- [ ] **Step 4: Run the groups tests**

Run: `cd ~/code/tinycld/tinycld/core/server && go test -count=1 ./groups/ -v`
Expected: PASS.

- [ ] **Step 5: Wire into core**

In `core/server/coreserver/server.go`, add the import `"tinycld.org/core/groups"` and, inside `RegisterSharedCore`, add one line directly after `pkgaccess.Register(app)`:

```go
	groups.Register(app)
```

In `core/server/coreserver/audit.go`, inside `RegisterAuditHooks`, add:

```go
	// Group membership is an access-control change: who can see what moves
	// with every row here, so both land in the audit log.
	audit.RegisterCollection(app, "groups", &audit.CollectionConfig{
		ExtractLabel: audit.LabelFromField("name"),
	})
	audit.RegisterCollections(app, []string{"group_members"}, nil)
```

In `core/server/offboard/offboard.go`, add the import `"tinycld.org/core/groups"` and, inside the `RunInTransaction` callback of `OffboardUser`, directly before the `anonymizeUser(txApp, userID)` call:

```go
		// A departing user leaves every group. The membership hooks drop the
		// derived rows, so a successor never inherits a group-granted share.
		if err := groups.RemoveUserMemberships(txApp, userID); err != nil {
			return err
		}
```

- [ ] **Step 6: Run the parity test and update the counts**

Run: `cd ~/code/tinycld/tinycld/core/server && go test -count=1 ./coreserver/ -run TestRegisterBindsTheRecordedHandlerCounts -v`
Expected: FAIL naming each hook whose count changed. The expected deltas from `groups.Register` are `OnRecordCreate +1`, `OnRecordDelete +1`, `OnRecordUpdate +1`, `OnRecordAfterCreateSuccess +1`, `OnRecordAfterDeleteSuccess +1`, `OnServe +1`. Audit adds `OnRecordCreateRequest +2`, `OnRecordUpdateRequest +2`, `OnRecordDeleteRequest +2`. Set each entry in `hostHookCounts` to the value the failure reports, and check the reported values match these deltas. A different delta means a hook was bound twice or not at all: fix the wiring, not the number.

Run again: expected PASS.

- [ ] **Step 7: Run the whole core Go suite and the isolation check**

Run: `cd ~/code/tinycld/tinycld/core/server && go test -count=1 ./... 2>&1 | tail -30`
Expected: all PASS.

Run: `cd ~/code/tinycld/tinycld && pnpm run check:core-isolation`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
cd ~/code/tinycld/tinycld && git add core/server/groups/ core/server/coreserver/server.go core/server/coreserver/audit.go core/server/offboard/offboard.go core/server/coreserver/composition_parity_test.go
git commit -m "feat(groups): boot reconcile, audit, offboard cleanup and wiring"
```

### Task 5: Client stores and shared types

**Files:**
- Modify: `core/lib/pocketbase.ts`
- Create: `core/lib/groups/types.ts`

**Interfaces:**
- Produces: `useStore('groups')`, `useStore('group_members')`; types
  - `GroupGrantRow<Role extends string = string> = { id: string; user: string; group: string; role: Role }`
  - `NewGroupGrant<Role extends string> = { id: string; user: ''; group: string; role: Role }`
  - `GroupRoleOption<Role extends string> = { value: Role; label: string }`
  - `GroupGrant<Role extends string> = { grantId: string; groupId: string; role: Role }`

- [ ] **Step 1: Add the stores**

In `core/lib/pocketbase.ts`, after the `users` collection definition add:

```ts
const groups = newCollection('groups', {
    omitOnInsert: ['created', 'updated'],
    ...indexing,
})

const group_members = newCollection('group_members', {
    omitOnInsert: ['created', 'updated'],
    relations: { group: groups, user: users },
    ...indexing,
})
```

Add `groups,` and `group_members,` to the `coreStores` object (after `users,`).

- [ ] **Step 2: Add the types file**

`core/lib/groups/types.ts`:

```ts
// Shapes a package's membership table must satisfy for the group share UI.
// A package's row type (e.g. BoardsProjectMembers) is structurally assignable
// because it carries these four fields; the rest of its fields are ignored.

export interface GroupGrantRow<Role extends string = string> {
    id: string
    user: string
    group: string
    role: Role
}

// A grant row as core builds it. The package's `buildRow` adds its own fields
// (the resource id, created_by, …) and returns the collection's insert type.
export interface NewGroupGrant<Role extends string> {
    id: string
    user: ''
    group: string
    role: Role
}

export interface GroupRoleOption<Role extends string> {
    value: Role
    label: string
}

export interface GroupGrant<Role extends string> {
    grantId: string
    groupId: string
    role: Role
}
```

- [ ] **Step 3: Typecheck**

Run: `cd ~/code/tinycld/tinycld/core && pnpm exec tinycld-pkg typecheck`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
cd ~/code/tinycld/tinycld && git add core/lib/pocketbase.ts core/lib/groups/types.ts
git commit -m "feat(core): register groups stores and grant types"
```

### Task 6: `useGroupGrants` hook

**Files:**
- Create: `core/lib/groups/use-group-grants.ts`
- Create: `core/tests/unit/use-group-grants.test.tsx`

**Interfaces:**
- Consumes: types from Task 5, `useMutation`/`mutation` from `@tinycld/core/lib/mutations`, `newRecordId` from `pbtsdb/core`.
- Produces:

```ts
export interface UseGroupGrantsOptions<Role, Row, TUtils, TInsert> {
    collection: Collection<Row, string | number, TUtils, never, TInsert>
    roles: readonly GroupRoleOption<Role>[]
    isForResource: (row: Row) => boolean
    buildRow: (grant: NewGroupGrant<Role>) => TInsert
}
export function useGroupGrants(options): {
    grants: GroupGrant<Role>[]
    isReady: boolean
    onAdd: (groupId: string, role: Role) => void
    onRoleChange: (grantId: string, role: Role) => void
    onRemove: (grantId: string) => void
    isPending: boolean
}
```

The return value is exactly the data props of `GroupShareSection` (Task 7), so a package spreads it: `<GroupShareSection {...grants} roles={…} canManage={…} />`.

- [ ] **Step 1: Write the failing test**

`core/tests/unit/use-group-grants.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { createCollection, localOnlyCollectionOptions } from '@tanstack/db'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tinycld/core/lib/pocketbase', () => ({ useStore: () => [] }))

import { useGroupGrants } from '../../lib/groups/use-group-grants'

interface KeeperRow {
    id: string
    zoo: string
    user: string
    group: string
    role: 'editor' | 'viewer'
}

const ROLES = [
    { value: 'editor' as const, label: 'Editor' },
    { value: 'viewer' as const, label: 'Viewer' },
]

function keepers(initialData: KeeperRow[]) {
    return createCollection(
        localOnlyCollectionOptions({
            id: `keepers-${Math.random()}`,
            getKey: (r: KeeperRow) => r.id,
            initialData,
        })
    )
}

function wrapper() {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    return ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
}

afterEach(cleanup)

describe('useGroupGrants', () => {
    it('lists only grant rows (user empty) for the resource', async () => {
        const collection = keepers([
            { id: 'direct', zoo: 'bronx', user: 'u1', group: '', role: 'editor' },
            { id: 'grant', zoo: 'bronx', user: '', group: 'g1', role: 'viewer' },
            { id: 'derived', zoo: 'bronx', user: 'u2', group: 'g1', role: 'viewer' },
            { id: 'other', zoo: 'sd', user: '', group: 'g2', role: 'viewer' },
        ])
        const { result } = renderHook(
            () =>
                useGroupGrants({
                    collection,
                    roles: ROLES,
                    isForResource: row => row.zoo === 'bronx',
                    buildRow: grant => ({ ...grant, zoo: 'bronx' }),
                }),
            { wrapper: wrapper() }
        )
        await waitFor(() => expect(result.current.isReady).toBe(true))
        expect(result.current.grants).toEqual([{ grantId: 'grant', groupId: 'g1', role: 'viewer' }])
    })

    it('adds, changes role and removes through the collection', async () => {
        const collection = keepers([])
        const { result } = renderHook(
            () =>
                useGroupGrants({
                    collection,
                    roles: ROLES,
                    isForResource: row => row.zoo === 'bronx',
                    buildRow: grant => ({ ...grant, zoo: 'bronx' }),
                }),
            { wrapper: wrapper() }
        )
        await waitFor(() => expect(result.current.isReady).toBe(true))

        act(() => result.current.onAdd('g9', 'viewer'))
        await waitFor(() => expect(result.current.grants).toHaveLength(1))
        const inserted = collection.toArray[0]
        expect(inserted).toMatchObject({ zoo: 'bronx', user: '', group: 'g9', role: 'viewer' })

        act(() => result.current.onRoleChange(inserted.id, 'editor'))
        await waitFor(() => expect(result.current.grants[0]?.role).toBe('editor'))

        act(() => result.current.onRemove(inserted.id))
        await waitFor(() => expect(result.current.grants).toHaveLength(0))
    })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd ~/code/tinycld/tinycld/core && pnpm exec vitest run tests/unit/use-group-grants.test.tsx`
Expected: FAIL, cannot resolve `../../lib/groups/use-group-grants`.

- [ ] **Step 3: Write the hook**

`core/lib/groups/use-group-grants.ts`:

```ts
import { type Collection, eq, type UtilsRecord } from '@tanstack/db'
import { useLiveQuery } from '@tanstack/react-db'
import { mutation, useMutation } from '@tinycld/core/lib/mutations'
import { newRecordId } from 'pbtsdb/core'
import type { GroupGrant, GroupGrantRow, GroupRoleOption, NewGroupGrant } from './types'

export interface UseGroupGrantsOptions<
    Role extends string,
    Row extends GroupGrantRow<Role>,
    TUtils extends UtilsRecord,
    TInsert extends GroupGrantRow<Role>,
> {
    collection: Collection<Row, string | number, TUtils, never, TInsert>
    // Pins Role so buildRow and the role menu agree on the union.
    roles: readonly GroupRoleOption<Role>[]
    isForResource: (row: Row) => boolean
    buildRow: (grant: NewGroupGrant<Role>) => TInsert
}

/**
 * Query + mutations for the group grants on one resource of a package's
 * membership table. Generic over the package's collection, so core never
 * names a package table: the package passes its collection, a predicate that
 * picks the resource, and a builder that turns a core grant into its full
 * insert row. The result spreads straight into GroupShareSection.
 *
 * The query fetches grant rows (user = '') for the whole collection and the
 * predicate narrows to the resource in render. A grant table is small: one
 * row per (resource, group), and the caller's rules already confine what it
 * can read.
 */
export function useGroupGrants<
    Role extends string,
    Row extends GroupGrantRow<Role>,
    TUtils extends UtilsRecord,
    TInsert extends GroupGrantRow<Role>,
>({ collection, isForResource, buildRow }: UseGroupGrantsOptions<Role, Row, TUtils, TInsert>) {
    const { data: rows, isReady } = useLiveQuery(
        query => query.from({ grant: collection }).where(({ grant }) => eq(grant.user, '')),
        [collection]
    )

    const grants: GroupGrant<Role>[] = (rows ?? [])
        .filter(row => isForResource(row))
        .map(row => ({ grantId: row.id, groupId: row.group, role: row.role }))

    const add = useMutation<void, Error, { groupId: string; role: Role }>({
        mutationFn: mutation(function* ({ groupId, role }) {
            yield collection.insert(buildRow({ id: newRecordId(), user: '', group: groupId, role }))
        }),
    })
    const changeRole = useMutation<void, Error, { grantId: string; role: Role }>({
        mutationFn: mutation(function* ({ grantId, role }) {
            yield collection.update(grantId, (draft: GroupGrantRow<Role>) => {
                draft.role = role
            })
        }),
    })
    const remove = useMutation<void, Error, string>({
        mutationFn: mutation(function* (grantId) {
            yield collection.delete(grantId)
        }),
    })

    return {
        grants,
        isReady,
        onAdd: (groupId: string, role: Role) => add.mutate({ groupId, role }),
        onRoleChange: (grantId: string, role: Role) => changeRole.mutate({ grantId, role }),
        onRemove: (grantId: string) => remove.mutate(grantId),
        isPending: add.isPending || changeRole.isPending || remove.isPending,
    }
}
```

If tsc rejects the annotated update callback (`WritableDeep<TInsert>` not provably assignable to `GroupGrantRow<Role>`), replace that call with:

```ts
            yield collection.update(grantId, draft => {
                Object.assign(draft, { role })
            })
```

and keep a one-line comment saying why (`draft` is `WritableDeep<TInsert>`, a deferred type, so a direct property write does not typecheck).

- [ ] **Step 4: Run the test and typecheck**

Run: `cd ~/code/tinycld/tinycld/core && pnpm exec vitest run tests/unit/use-group-grants.test.tsx && pnpm exec tinycld-pkg typecheck`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
cd ~/code/tinycld/tinycld && git add core/lib/groups/use-group-grants.ts core/tests/unit/use-group-grants.test.tsx
git commit -m "feat(core): useGroupGrants hook for package membership tables"
```

### Task 7: `GroupPicker`, `GroupGrantRow`, `GroupShareSection`

**Files:**
- Create: `core/components/groups/GroupPicker.tsx`
- Create: `core/components/groups/GroupGrantRow.tsx`
- Create: `core/components/groups/GroupShareSection.tsx`
- Create: `core/lib/groups/use-group-summary.ts`
- Create: `core/tests/unit/use-group-summary.test.tsx`

**Interfaces:**
- Consumes: `useGroupGrants` return shape (Task 6), `useStore('groups', 'group_members')`.
- Produces:

```tsx
<GroupShareSection<Role>
    grants={GroupGrant<Role>[]} isReady={boolean} onAdd onRoleChange onRemove isPending
    roles={readonly GroupRoleOption<Role>[]} canManage={boolean} />
<GroupPicker<Role> isVisible excludeIds={Set<string>} roles onPick={(groupId, role) => void} onClose />
useGroupSummary(groupId): { name: string; description: string; memberCount: number; isReady: boolean }
```

- [ ] **Step 1: Write the failing summary-hook test**

`core/tests/unit/use-group-summary.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tinycld/core/lib/pocketbase', async () => {
    const { createCollection, localOnlyCollectionOptions } = await import('@tanstack/db')
    const mk = (id: string, initialData: { id: string }[]) =>
        createCollection(
            localOnlyCollectionOptions({ id, getKey: (r: { id: string }) => r.id, initialData })
        )
    const registry: Record<string, unknown> = {
        groups: mk('groups', [{ id: 'g1', name: 'Sales', description: 'Quota carriers' }]),
        group_members: mk('group_members', [
            { id: 'm1', group: 'g1', user: 'u1' },
            { id: 'm2', group: 'g1', user: 'u2' },
            { id: 'm3', group: 'g2', user: 'u3' },
        ]),
    }
    return { useStore: (...names: string[]) => names.map(n => registry[n]) }
})

import { useGroupSummary } from '../../lib/groups/use-group-summary'

afterEach(cleanup)

describe('useGroupSummary', () => {
    it('returns the group name and its member count', async () => {
        const { result } = renderHook(() => useGroupSummary('g1'))
        await waitFor(() => expect(result.current.isReady).toBe(true))
        expect(result.current).toMatchObject({ name: 'Sales', description: 'Quota carriers', memberCount: 2 })
    })

    it('reports a missing group as empty, not as an error', async () => {
        const { result } = renderHook(() => useGroupSummary('nope'))
        await waitFor(() => expect(result.current.isReady).toBe(true))
        expect(result.current).toMatchObject({ name: '', memberCount: 0 })
    })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd ~/code/tinycld/tinycld/core && pnpm exec vitest run tests/unit/use-group-summary.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the summary hook**

`core/lib/groups/use-group-summary.ts`:

```ts
import { count, eq } from '@tanstack/db'
import { useLiveQuery } from '@tanstack/react-db'
import { useStore } from '@tinycld/core/lib/pocketbase'

/** One group's display data plus its live member count, for a grant row. */
export function useGroupSummary(groupId: string) {
    const [groupsCollection, membersCollection] = useStore('groups', 'group_members')

    const { data: groups, isReady: groupReady } = useLiveQuery(
        query => query.from({ g: groupsCollection }).where(({ g }) => eq(g.id, groupId)),
        [groupId]
    )
    const { data: counts, isReady: countReady } = useLiveQuery(
        query =>
            query
                .from({ m: membersCollection })
                .where(({ m }) => eq(m.group, groupId))
                .groupBy(({ m }) => m.group)
                .select(({ m }) => ({ group: m.group, n: count(m.id) })),
        [groupId]
    )

    const group = groups?.[0]
    return {
        name: group?.name ?? '',
        description: group?.description ?? '',
        memberCount: counts?.[0]?.n ?? 0,
        isReady: groupReady && countReady,
    }
}
```

If `count` with `groupBy` is not available in the installed TanStack DB version, replace the second query with a plain `.where(eq(m.group, groupId))` and use `memberCount: counts?.length ?? 0`.

- [ ] **Step 4: Run the test**

Run: `cd ~/code/tinycld/tinycld/core && pnpm exec vitest run tests/unit/use-group-summary.test.tsx`
Expected: PASS.

- [ ] **Step 5: Write `GroupPicker`**

`core/components/groups/GroupPicker.tsx`:

```tsx
import { useLiveQuery } from '@tanstack/react-db'
import type { GroupRoleOption } from '@tinycld/core/lib/groups/types'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Button, ButtonText } from '@tinycld/core/ui/button'
import { Dialog } from '@tinycld/core/ui/dialog'
import { PlainInput } from '@tinycld/core/ui/PlainInput'
import { Search, UsersRound } from 'lucide-react-native'
import { useState } from 'react'
import { Pressable, Text, View } from 'react-native'

interface GroupPickerProps<Role extends string> {
    isVisible: boolean
    excludeIds: Set<string>
    roles: readonly GroupRoleOption<Role>[]
    onPick: (groupId: string, role: Role) => void
    onClose: () => void
}

interface Candidate {
    id: string
    name: string
    description: string
}

function useCandidates(query: string, excludeIds: Set<string>): Candidate[] {
    const [groupsCollection] = useStore('groups')
    const { data } = useLiveQuery(q => q.from({ g: groupsCollection }).orderBy(({ g }) => g.name))
    const needle = query.trim().toLowerCase()
    return (data ?? [])
        .filter(g => !excludeIds.has(g.id))
        .filter(g => !needle || g.name.toLowerCase().includes(needle))
        .map(g => ({ id: g.id, name: g.name, description: g.description ?? '' }))
}

export function GroupPicker<Role extends string>(props: GroupPickerProps<Role>) {
    if (!props.isVisible) return null
    return <GroupPickerOpen {...props} />
}

function GroupPickerOpen<Role extends string>({ excludeIds, roles, onPick, onClose }: GroupPickerProps<Role>) {
    const [query, setQuery] = useState('')
    const [role, setRole] = useState<Role>(roles[roles.length - 1]?.value as Role)
    const candidates = useCandidates(query, excludeIds)

    const handlePick = (groupId: string) => {
        onPick(groupId, role)
        onClose()
    }

    return (
        <Dialog isOpen onClose={onClose} title="Add a group" size="md">
            <View className="px-5 pb-2 gap-3">
                <SearchRow query={query} onChange={setQuery} />
                <RolePicker roles={roles} role={role} onChange={setRole} />
            </View>
            <CandidateList candidates={candidates} hasQuery={query.trim().length > 0} onPick={handlePick} />
        </Dialog>
    )
}

function SearchRow({ query, onChange }: { query: string; onChange: (value: string) => void }) {
    const mutedColor = useThemeColor('muted')
    return (
        <View className="flex-row items-center gap-2 px-3 py-2 rounded-md border border-border bg-background">
            <Search size={15} color={mutedColor} strokeWidth={2.2} />
            <PlainInput
                testID="group-picker-search"
                value={query}
                onChangeText={onChange}
                placeholder="Search groups"
                placeholderTextColor={mutedColor}
                autoFocus
                className="flex-1 text-[13.5px] text-foreground"
            />
        </View>
    )
}

function RolePicker<Role extends string>({
    roles,
    role,
    onChange,
}: {
    roles: readonly GroupRoleOption<Role>[]
    role: Role
    onChange: (role: Role) => void
}) {
    return (
        <View className="flex-row flex-wrap gap-2">
            {roles.map(option => (
                <Pressable
                    key={option.value}
                    testID={`group-picker-role-${option.value}`}
                    accessibilityRole="button"
                    accessibilityState={{ selected: option.value === role }}
                    onPress={() => onChange(option.value)}
                    className={
                        option.value === role
                            ? 'px-3 py-1.5 rounded-md bg-primary'
                            : 'px-3 py-1.5 rounded-md border border-border bg-background'
                    }
                >
                    <Text
                        className={
                            option.value === role
                                ? 'text-[12px] font-semibold text-primary-foreground'
                                : 'text-[12px] font-semibold text-foreground'
                        }
                    >
                        {option.label}
                    </Text>
                </Pressable>
            ))}
        </View>
    )
}

function CandidateList({
    candidates,
    hasQuery,
    onPick,
}: {
    candidates: Candidate[]
    hasQuery: boolean
    onPick: (groupId: string) => void
}) {
    if (candidates.length === 0) {
        return (
            <View className="px-5 py-6">
                <Text className="text-[13px] text-muted">
                    {hasQuery ? 'No matching groups' : 'Every group is already added'}
                </Text>
            </View>
        )
    }
    return (
        <Dialog.Body contentClassName="pb-3">
            {candidates.map(candidate => (
                <CandidateRow key={candidate.id} candidate={candidate} onPick={onPick} />
            ))}
        </Dialog.Body>
    )
}

function CandidateRow({ candidate, onPick }: { candidate: Candidate; onPick: (groupId: string) => void }) {
    const fgColor = useThemeColor('foreground')
    return (
        <View testID={`group-picker-row-${candidate.id}`} className="flex-row items-center gap-3 px-4 py-2.5">
            <UsersRound size={20} color={fgColor} />
            <View className="flex-1 min-w-0">
                <Text className="text-[13.5px] font-medium text-foreground" numberOfLines={1}>
                    {candidate.name}
                </Text>
                <Description text={candidate.description} />
            </View>
            <Button size="sm" onPress={() => onPick(candidate.id)}>
                <ButtonText>Add</ButtonText>
            </Button>
        </View>
    )
}

function Description({ text }: { text: string }) {
    if (!text) return null
    return (
        <Text className="text-[12px] text-muted" numberOfLines={1}>
            {text}
        </Text>
    )
}
```

The `as Role` on the initial role state is a narrowing of `Role | undefined` for an empty `roles` array; if biome or tsc objects, initialise with `roles[roles.length - 1].value` and require `roles` to be non-empty in the prop's JSDoc.

- [ ] **Step 6: Write `GroupGrantRow`**

`core/components/groups/GroupGrantRow.tsx`:

```tsx
import type { GroupGrant, GroupRoleOption } from '@tinycld/core/lib/groups/types'
import { useGroupSummary } from '@tinycld/core/lib/groups/use-group-summary'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Menu } from '@tinycld/core/ui/menu'
import { ChevronDown, UsersRound, X } from 'lucide-react-native'
import { Pressable, Text, View } from 'react-native'

interface GroupGrantRowProps<Role extends string> {
    grant: GroupGrant<Role>
    roles: readonly GroupRoleOption<Role>[]
    canManage: boolean
    onRoleChange: (grantId: string, role: Role) => void
    onRemove: (grantId: string) => void
}

function memberLabel(count: number) {
    return count === 1 ? '1 member' : `${count} members`
}

export function GroupGrantRow<Role extends string>({ grant, roles, canManage, onRoleChange, onRemove }: GroupGrantRowProps<Role>) {
    const summary = useGroupSummary(grant.groupId)
    const fgColor = useThemeColor('foreground')
    const roleLabel = roles.find(r => r.value === grant.role)?.label ?? grant.role

    return (
        <View testID={`group-grant-row-${grant.groupId}`} className="flex-row items-center gap-3 py-2.5 px-3">
            <UsersRound size={22} color={fgColor} />
            <View className="flex-1 min-w-0">
                <Text className="text-[13.5px] font-medium text-foreground" numberOfLines={1}>
                    {summary.name}
                </Text>
                <Text className="text-[12px] text-muted" numberOfLines={1}>
                    {memberLabel(summary.memberCount)}
                </Text>
            </View>
            <RoleControl
                label={roleLabel}
                name={summary.name}
                roles={roles}
                current={grant.role}
                canManage={canManage}
                onSelect={role => onRoleChange(grant.grantId, role)}
            />
            <RemoveButton isVisible={canManage} name={summary.name} onPress={() => onRemove(grant.grantId)} />
        </View>
    )
}

function RoleControl<Role extends string>({
    label,
    name,
    roles,
    current,
    canManage,
    onSelect,
}: {
    label: string
    name: string
    roles: readonly GroupRoleOption<Role>[]
    current: Role
    canManage: boolean
    onSelect: (role: Role) => void
}) {
    const mutedColor = useThemeColor('muted')
    if (!canManage) {
        return (
            <View className="px-2.5 py-1 rounded-md bg-foreground/[0.06]">
                <Text className="text-[12px] font-medium text-foreground">{label}</Text>
            </View>
        )
    }
    return (
        <Menu
            trigger={
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Change role for group ${name}`}
                    className="flex-row items-center gap-1 px-2.5 py-1 rounded-md border border-border bg-background web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring"
                >
                    <Text className="text-[12px] font-medium text-foreground">{label}</Text>
                    <ChevronDown size={14} color={mutedColor} strokeWidth={2.2} />
                </Pressable>
            }
            placement="bottom-end"
            title="Role"
        >
            {roles.map(option => (
                <Menu.Item
                    key={option.value}
                    label={option.label}
                    isSelected={option.value === current}
                    onSelect={() => onSelect(option.value)}
                />
            ))}
        </Menu>
    )
}

function RemoveButton({ isVisible, name, onPress }: { isVisible: boolean; name: string; onPress: () => void }) {
    const dangerColor = useThemeColor('danger')
    if (!isVisible) return <View style={{ width: 28, height: 28 }} />
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Remove group ${name}`}
            onPress={onPress}
            hitSlop={8}
            className="p-1.5 rounded-md web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring"
        >
            <X size={16} color={dangerColor} strokeWidth={2.2} />
        </Pressable>
    )
}
```

- [ ] **Step 7: Write `GroupShareSection`**

`core/components/groups/GroupShareSection.tsx`:

```tsx
import type { GroupGrant, GroupRoleOption } from '@tinycld/core/lib/groups/types'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Button, ButtonText } from '@tinycld/core/ui/button'
import { UsersRound } from 'lucide-react-native'
import { useState } from 'react'
import { Text, View } from 'react-native'
import { GroupGrantRow } from './GroupGrantRow'
import { GroupPicker } from './GroupPicker'

interface GroupShareSectionProps<Role extends string> {
    grants: GroupGrant<Role>[]
    isReady: boolean
    roles: readonly GroupRoleOption<Role>[]
    canManage: boolean
    isPending: boolean
    onAdd: (groupId: string, role: Role) => void
    onRoleChange: (grantId: string, role: Role) => void
    onRemove: (grantId: string) => void
}

/**
 * The group half of a package's share dialog. Drop it under the user list;
 * feed it the spread of useGroupGrants plus the package's role options and
 * whether the caller may manage sharing.
 */
export function GroupShareSection<Role extends string>({
    grants,
    isReady,
    roles,
    canManage,
    isPending,
    onAdd,
    onRoleChange,
    onRemove,
}: GroupShareSectionProps<Role>) {
    const [isPicking, setIsPicking] = useState(false)
    const fgColor = useThemeColor('foreground')
    const isEmpty = isReady && grants.length === 0

    if (!canManage && isEmpty) return null

    return (
        <View testID="group-share-section" className="mt-4 gap-2">
            <View className="flex-row items-center justify-between">
                <Text className="text-[12px] font-semibold text-muted uppercase tracking-wide">Groups</Text>
                <AddGroupButton isVisible={canManage} color={fgColor} isPending={isPending} onPress={() => setIsPicking(true)} />
            </View>
            <EmptyNote isVisible={isEmpty} />
            <GrantList grants={grants} roles={roles} canManage={canManage} onRoleChange={onRoleChange} onRemove={onRemove} />
            <GroupPicker
                isVisible={isPicking}
                excludeIds={new Set(grants.map(g => g.groupId))}
                roles={roles}
                onPick={onAdd}
                onClose={() => setIsPicking(false)}
            />
        </View>
    )
}

function AddGroupButton({
    isVisible,
    color,
    isPending,
    onPress,
}: {
    isVisible: boolean
    color: string
    isPending: boolean
    onPress: () => void
}) {
    if (!isVisible) return null
    return (
        <Button size="sm" variant="outline" onPress={onPress} isDisabled={isPending}>
            <UsersRound size={14} color={color} strokeWidth={2.2} />
            <ButtonText>Add group</ButtonText>
        </Button>
    )
}

function EmptyNote({ isVisible }: { isVisible: boolean }) {
    if (!isVisible) return null
    return <Text className="text-[12px] text-muted px-1">No groups yet. Everyone in a group you add gets this role.</Text>
}

function GrantList<Role extends string>({
    grants,
    roles,
    canManage,
    onRoleChange,
    onRemove,
}: {
    grants: GroupGrant<Role>[]
    roles: readonly GroupRoleOption<Role>[]
    canManage: boolean
    onRoleChange: (grantId: string, role: Role) => void
    onRemove: (grantId: string) => void
}) {
    if (grants.length === 0) return null
    return (
        <View className="rounded-xl border border-border overflow-hidden">
            {grants.map((grant, index) => (
                <View key={grant.grantId} className={index > 0 ? 'border-t border-border' : ''}>
                    <GroupGrantRow grant={grant} roles={roles} canManage={canManage} onRoleChange={onRoleChange} onRemove={onRemove} />
                </View>
            ))}
        </View>
    )
}
```

- [ ] **Step 8: Check and commit**

Run: `cd ~/code/tinycld/tinycld/core && pnpm exec tinycld-pkg check`
Expected: biome clean, tsc clean, vitest PASS. Fix every reported issue.

```bash
cd ~/code/tinycld/tinycld && git add core/components/groups/ core/lib/groups/use-group-summary.ts core/tests/unit/use-group-summary.test.tsx
git commit -m "feat(core): GroupShareSection and GroupPicker for package share dialogs"
```

### Task 8: Groups settings page

**Files:**
- Create: `core/lib/groups/use-groups-admin.ts`
- Create: `core/tests/unit/use-groups-admin.test.tsx`
- Create: `core/components/settings/groups/GroupsList.tsx`
- Create: `core/components/settings/groups/GroupDrawer.tsx`
- Create: `app/a/(app)/settings/groups.tsx`
- Modify: `app/a/(app)/settings/index.tsx` (add a link after Members)

**Interfaces:**
- Produces:

```ts
useGroupsAdmin(): {
    groups: { id: string; name: string; description: string; memberCount: number }[]
    isReady: boolean
    createGroup: (input: { name: string; description: string }) => Promise<string>  // returns new id
    updateGroup: (id: string, input: { name: string; description: string }) => void
    deleteGroup: (id: string) => void
    isPending: boolean
}
useGroupMembersAdmin(groupId): {
    members: { membershipId: string; userId: string; name: string; email: string }[]
    candidates: { userId: string; name: string; email: string }[]   // non-guest, enabled, not yet members
    addMember: (userId: string) => void
    removeMember: (membershipId: string) => void
    isPending: boolean
}
```

- [ ] **Step 1: Write the failing hook test**

`core/tests/unit/use-groups-admin.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ registry: {} as Record<string, unknown> }))

vi.mock('@tinycld/core/lib/pocketbase', async () => {
    const { createCollection, localOnlyCollectionOptions } = await import('@tanstack/db')
    const mk = (id: string, initialData: { id: string }[]) =>
        createCollection(
            localOnlyCollectionOptions({ id: `${id}-${Math.random()}`, getKey: (r: { id: string }) => r.id, initialData })
        )
    h.registry = {
        groups: mk('groups', [{ id: 'g1', name: 'Sales', description: '' }]),
        group_members: mk('group_members', [{ id: 'm1', group: 'g1', user: 'u1' }]),
        users: mk('users', [
            { id: 'u1', name: 'Ann', email: 'ann@x.test', role: 'member', disabled: false },
            { id: 'u2', name: 'Bo', email: 'bo@x.test', role: 'member', disabled: false },
            { id: 'u3', name: 'Guest', email: 'g@x.test', role: 'guest', disabled: false },
            { id: 'u4', name: 'Off', email: 'off@x.test', role: 'member', disabled: true },
        ]),
    }
    return { useStore: (...names: string[]) => names.map(n => h.registry[n]) }
})

import { useGroupMembersAdmin, useGroupsAdmin } from '../../lib/groups/use-groups-admin'

function wrapper() {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    return ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
}

afterEach(cleanup)

describe('useGroupsAdmin', () => {
    it('lists groups with member counts and creates a new group', async () => {
        const { result } = renderHook(() => useGroupsAdmin(), { wrapper: wrapper() })
        await waitFor(() => expect(result.current.isReady).toBe(true))
        expect(result.current.groups).toEqual([{ id: 'g1', name: 'Sales', description: '', memberCount: 1 }])

        let newId = ''
        await act(async () => {
            newId = await result.current.createGroup({ name: 'Ops', description: 'On call' })
        })
        await waitFor(() => expect(result.current.groups).toHaveLength(2))
        expect(result.current.groups.find(g => g.id === newId)).toMatchObject({ name: 'Ops', memberCount: 0 })
    })
})

describe('useGroupMembersAdmin', () => {
    it('offers only enabled non-guest non-members as candidates', async () => {
        const { result } = renderHook(() => useGroupMembersAdmin('g1'), { wrapper: wrapper() })
        await waitFor(() => expect(result.current.members).toHaveLength(1))
        expect(result.current.members[0]).toMatchObject({ userId: 'u1', name: 'Ann' })
        expect(result.current.candidates.map(c => c.userId)).toEqual(['u2'])

        act(() => result.current.addMember('u2'))
        await waitFor(() => expect(result.current.members).toHaveLength(2))
        expect(result.current.candidates).toHaveLength(0)
    })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd ~/code/tinycld/tinycld/core && pnpm exec vitest run tests/unit/use-groups-admin.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the admin hooks**

`core/lib/groups/use-groups-admin.ts`:

```ts
import { and, count, eq, not } from '@tanstack/db'
import { useLiveQuery } from '@tanstack/react-db'
import { mutation, performMutations, useMutation } from '@tinycld/core/lib/mutations'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { newRecordId } from 'pbtsdb/core'

export interface GroupInput {
    name: string
    description: string
}

/** Groups list with live member counts, plus create/update/delete. */
export function useGroupsAdmin() {
    const [groupsCollection, membersCollection] = useStore('groups', 'group_members')

    const { data: groupRows, isReady: groupsReady } = useLiveQuery(query =>
        query.from({ g: groupsCollection }).orderBy(({ g }) => g.name)
    )
    const { data: counts, isReady: countsReady } = useLiveQuery(query =>
        query
            .from({ m: membersCollection })
            .groupBy(({ m }) => m.group)
            .select(({ m }) => ({ group: m.group, n: count(m.id) }))
    )
    // Two queries joined in render rather than one .join(): a left join with
    // an aggregate is not expressible in one TanStack DB query today.
    const countByGroup = new Map((counts ?? []).map(c => [c.group, c.n]))
    const groups = (groupRows ?? []).map(g => ({
        id: g.id,
        name: g.name,
        description: g.description ?? '',
        memberCount: countByGroup.get(g.id) ?? 0,
    }))

    const update = useMutation<void, Error, { id: string; input: GroupInput }>({
        mutationFn: mutation(function* ({ id, input }) {
            yield groupsCollection.update(id, draft => {
                draft.name = input.name
                draft.description = input.description
            })
        }),
    })
    const remove = useMutation<void, Error, string>({
        mutationFn: mutation(function* (id) {
            yield groupsCollection.delete(id)
        }),
    })

    const createGroup = (input: GroupInput) =>
        performMutations(function* () {
            const id = newRecordId()
            yield groupsCollection.insert({ id, name: input.name, description: input.description })
            return id
        })

    return {
        groups,
        isReady: groupsReady && countsReady,
        createGroup,
        updateGroup: (id: string, input: GroupInput) => update.mutate({ id, input }),
        deleteGroup: (id: string) => remove.mutate(id),
        isPending: update.isPending || remove.isPending,
    }
}

/** Members of one group, the users who could still be added, and add/remove. */
export function useGroupMembersAdmin(groupId: string) {
    const [membersCollection, usersCollection] = useStore('group_members', 'users')

    const { data: memberRows } = useLiveQuery(
        query =>
            query
                .from({ m: membersCollection })
                .innerJoin({ u: usersCollection }, ({ m, u }) => eq(m.user, u.id))
                .where(({ m }) => eq(m.group, groupId))
                .select(({ m, u }) => ({ membershipId: m.id, userId: u.id, name: u.name, email: u.email })),
        [groupId]
    )
    const { data: eligible } = useLiveQuery(query =>
        query
            .from({ u: usersCollection })
            .where(({ u }) => and(not(eq(u.role, 'guest')), not(eq(u.disabled, true))))
            .orderBy(({ u }) => u.name)
            .select(({ u }) => ({ userId: u.id, name: u.name, email: u.email }))
    )

    const members = [...(memberRows ?? [])].sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email))
    const memberIds = new Set(members.map(m => m.userId))
    const candidates = (eligible ?? []).filter(u => !memberIds.has(u.userId))

    const add = useMutation<void, Error, string>({
        mutationFn: mutation(function* (userId) {
            yield membersCollection.insert({ id: newRecordId(), group: groupId, user: userId })
        }),
    })
    const remove = useMutation<void, Error, string>({
        mutationFn: mutation(function* (membershipId) {
            yield membersCollection.delete(membershipId)
        }),
    })

    return {
        members,
        candidates,
        addMember: (userId: string) => add.mutate(userId),
        removeMember: (membershipId: string) => remove.mutate(membershipId),
        isPending: add.isPending || remove.isPending,
    }
}
```

If `performMutations` does not accept a generator that returns a value in the installed signature, check `core/lib/mutations.ts` (`performMutations<TResult>`), which does; if the type still fails, return `Promise.resolve(id)` after `await performMutations(...)` in a small async wrapper.

- [ ] **Step 4: Run the test**

Run: `cd ~/code/tinycld/tinycld/core && pnpm exec vitest run tests/unit/use-groups-admin.test.tsx`
Expected: PASS.

- [ ] **Step 5: Write `GroupsList`**

`core/components/settings/groups/GroupsList.tsx`:

```tsx
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { ChevronRight, UsersRound } from 'lucide-react-native'
import { Pressable, Text, View } from 'react-native'

export interface GroupListRow {
    id: string
    name: string
    description: string
    memberCount: number
}

interface GroupsListProps {
    groups: GroupListRow[]
    isReady: boolean
    onOpen: (groupId: string) => void
}

function memberLabel(count: number) {
    return count === 1 ? '1 member' : `${count} members`
}

export function GroupsList({ groups, isReady, onOpen }: GroupsListProps) {
    const mutedColor = useThemeColor('muted-foreground')
    if (isReady && groups.length === 0) return <EmptyState color={mutedColor} />
    return (
        <View className="rounded-xl overflow-hidden bg-surface-secondary border border-border">
            {groups.map((group, index) => (
                <GroupRow key={group.id} group={group} isFirst={index === 0} onOpen={onOpen} />
            ))}
        </View>
    )
}

function GroupRow({ group, isFirst, onOpen }: { group: GroupListRow; isFirst: boolean; onOpen: (id: string) => void }) {
    const mutedColor = useThemeColor('muted-foreground')
    const fgColor = useThemeColor('foreground')
    return (
        <Pressable
            testID={`group-row-${group.name}`}
            onPress={() => onOpen(group.id)}
            className="flex-row items-center gap-3 border-border"
            style={{ paddingVertical: 12, paddingHorizontal: 14, borderTopWidth: isFirst ? 0 : 1 }}
        >
            <UsersRound size={20} color={fgColor} />
            <View className="flex-1 min-w-0">
                <Text className="text-foreground" style={{ fontSize: 14, fontWeight: '600' }} numberOfLines={1}>
                    {group.name}
                </Text>
                <Text className="text-muted-foreground" style={{ fontSize: 12 }} numberOfLines={1}>
                    {memberLabel(group.memberCount)}
                    {group.description ? ` · ${group.description}` : ''}
                </Text>
            </View>
            <ChevronRight size={15} color={mutedColor} />
        </Pressable>
    )
}

function EmptyState({ color }: { color: string }) {
    return (
        <View
            className="items-center gap-3 rounded-xl bg-surface-secondary border border-border"
            style={{ paddingVertical: 32, paddingHorizontal: 24 }}
        >
            <UsersRound size={28} color={color} />
            <Text className="text-foreground" style={{ fontSize: 15, fontWeight: '600' }}>
                No groups yet
            </Text>
            <Text className="text-muted-foreground" style={{ fontSize: 13, textAlign: 'center' }}>
                Create a group to share boards, files and calendars with a whole team at once.
            </Text>
        </View>
    )
}
```

- [ ] **Step 6: Write `GroupDrawer`**

`core/components/settings/groups/GroupDrawer.tsx`:

```tsx
import { Avatar } from '@tinycld/core/components/Avatar'
import { handleMutationErrorsWithForm } from '@tinycld/core/lib/errors'
import { type GroupInput, useGroupMembersAdmin, useGroupsAdmin } from '@tinycld/core/lib/groups/use-groups-admin'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { ConfirmDialog } from '@tinycld/core/ui/ConfirmDialog'
import {
    Drawer,
    DrawerBackdrop,
    DrawerBody,
    DrawerCloseButton,
    DrawerContent,
    DrawerFooter,
    DrawerHeader,
} from '@tinycld/core/ui/drawer'
import { Controller, FormErrorSummary, TextInput, useForm, z, zodResolver } from '@tinycld/core/ui/form'
import { PlainInput } from '@tinycld/core/ui/PlainInput'
import { Search, Trash2, UserPlus, X } from 'lucide-react-native'
import { useState } from 'react'
import { Pressable, Text, View } from 'react-native'

export type GroupDrawerMode = { kind: 'closed' } | { kind: 'create' } | { kind: 'view'; groupId: string }

interface GroupDrawerProps {
    mode: GroupDrawerMode
    onClose: () => void
    onCreated: (groupId: string) => void
}

const groupSchema = z.object({
    name: z.string().trim().min(1, 'Give the group a name').max(100, 'Keep it under 100 characters'),
    description: z.string().trim().max(500, 'Keep it under 500 characters'),
})
type GroupFormValues = z.infer<typeof groupSchema>

export function GroupDrawer({ mode, onClose, onCreated }: GroupDrawerProps) {
    const isOpen = mode.kind !== 'closed'
    return (
        <Drawer isOpen={isOpen} onClose={onClose} anchor="right" size="md">
            <DrawerBackdrop />
            <DrawerContent>
                <CreateView isVisible={mode.kind === 'create'} onClose={onClose} onCreated={onCreated} />
                <ViewGroup groupId={mode.kind === 'view' ? mode.groupId : ''} onClose={onClose} />
            </DrawerContent>
        </Drawer>
    )
}

function useGroupForm(defaults: GroupFormValues) {
    return useForm<GroupFormValues>({
        mode: 'onChange',
        resolver: zodResolver(groupSchema),
        defaultValues: defaults,
    })
}

function CreateView({ isVisible, onClose, onCreated }: { isVisible: boolean; onClose: () => void; onCreated: (id: string) => void }) {
    if (!isVisible) return null
    return <CreateViewOpen onClose={onClose} onCreated={onCreated} />
}

function CreateViewOpen({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
    const { createGroup } = useGroupsAdmin()
    const form = useGroupForm({ name: '', description: '' })
    const [isSaving, setIsSaving] = useState(false)
    const onSubmit = form.handleSubmit(async values => {
        setIsSaving(true)
        try {
            const id = await createGroup(values)
            onCreated(id)
        } catch (error) {
            handleMutationErrorsWithForm({ setError: form.setError, getValues: form.getValues })(error)
        } finally {
            setIsSaving(false)
        }
    })
    return (
        <>
            <Header title="New group" subtitle="Share with everyone in it at once" onClose={onClose} />
            <DrawerBody>
                <GroupFields form={form} />
            </DrawerBody>
            <DrawerFooter>
                <FooterActions
                    primaryLabel={isSaving ? 'Creating…' : 'Create group'}
                    primaryTestID="group-create-submit"
                    isDisabled={isSaving || !form.formState.isValid}
                    onCancel={onClose}
                    onPrimary={onSubmit}
                />
            </DrawerFooter>
        </>
    )
}

function ViewGroup({ groupId, onClose }: { groupId: string; onClose: () => void }) {
    if (!groupId) return null
    return <ViewGroupOpen groupId={groupId} onClose={onClose} />
}

function ViewGroupOpen({ groupId, onClose }: { groupId: string; onClose: () => void }) {
    const { groups, updateGroup, deleteGroup, isPending } = useGroupsAdmin()
    const group = groups.find(g => g.id === groupId)
    const form = useGroupForm({ name: group?.name ?? '', description: group?.description ?? '' })
    const [isDeleting, setIsDeleting] = useState(false)
    const onSave = form.handleSubmit(values => updateGroup(groupId, values))

    return (
        <>
            <Header title={group?.name ?? 'Group'} subtitle="Members and details" onClose={onClose} />
            <DrawerBody>
                <View className="gap-5">
                    <GroupFields form={form} />
                    <SaveRow isVisible={form.formState.isDirty} isDisabled={isPending || !form.formState.isValid} onPress={onSave} />
                    <MembersSection groupId={groupId} />
                </View>
            </DrawerBody>
            <DrawerFooter>
                <DeleteRow name={group?.name ?? ''} onPress={() => setIsDeleting(true)} />
            </DrawerFooter>
            <ConfirmDialog
                isOpen={isDeleting}
                onClose={() => setIsDeleting(false)}
                onConfirm={() => {
                    deleteGroup(groupId)
                    setIsDeleting(false)
                    onClose()
                }}
                title={`Delete “${group?.name ?? ''}”?`}
                message="Every share granted to this group is removed. Members keep anything shared with them directly."
                confirmLabel="Delete group"
                isDestructive
                isSubmitting={isPending}
            />
        </>
    )
}

function Header({ title, subtitle, onClose }: { title: string; subtitle: string; onClose: () => void }) {
    const mutedColor = useThemeColor('muted-foreground')
    return (
        <DrawerHeader>
            <View className="flex-1 gap-0.5">
                <Text className="text-foreground" style={{ fontSize: 17, fontWeight: '700' }}>
                    {title}
                </Text>
                <Text className="text-muted-foreground" style={{ fontSize: 12 }}>
                    {subtitle}
                </Text>
            </View>
            <DrawerCloseButton onPress={onClose}>
                <X size={18} color={mutedColor} />
            </DrawerCloseButton>
        </DrawerHeader>
    )
}

function GroupFields({ form }: { form: ReturnType<typeof useGroupForm> }) {
    return (
        <View className="gap-4">
            <FormErrorSummary errors={form.formState.errors} isEnabled={form.formState.isSubmitted} />
            <TextInput control={form.control} name="name" label="Name" placeholder="Sales" testID="group-name-input" />
            <TextInput
                control={form.control}
                name="description"
                label="Description"
                placeholder="Optional"
                testID="group-description-input"
            />
        </View>
    )
}

function SaveRow({ isVisible, isDisabled, onPress }: { isVisible: boolean; isDisabled: boolean; onPress: () => void }) {
    if (!isVisible) return null
    return (
        <View className="flex-row justify-end">
            <PrimaryButton label="Save" testID="group-save" isDisabled={isDisabled} onPress={onPress} />
        </View>
    )
}

function MembersSection({ groupId }: { groupId: string }) {
    const { members, candidates, addMember, removeMember, isPending } = useGroupMembersAdmin(groupId)
    const [query, setQuery] = useState('')
    const needle = query.trim().toLowerCase()
    const shown = candidates
        .filter(c => !needle || c.name.toLowerCase().includes(needle) || c.email.toLowerCase().includes(needle))
        .slice(0, 20)
    const mutedColor = useThemeColor('muted')

    return (
        <View className="gap-3">
            <Text className="text-[12px] font-semibold text-muted uppercase tracking-wide">Members</Text>
            <View className="rounded-xl border border-border overflow-hidden">
                {members.map((member, index) => (
                    <View key={member.membershipId} className={index > 0 ? 'border-t border-border' : ''}>
                        <MemberRow
                            userId={member.userId}
                            name={member.name}
                            email={member.email}
                            onRemove={() => removeMember(member.membershipId)}
                        />
                    </View>
                ))}
                <NoMembersNote isVisible={members.length === 0} />
            </View>
            <View className="flex-row items-center gap-2 px-3 py-2 rounded-md border border-border bg-background">
                <Search size={15} color={mutedColor} strokeWidth={2.2} />
                <PlainInput
                    testID="group-add-member-search"
                    value={query}
                    onChangeText={setQuery}
                    placeholder="Add a person by name or email"
                    placeholderTextColor={mutedColor}
                    className="flex-1 text-[13.5px] text-foreground"
                />
            </View>
            <CandidateRows isVisible={needle.length > 0} candidates={shown} isPending={isPending} onAdd={addMember} />
        </View>
    )
}

function MemberRow({ userId, name, email, onRemove }: { userId: string; name: string; email: string; onRemove: () => void }) {
    const dangerColor = useThemeColor('danger')
    return (
        <View testID={`group-member-row-${email}`} className="flex-row items-center gap-3 py-2.5 px-3">
            <Avatar name={name || email} email={email} colorKey={userId} size={28} />
            <View className="flex-1 min-w-0">
                <Text className="text-[13.5px] font-medium text-foreground" numberOfLines={1}>
                    {name || email}
                </Text>
                <Text className="text-[12px] text-muted" numberOfLines={1}>
                    {email}
                </Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${name || email} from group`} onPress={onRemove} hitSlop={8} className="p-1.5 rounded-md">
                <X size={16} color={dangerColor} strokeWidth={2.2} />
            </Pressable>
        </View>
    )
}

function NoMembersNote({ isVisible }: { isVisible: boolean }) {
    if (!isVisible) return null
    return (
        <View className="px-3 py-3">
            <Text className="text-[12px] text-muted">No members yet.</Text>
        </View>
    )
}

function CandidateRows({
    isVisible,
    candidates,
    isPending,
    onAdd,
}: {
    isVisible: boolean
    candidates: { userId: string; name: string; email: string }[]
    isPending: boolean
    onAdd: (userId: string) => void
}) {
    const primaryFgColor = useThemeColor('primary-foreground')
    if (!isVisible) return null
    if (candidates.length === 0) return <Text className="text-[12px] text-muted px-1">No matching people</Text>
    return (
        <View className="rounded-xl border border-border overflow-hidden">
            {candidates.map((candidate, index) => (
                <View key={candidate.userId} className={index > 0 ? 'border-t border-border' : ''}>
                    <View testID={`group-candidate-row-${candidate.email}`} className="flex-row items-center gap-3 py-2.5 px-3">
                        <View className="flex-1 min-w-0">
                            <Text className="text-[13.5px] font-medium text-foreground" numberOfLines={1}>
                                {candidate.name || candidate.email}
                            </Text>
                            <Text className="text-[12px] text-muted" numberOfLines={1}>
                                {candidate.email}
                            </Text>
                        </View>
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`Add ${candidate.name || candidate.email}`}
                            disabled={isPending}
                            onPress={() => onAdd(candidate.userId)}
                            className="flex-row items-center gap-1.5 rounded-md bg-primary"
                            style={{ paddingVertical: 6, paddingHorizontal: 10, opacity: isPending ? 0.5 : 1 }}
                        >
                            <UserPlus size={13} color={primaryFgColor} />
                            <Text className="text-primary-foreground" style={{ fontSize: 12, fontWeight: '700' }}>
                                Add
                            </Text>
                        </Pressable>
                    </View>
                </View>
            ))}
        </View>
    )
}

function DeleteRow({ name, onPress }: { name: string; onPress: () => void }) {
    const dangerColor = useThemeColor('danger')
    return (
        <Pressable
            testID="group-delete"
            accessibilityRole="button"
            accessibilityLabel={`Delete group ${name}`}
            onPress={onPress}
            className="flex-row items-center gap-2 rounded-md"
            style={{ paddingVertical: 8, paddingHorizontal: 12 }}
        >
            <Trash2 size={14} color={dangerColor} />
            <Text className="text-danger" style={{ fontSize: 13, fontWeight: '600' }}>
                Delete group
            </Text>
        </Pressable>
    )
}

function FooterActions({
    primaryLabel,
    primaryTestID,
    isDisabled,
    onCancel,
    onPrimary,
}: {
    primaryLabel: string
    primaryTestID: string
    isDisabled: boolean
    onCancel: () => void
    onPrimary: () => void
}) {
    return (
        <View className="flex-row items-center justify-end gap-2">
            <Pressable onPress={onCancel} className="rounded-md" style={{ paddingVertical: 8, paddingHorizontal: 14 }}>
                <Text className="text-muted-foreground" style={{ fontSize: 13, fontWeight: '600' }}>
                    Cancel
                </Text>
            </Pressable>
            <PrimaryButton label={primaryLabel} testID={primaryTestID} isDisabled={isDisabled} onPress={onPrimary} />
        </View>
    )
}

function PrimaryButton({ label, testID, isDisabled, onPress }: { label: string; testID: string; isDisabled: boolean; onPress: () => void }) {
    return (
        <Pressable
            testID={testID}
            onPress={onPress}
            disabled={isDisabled}
            className="rounded-md bg-primary"
            style={{ paddingVertical: 8, paddingHorizontal: 14, opacity: isDisabled ? 0.5 : 1 }}
        >
            <Text className="text-primary-foreground" style={{ fontSize: 13, fontWeight: '700' }}>
                {label}
            </Text>
        </Pressable>
    )
}
```

`Controller` is imported for parity with the members drawer; remove the import if biome flags it as unused. If `TextInput` from `@tinycld/core/ui/form` does not accept `testID`, check its props in `core/ui/form/` and pass the id through the prop it exposes (or drop the ids and target by label in the e2e).

- [ ] **Step 7: Write the settings page and nav link**

`app/a/(app)/settings/groups.tsx`:

```tsx
import { DocumentTitle } from '@tinycld/core/components/DocumentTitle'
import { type GroupDrawerMode, GroupDrawer } from '@tinycld/core/components/settings/groups/GroupDrawer'
import { GroupsList } from '@tinycld/core/components/settings/groups/GroupsList'
import { useGroupsAdmin } from '@tinycld/core/lib/groups/use-groups-admin'
import { useOrgHref } from '@tinycld/core/lib/org-routes'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { useCurrentRole } from '@tinycld/core/lib/use-current-role'
import { useNavigateBack } from '@tinycld/core/lib/use-navigate-back'
import { ArrowLeft, Plus, UsersRound } from 'lucide-react-native'
import { useState } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'

export default function GroupsSettings() {
    const orgHref = useOrgHref()
    const navigateBack = useNavigateBack(() => orgHref('settings'))
    const { isAdmin } = useCurrentRole()
    const { groups, isReady } = useGroupsAdmin()
    const [drawerMode, setDrawerMode] = useState<GroupDrawerMode>({ kind: 'closed' })

    const fgColor = useThemeColor('foreground')
    const mutedColor = useThemeColor('muted-foreground')
    const primaryFgColor = useThemeColor('primary-foreground')

    if (!isAdmin) return <AdminRequired color={mutedColor} />

    return (
        <>
            <DocumentTitle pkg="Settings" title="Groups" />
            <ScrollView contentContainerStyle={{ flexGrow: 1 }} className="bg-background">
                <View className="flex-1 gap-6 p-5" style={{ maxWidth: 820 }}>
                    <View className="flex-row items-center gap-3">
                        <Pressable onPress={navigateBack} hitSlop={12} className="rounded-full" style={{ padding: 6 }}>
                            <ArrowLeft size={22} color={fgColor} />
                        </Pressable>
                        <View className="flex-1 gap-0.5">
                            <Text className="text-muted-foreground" style={{ fontSize: 11, letterSpacing: 0.6 }}>
                                Settings
                            </Text>
                            <Text className="text-foreground" style={{ fontSize: 24, fontWeight: '800' }}>
                                Groups
                            </Text>
                        </View>
                        <Pressable
                            testID="groups-new-button"
                            onPress={() => setDrawerMode({ kind: 'create' })}
                            className="flex-row items-center gap-1.5 rounded-lg bg-primary"
                            style={{ paddingVertical: 9, paddingHorizontal: 14 }}
                        >
                            <Plus size={14} color={primaryFgColor} />
                            <Text className="text-primary-foreground" style={{ fontSize: 13, fontWeight: '700' }}>
                                New group
                            </Text>
                        </Pressable>
                    </View>
                    <GroupsList groups={groups} isReady={isReady} onOpen={groupId => setDrawerMode({ kind: 'view', groupId })} />
                </View>
            </ScrollView>
            <GroupDrawer
                mode={drawerMode}
                onClose={() => setDrawerMode({ kind: 'closed' })}
                onCreated={groupId => setDrawerMode({ kind: 'view', groupId })}
            />
        </>
    )
}

function AdminRequired({ color }: { color: string }) {
    return (
        <View className="flex-1 items-center justify-center p-5 bg-background">
            <DocumentTitle pkg="Settings" title="Groups" />
            <View
                className="items-center gap-3 rounded-xl bg-surface-secondary border border-border"
                style={{ paddingVertical: 32, paddingHorizontal: 24 }}
            >
                <UsersRound size={28} color={color} />
                <Text className="text-foreground" style={{ fontSize: 15, fontWeight: '600' }}>
                    Admin access required
                </Text>
                <Text className="text-muted-foreground" style={{ fontSize: 13, textAlign: 'center' }}>
                    Only admins and owners can manage groups.
                </Text>
            </View>
        </View>
    )
}
```

In `app/a/(app)/settings/index.tsx`, add `UsersRound` to the `lucide-react-native` import and insert directly after the Members `SettingsLink` inside the Organization group:

```tsx
                <SettingsLink
                    label="Groups"
                    onPress={() => router.push(orgHref('settings/groups'))}
                    icon={<UsersRound size={20} color={foregroundColor} />}
                />
```

- [ ] **Step 8: Check and commit**

Run: `cd ~/code/tinycld/tinycld/core && pnpm exec tinycld-pkg check && cd ~/code/tinycld/tinycld && pnpm run checks`
Expected: clean. Fix every reported issue.

```bash
cd ~/code/tinycld/tinycld && git add core/lib/groups/use-groups-admin.ts core/tests/unit/use-groups-admin.test.tsx core/components/settings/groups/ "app/a/(app)/settings/groups.tsx" "app/a/(app)/settings/index.tsx"
git commit -m "feat(settings): groups admin page with member management"
```

### Task 9: Group chips in the members drawer, help topic

**Files:**
- Create: `core/components/settings/members/MemberGroupChips.tsx`
- Modify: `core/components/settings/members/MembersDrawer.tsx` (`ViewMember` body)
- Create: `core/help/groups.md`
- Modify: `core/help/organizations.md` (one sentence under "Administering the organization")

- [ ] **Step 1: Write the chips component**

`core/components/settings/members/MemberGroupChips.tsx`:

```tsx
import { eq } from '@tanstack/db'
import { useLiveQuery } from '@tanstack/react-db'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { Text, View } from 'react-native'

/**
 * Read-only: the groups one user belongs to. Membership is edited on
 * Settings → Groups so there is one place that changes it.
 */
export function MemberGroupChips({ userId }: { userId: string }) {
    const [membersCollection, groupsCollection] = useStore('group_members', 'groups')
    const { data: rows } = useLiveQuery(
        query =>
            query
                .from({ m: membersCollection })
                .innerJoin({ g: groupsCollection }, ({ m, g }) => eq(m.group, g.id))
                .where(({ m }) => eq(m.user, userId))
                .orderBy(({ g }) => g.name)
                .select(({ g }) => ({ id: g.id, name: g.name })),
        [userId]
    )
    const groups = rows ?? []
    if (groups.length === 0) return null
    return (
        <View className="gap-2">
            <Text className="text-[12px] font-semibold text-muted uppercase tracking-wide">Groups</Text>
            <View className="flex-row flex-wrap gap-1.5">
                {groups.map(group => (
                    <View key={group.id} testID={`member-group-chip-${group.name}`} className="px-2.5 py-1 rounded-full bg-foreground/[0.06]">
                        <Text className="text-[12px] font-medium text-foreground">{group.name}</Text>
                    </View>
                ))}
            </View>
        </View>
    )
}
```

- [ ] **Step 2: Render it in the members drawer**

In `core/components/settings/members/MembersDrawer.tsx`, import `MemberGroupChips` from `'./MemberGroupChips'`. In `ViewMember`, inside `<DrawerBody>`, add `<MemberGroupChips userId={member.userId} />` as the last child of the `<View className="gap-5">` container.

- [ ] **Step 3: Write the help topic**

`core/help/groups.md`:

```md
---
title: Groups
summary: Share with a whole team at once by putting people in a group
tags: [groups, sharing, members, teams]
order: 25
---

## What a group is

A **group** is a named set of people in your organization, such as *Sales* or
*Launch crew*. Wherever you can share something with a person, you can share
it with a group instead. Everyone in the group gets the role you choose, and
anyone who joins the group later gets it too. Anyone who leaves loses it.

Only admins and owners create groups and change who is in them. Guests cannot
be in a group.

## Create a group

1. Open **Settings → Groups**.
2. Choose **New group**, give it a name, and create it.
3. In the group's panel, search for people by name or email and add them.

To rename a group or change its description, open it and edit the fields.

## Share with a group

In a package's share dialog, look for the **Groups** section under the list of
people. Choose **Add group**, pick a role, and pick the group. The group
appears in the list with its member count. Change the role or remove the
group from the same place.

A group can never be an owner. Owners are always individual people.

If a person is shared with directly and also through a group, the stronger
role applies.

## Delete a group

Open the group and choose **Delete group**. Every share granted to the group is
removed. Anything shared with a person directly stays.

## See which groups someone is in

Open **Settings → Members**, choose the person, and look for **Groups** in
their panel.
```

In `core/help/organizations.md`, under "Administering the organization", change the sentence that lists the Organization group ("storage, members, labels and the audit log") to include groups: "storage, members, groups, labels and the audit log". Add after that paragraph: `Groups let you share with a whole team at once; see [Groups](help://core:groups).`

- [ ] **Step 4: Regenerate help, check, commit**

Run: `cd ~/code/tinycld/tinycld && pnpm run packages:generate && cd core && pnpm exec tinycld-pkg check`
Expected: clean.

```bash
cd ~/code/tinycld/tinycld && git add core/components/settings/members/MemberGroupChips.tsx core/components/settings/members/MembersDrawer.tsx core/help/groups.md core/help/organizations.md
git commit -m "feat(settings): show a member's groups and document groups"
```

### Task 10: Core wrap-up

- [ ] **Step 1: Full core gates**

Run, from `~/code/tinycld/tinycld`:

```bash
cd core/server && go test -count=1 ./... 2>&1 | tail -20 && cd ../.. \
&& (cd core && pnpm exec tinycld-pkg check) \
&& pnpm run checks \
&& pnpm run check:core-isolation
```

Expected: everything green. Fix every error at its source.

- [ ] **Step 2: Push and open the core PR**

```bash
cd ~/code/tinycld/tinycld && git push -u origin user-groups
gh pr create --title "User groups: collections, expansion service, admin UI" --body "$(cat <<'EOF'
Adds admin-managed user groups.

- `groups` + `group_members` collections (migration 2040000000)
- Go `groups` package: grant-table registry, in-transaction expansion of group grants into derived membership rows, boot reconcile, membership listeners
- Settings → Groups admin page; group chips in the members drawer
- `useGroupGrants`, `GroupShareSection`, `GroupPicker` for package share dialogs
- Help topic

Spec: docs/superpowers/specs/2026-09-23-user-groups-design.md (workspace root). Boards integration follows on the same branch name.
EOF
)"
```

The boards PR (Part B) uses the same branch name so its CI resolves core from this branch.

---

## Part B: boards reference integration

### Task 11: Boards migration and rule tests

**Files:**
- Create: `pb-migrations/1986000003_group_grants_on_members.js`
- Modify: `server/rls_setup_test.go` (`newCardsApp`)
- Modify: `server/shipped_rules_test.go`
- Create: `server/group_grants_rls_test.go`

**Interfaces:**
- Produces: `boards_project_members.group` (relation → `pbc_groups_01`, cascade), `user` optional, unique index `(project, user, group)`, rules per the spec.

- [ ] **Step 1: Make the fixture know `groups`**

In `server/rls_setup_test.go`, inside `newCardsApp` before `rlstest.Apply(...)`, add:

```go
	// Core's groups collection is the relation target of 1986000003. The
	// fixture is a bare test app, so stub it with the id the migration names.
	groups := core.NewBaseCollection("groups")
	groups.Id = "pbc_groups_01"
	groups.Fields.Add(&core.TextField{Name: "name", Required: true})
	if err := app.Save(groups); err != nil {
		t.Fatalf("stub groups collection: %v", err)
	}
```

Add a fixture helper at the end of the file:

```go
// cardsGroup creates a stub core group.
func cardsGroup(t *testing.T, app core.App, name string) *core.Record {
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

- [ ] **Step 2: Extend the shipped-rules assertions**

In `server/shipped_rules_test.go`, add to the table of `{collection, kind, clause}` cases:

```go
		{"boards_project_members", "create", `(user = "" || group = "")`,
			"a client may write a direct row or a group grant, never a derived row"},
		{"boards_project_members", "create", `(group = "" || role != "owner")`,
			"a group grant never carries the owner role"},
		{"boards_project_members", "update", `(user = "" || group = "")`,
			"a client may not edit a derived row"},
		{"boards_project_members", "update", `(@request.body.group:isset = false || @request.body.group = group)`,
			"group is pinned on update, like project"},
		{"boards_project_members", "update", `(@request.body.user:isset = false || @request.body.user = user)`,
			"user is pinned on update"},
		{"boards_project_members", "delete", `(user = "" || group = "")`,
			"a client may not delete a derived row"},
```

Match the struct shape used by the existing cases (if they carry no description field, drop the fourth element).

- [ ] **Step 3: Write the failing RLS test**

`server/group_grants_rls_test.go`:

```go
package boards

import (
	"net/http"
	"testing"
)

// The three row kinds on boards_project_members, through the API as the
// project owner:
//   - grant (group set, user empty): owner may create, re-role, delete; never owner role
//   - derived (both set): owner may not create, update or delete
//   - direct: unchanged behaviour (covered elsewhere)
// Derived rows still satisfy the roster and content rules, so a group member
// reads the project like a direct member.
func TestGroupGrantRules(t *testing.T) {
	env := setupCardsEnv(t)
	g := cardsGroup(t, env.app, "keepers")

	t.Run("owner creates a viewer grant", func(t *testing.T) {
		req{
			method: http.MethodPost,
			url:    "/api/collections/boards_project_members/records",
			token:  env.ownerToken,
			body:   map[string]any{"project": env.project.Id, "group": g.Id, "role": "viewer"},
			want:   http.StatusOK,
		}.run(t, env)
	})

	t.Run("owner may not grant the owner role to a group", func(t *testing.T) {
		req{
			method: http.MethodPost,
			url:    "/api/collections/boards_project_members/records",
			token:  env.ownerToken,
			body:   map[string]any{"project": env.project.Id, "group": g.Id, "role": "owner"},
			want:   http.StatusBadRequest,
		}.run(t, env)
	})

	t.Run("nobody may create a derived row through the API", func(t *testing.T) {
		req{
			method: http.MethodPost,
			url:    "/api/collections/boards_project_members/records",
			token:  env.ownerToken,
			body:   map[string]any{"project": env.project.Id, "group": g.Id, "user": env.outsider.Id, "role": "viewer"},
			want:   http.StatusBadRequest,
		}.run(t, env)
	})

	t.Run("a derived row is read by its user and untouchable by the owner", func(t *testing.T) {
		// Written as core would: superuser context, both fields set.
		col, _ := env.app.FindCollectionByNameOrId("boards_project_members")
		derived := coreNewRecord(col)
		derived.Set("project", env.project.Id)
		derived.Set("group", g.Id)
		derived.Set("user", env.outsider.Id)
		derived.Set("role", "viewer")
		if err := env.app.Save(derived); err != nil {
			t.Fatalf("save derived: %v", err)
		}

		req{
			method:  http.MethodGet,
			url:     "/api/collections/boards_projects/records/" + env.project.Id,
			token:   env.outsiderToken,
			want:    http.StatusOK,
			content: []string{env.project.Id},
		}.run(t, env)

		req{
			method: http.MethodPatch,
			url:    "/api/collections/boards_project_members/records/" + derived.Id,
			token:  env.ownerToken,
			body:   map[string]any{"role": "editor"},
			want:   http.StatusNotFound,
		}.run(t, env)
		req{
			method: http.MethodDelete,
			url:    "/api/collections/boards_project_members/records/" + derived.Id,
			token:  env.ownerToken,
			want:   http.StatusNotFound,
		}.run(t, env)
	})
}
```

Replace `coreNewRecord(col)` with `core.NewRecord(col)` and add the `"github.com/pocketbase/pocketbase/core"` import; the name above only avoids a clash with a package-level `core` variable if one exists in the test package. Check `env` field names (`project`, `outsider`, `outsiderToken`, `ownerToken`) against `setupCardsEnv` in `rls_setup_test.go` and adjust to the real names.

- [ ] **Step 4: Run to verify failure**

Run: `cd ~/code/tinycld/boards/server && go test -count=1 ./ -run 'TestGroupGrantRules|TestCardsShippedRules' -v 2>&1 | tail -30`
Expected: FAIL (`group` field unknown; new clauses absent).

- [ ] **Step 5: Write the migration**

`pb-migrations/1986000003_group_grants_on_members.js`:

```js
/// <reference path="../../tinycld/server/pb_data/types.d.ts" />
//
// Group grants on boards_project_members.
//
// A row is one of three kinds, told apart by two fields:
//   direct  — user set, group empty  (every row before this migration)
//   grant   — user empty, group set  (client-written: "share with this group")
//   derived — both set               (core Go expands a grant into one row per
//                                     member; server-owned, never client-written)
// Content rules test `…_via_project.user ?= @request.auth.id` and so match a
// derived row exactly like a direct one. Nothing outside this collection
// changes. See core/server/groups.
//
// Rules are restated verbatim from 1980000000 with the new clauses appended,
// never read back off the collection (shipped_rules_test.go asserts literals).
migrate(
    app => {
        const members = app.findCollectionByNameOrId('boards_project_members')

        const user = members.fields.getById('boards_members_user')
        user.required = false

        members.fields.addAt(
            members.fields.length,
            new Field({
                id: 'boards_members_group',
                name: 'group',
                type: 'relation',
                required: false,
                collectionId: 'pbc_groups_01',
                cascadeDelete: true,
                maxSelect: 1,
            })
        )

        members.indexes = [
            ...members.indexes.filter(idx => !idx.includes('idx_boards_members_unique')),
            'CREATE UNIQUE INDEX `idx_boards_members_unique` ON `boards_project_members` (`project`, `user`, `group`)',
            'CREATE INDEX `idx_boards_members_group` ON `boards_project_members` (`group`)',
        ]

        const enabled = '@request.auth.disabled != true'
        const notGuest = '@request.auth.role != "guest"'
        const viaMember = 'project.boards_project_members_via_project.user ?= @request.auth.id'
        const viaOwner = `${viaMember} && project.boards_project_members_via_project.role ?= "owner"`
        const pinProject = '(@request.body.project:isset = false || @request.body.project = project)'
        const pinUser = '(@request.body.user:isset = false || @request.body.user = user)'
        const pinGroup = '(@request.body.group:isset = false || @request.body.group = group)'
        const rosterRule = `(${viaMember} && ${notGuest})`
        const ownMemberRow = 'user = @request.auth.id'
        const ownerCanAdd = viaOwner
        const bootstrapFirstOwner =
            'user = @request.auth.id && role = "owner"' +
            ' && project.boards_project_members_via_project.id = ""' +
            ` && ${notGuest}`
        // A client writes direct rows and grants; derived rows (both set) are
        // core's. A grant never carries owner, so last-owner guards keep meaning.
        const notDerived = '(user = "" || group = "")'
        const groupNeverOwner = '(group = "" || role != "owner")'

        members.listRule = `${enabled} && (${ownMemberRow} || ${rosterRule})`
        members.viewRule = `${enabled} && (${ownMemberRow} || ${rosterRule})`
        members.createRule = `${enabled} && ${notDerived} && ${groupNeverOwner} && ((${ownerCanAdd}) || (${bootstrapFirstOwner}))`
        members.updateRule = `${enabled} && ${notDerived} && ${groupNeverOwner} && ${viaOwner} && ${pinProject} && ${pinUser} && ${pinGroup}`
        members.deleteRule = `${enabled} && ${notDerived} && (${ownMemberRow} || ${viaOwner})`

        app.save(members)
    },
    app => {
        const members = app.findCollectionByNameOrId('boards_project_members')

        // Derived and grant rows cannot survive without the field.
        app.db().newQuery('DELETE FROM boards_project_members WHERE `group` != ""').execute()

        members.fields.removeById('boards_members_group')
        members.fields.getById('boards_members_user').required = true
        members.indexes = [
            ...members.indexes.filter(
                idx => !idx.includes('idx_boards_members_unique') && !idx.includes('idx_boards_members_group')
            ),
            'CREATE UNIQUE INDEX `idx_boards_members_unique` ON `boards_project_members` (`project`, `user`)',
        ]

        const enabled = '@request.auth.disabled != true'
        const notGuest = '@request.auth.role != "guest"'
        const viaMember = 'project.boards_project_members_via_project.user ?= @request.auth.id'
        const viaOwner = `${viaMember} && project.boards_project_members_via_project.role ?= "owner"`
        const pinProject = '(@request.body.project:isset = false || @request.body.project = project)'
        const rosterRule = `(${viaMember} && ${notGuest})`
        const ownMemberRow = 'user = @request.auth.id'
        const bootstrapFirstOwner =
            'user = @request.auth.id && role = "owner"' +
            ' && project.boards_project_members_via_project.id = ""' +
            ` && ${notGuest}`
        members.listRule = `${enabled} && (${ownMemberRow} || ${rosterRule})`
        members.viewRule = `${enabled} && (${ownMemberRow} || ${rosterRule})`
        members.createRule = `${enabled} && ((${viaOwner}) || (${bootstrapFirstOwner}))`
        members.updateRule = `${enabled} && ${viaOwner} && ${pinProject}`
        members.deleteRule = `${enabled} && (${ownMemberRow} || ${viaOwner})`
        app.save(members)
    }
)
```

The `groupNeverOwner` clause on update reads the stored role after the body is applied, which is how PocketBase evaluates a rule on update, so a PATCH that sets a grant to owner fails. Also confirm the `1980000000` list/view rule strings match the restated ones above by reading that file before saving; if they differ, restate the file's exact strings.

- [ ] **Step 6: Run the boards Go suite**

Run: `cd ~/code/tinycld/boards/server && go test -count=1 ./... 2>&1 | tail -30`
Expected: all PASS, including `TestGroupGrantRules`, `TestCardsShippedRules*`, and the anti-repoint and bootstrap suites. If the "owner may not grant the owner role" case returns 200, the `groupNeverOwner` clause is malformed: inspect the saved rule with `rlstest.Rule` and fix the migration.

- [ ] **Step 7: Regenerate types and commit**

Run: `cd ~/code/tinycld/tinycld && pnpm run packages:generate && grep -n "group" ../boards/tinycld/boards/types.ts | head -3`
Expected: `BoardsProjectMembers` now carries `group: string`.

```bash
cd ~/code/tinycld/boards && git checkout -b user-groups
git add pb-migrations/1986000003_group_grants_on_members.js server/rls_setup_test.go server/shipped_rules_test.go server/group_grants_rls_test.go
git commit -m "feat(boards): group grants on boards_project_members"
```

### Task 12: Register the grant table

**Files:**
- Modify: `server/register.go`

- [ ] **Step 1: Register**

Add the import `"tinycld.org/core/groups"` and, in `registerShared` directly after the `offboard.RegisterReassignable` loop:

```go
	// Core expands a group grant (group set, user empty) on this table into one
	// derived row per member, inside the same transaction. Our rules already
	// test `user`, so a derived row is a member like any other.
	groups.RegisterGrantTable(groups.GrantTable{
		Collection:    "boards_project_members",
		ResourceField: "project",
	})
```

- [ ] **Step 2: Build and test**

Run: `cd ~/code/tinycld/boards/server && go build ./... && go test -count=1 ./... 2>&1 | tail -5`
Expected: build OK, PASS. If `go build` cannot resolve `tinycld.org/core/groups`, run `cd ~/code/tinycld/tinycld && pnpm run packages:generate` to refresh `server/go.work`, and confirm the core checkout is on `user-groups`.

- [ ] **Step 3: Commit**

```bash
cd ~/code/tinycld/boards && git add server/register.go
git commit -m "feat(boards): register boards_project_members as a group grant table"
```

### Task 13: Client collection relation and role resolution

**Files:**
- Modify: `tinycld/boards/collections.ts`
- Create: `tinycld/boards/lib/highest-role.ts`
- Create: `tests/highest-role.test.ts`
- Modify: `tinycld/boards/hooks/useProjectRole.ts`
- Modify: `tinycld/boards/hooks/useProjectMembers.ts`

**Interfaces:**
- Produces: `highestRole(roles: readonly BoardsMemberRole[]): BoardsMemberRole | null` (owner > editor > commentor > viewer).

- [ ] **Step 1: Write the failing test**

`tests/highest-role.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { highestRole } from '../tinycld/boards/lib/highest-role'

describe('highestRole', () => {
    it('returns null with no rows', () => {
        expect(highestRole([])).toBeNull()
    })
    it('prefers the stronger role across a direct and a derived row', () => {
        expect(highestRole(['viewer', 'editor'])).toBe('editor')
        expect(highestRole(['commentor', 'viewer'])).toBe('commentor')
        expect(highestRole(['editor', 'owner', 'viewer'])).toBe('owner')
    })
    it('returns the single role unchanged', () => {
        expect(highestRole(['viewer'])).toBe('viewer')
    })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd ~/code/tinycld/boards && pnpm exec vitest run tests/highest-role.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the helper**

`tinycld/boards/lib/highest-role.ts`:

```ts
import type { BoardsMemberRole } from '../types'

// Strongest first. A person can hold several membership rows on one project
// (a direct share plus one per group grant); the strongest one is their role.
const ORDER: readonly BoardsMemberRole[] = ['owner', 'editor', 'commentor', 'viewer']

export function highestRole(roles: readonly BoardsMemberRole[]): BoardsMemberRole | null {
    for (const candidate of ORDER) {
        if (roles.includes(candidate)) return candidate
    }
    return null
}
```

- [ ] **Step 4: Use it in `useProjectRole`**

In `tinycld/boards/hooks/useProjectRole.ts`, import `highestRole` from `'../lib/highest-role'` and replace

```ts
    const role = rows?.[0]?.role ?? null
```

with

```ts
    // Several rows when a direct share and a group grant both apply.
    const role = highestRole((rows ?? []).map(row => row.role))
```

- [ ] **Step 5: Hide derived and grant rows from the people list**

In `tinycld/boards/hooks/useProjectMembers.ts`, change the `.where` to

```ts
                .where(({ member }) => and(eq(member.project, projectId), eq(member.group, '')))
```

and add `and` to the `@tanstack/db` import. Add a comment above the query: `// Direct shares only: grant rows have no user, derived rows are shown under their group.`

- [ ] **Step 6: Add the relation**

In `tinycld/boards/collections.ts`, change the `boards_project_members` relations to

```ts
        relations: { project: boards_projects, user: coreStores.users, group: coreStores.groups },
```

- [ ] **Step 7: Check and commit**

Run: `cd ~/code/tinycld/boards && pnpm exec tinycld-pkg check`
Expected: clean, `highest-role.test.ts` PASS.

```bash
cd ~/code/tinycld/boards && git add tinycld/boards/collections.ts tinycld/boards/lib/highest-role.ts tests/highest-role.test.ts tinycld/boards/hooks/useProjectRole.ts tinycld/boards/hooks/useProjectMembers.ts
git commit -m "feat(boards): resolve the strongest role and hide group rows from the people list"
```

### Task 14: Share dialog integration

**Files:**
- Modify: `tinycld/boards/components/sharing/roles.ts`
- Create: `tinycld/boards/hooks/useProjectGroupGrants.ts`
- Modify: `tinycld/boards/components/sharing/ShareDialog.tsx`

**Interfaces:**
- Consumes: `useGroupGrants` (`@tinycld/core/lib/groups/use-group-grants`), `GroupShareSection` (`@tinycld/core/components/groups/GroupShareSection`).
- Produces: `GROUP_ROLE_OPTIONS: RoleOption[]` (no owner), `useProjectGroupGrants(projectId)`.

- [ ] **Step 1: Role options**

Append to `tinycld/boards/components/sharing/roles.ts`:

```ts
// A group is never an owner: the last-owner guard counts people, and ownership
// of a board is a personal responsibility, not a team one.
export const GROUP_ROLE_OPTIONS: RoleOption[] = ROLE_OPTIONS.filter(option => option.value !== 'owner')
```

- [ ] **Step 2: Boards wrapper hook**

`tinycld/boards/hooks/useProjectGroupGrants.ts`:

```ts
import { useAuth } from '@tinycld/core/lib/auth'
import { useGroupGrants } from '@tinycld/core/lib/groups/use-group-grants'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { GROUP_ROLE_OPTIONS } from '../components/sharing/roles'

/**
 * Group grants on one project, ready to spread into GroupShareSection. Core
 * owns the query and the writes; this wrapper only tells it which collection,
 * which resource, and how a boards row is built.
 */
export function useProjectGroupGrants(projectId: string) {
    const { user } = useAuth({ throwIfAnon: false })
    const [membersCollection] = useStore('boards_project_members')
    return useGroupGrants({
        collection: membersCollection,
        roles: GROUP_ROLE_OPTIONS,
        isForResource: row => row.project === projectId,
        buildRow: grant => ({
            ...grant,
            project: projectId,
            created_by: user?.id ?? '',
        }),
    })
}
```

- [ ] **Step 3: Render the section**

In `tinycld/boards/components/sharing/ShareDialog.tsx`:

Add imports:

```ts
import { GroupShareSection } from '@tinycld/core/components/groups/GroupShareSection'
import { useProjectGroupGrants } from '../../hooks/useProjectGroupGrants'
import { GROUP_ROLE_OPTIONS } from './roles'
```

In `ShareDialogContent`, after `const { members, ownerCount } = useProjectMembers(project.id)` add:

```ts
    const groupGrants = useProjectGroupGrants(project.id)
```

In the JSX, directly after the closing `</View>` of the members list (before `<GuestRosterNote …/>`), add:

```tsx
                <GroupShareSection {...groupGrants} roles={GROUP_ROLE_OPTIONS} canManage={isOwner} />
```

- [ ] **Step 4: Typecheck, then check the collection generics**

Run: `cd ~/code/tinycld/boards && pnpm exec tinycld-pkg typecheck`
Expected: clean. If `useGroupGrants` rejects `membersCollection`, the failing constraint tells which generic is off:
- `TInsert extends GroupGrantRow<Role>`: boards' insert type omits nothing that matters (`id`, `user`, `group`, `role` all present). If `role` is the failure, `GROUP_ROLE_OPTIONS` is typed `RoleOption[]` whose `value` is `BoardsMemberRole`, so `Role` = `BoardsMemberRole`; keep it that way.
- `buildRow` return: must equal the collection's insert type. If `created_by` or another field is required by the insert type and missing, add it in `buildRow`.

- [ ] **Step 5: Full member check and commit**

Run: `cd ~/code/tinycld/boards && pnpm exec tinycld-pkg check`
Expected: clean.

```bash
cd ~/code/tinycld/boards && git add tinycld/boards/components/sharing/roles.ts tinycld/boards/hooks/useProjectGroupGrants.ts tinycld/boards/components/sharing/ShareDialog.tsx
git commit -m "feat(boards): share a board with a group from the Share dialog"
```

### Task 15: E2E — share a board with a group

**Files:**
- Create: `tests/e2e/board-group-sharing.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import {
    login,
    navigateToPackage,
    signInAsCollaborator,
    TEST_COLLABORATOR_EMAIL,
} from '@tinycld/core/e2e-helpers'
import { addCard, boardCard, createBoard, openBoard } from './helpers'

// Group sharing end to end, all through the UI:
//   owner creates a group in Settings → Groups and adds the collaborator,
//   shares a board with the group as Viewer, the collaborator sees the board,
//   the owner removes the collaborator from the group, the board disappears.
// No raw PB writes; never page.reload() — remount via navigateToPackage.

const CARD_TITLE = 'Group launch checklist'

async function openGroupsSettings(page: Page) {
    await navigateToPackage(page, 'settings')
    await page.getByText('Groups', { exact: true }).first().click()
    await expect(page.getByTestId('groups-new-button')).toBeVisible()
}

async function createGroupWithCollaborator(page: Page, groupName: string) {
    await openGroupsSettings(page)
    await page.getByTestId('groups-new-button').click()
    await page.getByTestId('group-name-input').fill(groupName)
    await page.getByTestId('group-create-submit').click()
    // The drawer switches to the new group's view.
    await expect(page.getByTestId('group-add-member-search')).toBeVisible()
    await page.getByTestId('group-add-member-search').fill(TEST_COLLABORATOR_EMAIL)
    await page.getByRole('button', { name: /^Add Collaborator Tester/ }).click()
    await expect(page.getByTestId(`group-member-row-${TEST_COLLABORATOR_EMAIL}`)).toBeVisible()
}

async function removeCollaboratorFromGroup(page: Page, groupName: string) {
    await openGroupsSettings(page)
    await page.getByTestId(`group-row-${groupName}`).click()
    await page.getByRole('button', { name: /^Remove Collaborator Tester from group/ }).click()
    await expect(page.getByTestId(`group-member-row-${TEST_COLLABORATOR_EMAIL}`)).toHaveCount(0)
}

async function shareBoardWithGroup(page: Page, boardName: string, groupName: string) {
    await page.getByRole('button', { name: 'Share board' }).click()
    await expect(page.getByText(`Share “${boardName}”`)).toBeVisible()
    await page.getByRole('button', { name: 'Add group' }).click()
    await page.getByTestId('group-picker-role-viewer').click()
    await page.getByTestId('group-picker-search').fill(groupName)
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(page.getByTestId('group-share-section').getByText(groupName)).toBeVisible()
    await expect(page.getByTestId('group-share-section').getByText('1 member')).toBeVisible()
    await page.getByRole('button', { name: 'Done', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Done', exact: true })).toHaveCount(0)
}

test.describe('Boards — sharing with a group', () => {
    test('group members see the board; leaving the group removes it', async ({ page }) => {
        await login(page)
        const stamp = Date.now()
        const groupName = `Launch crew ${stamp}`
        const boardName = `group-share-${stamp}`

        await createGroupWithCollaborator(page, groupName)

        await navigateToPackage(page, 'boards')
        await createBoard(page, boardName)
        await addCard(page, 0, CARD_TITLE)
        // Share FIRST, sign the collaborator in AFTER — realtime does not
        // announce a newly-visible project row.
        await shareBoardWithGroup(page, boardName, groupName)

        const { page: bobPage, close } = await signInAsCollaborator(page)
        try {
            await navigateToPackage(bobPage, 'boards')
            await openBoard(bobPage, boardName, CARD_TITLE)
            await expect(boardCard(bobPage, CARD_TITLE)).toBeVisible()
            await expect(bobPage.getByTestId('boards-role-chip')).toHaveText('Viewer')

            await removeCollaboratorFromGroup(page, groupName)

            // Remount the collaborator's boards list: the revoked board's rows
            // are dropped by useMembershipSync once its membership row goes.
            await navigateToPackage(bobPage, 'settings')
            await navigateToPackage(bobPage, 'boards')
            await expect(bobPage.getByText(boardName, { exact: true })).toHaveCount(0)
        } finally {
            await close()
        }
    })
})
```

Check `helpers.ts` in `tests/e2e/` for the exact sidebar text a board renders with, and adjust the final `getByText(boardName)` locator to the board list's row locator if one exists (e.g. a `boards-board-row-` test id).

- [ ] **Step 2: Run the spec**

Run: `cd ~/code/tinycld/boards && pnpm exec tinycld-pkg test:e2e -- board-group-sharing`
Expected: PASS. On failure, read the Playwright trace and fix the root cause in the UI or the spec's locator; never a timeout bump or a retry.

- [ ] **Step 3: Commit**

```bash
cd ~/code/tinycld/boards && git add tests/e2e/board-group-sharing.spec.ts
git commit -m "test(boards): e2e for sharing a board with a group"
```

### Task 16: Help and boards wrap-up

**Files:**
- Modify: `help/sharing-boards.md`

- [ ] **Step 1: Document group sharing**

In `help/sharing-boards.md`, after the section that explains adding people, add:

```md
## Sharing with a group

Under the list of people in the Share dialog is a **Groups** section. Choose
**Add group**, pick a role, and pick a group. Everyone in the group gets that
role on the board, including people who join the group later. Remove the group
or change its role from the same section.

A group can be an editor, commentor or viewer, never an owner. If someone is on
the board directly and also through a group, the stronger role applies.

Admins create and manage groups under **Settings → Groups**; see
[Groups](help://core:groups).
```

- [ ] **Step 2: Regenerate, gates, commit, PR**

Run: `cd ~/code/tinycld/tinycld && pnpm run packages:generate && cd ~/code/tinycld/boards && pnpm exec tinycld-pkg check && cd server && go test -count=1 ./... 2>&1 | tail -5`
Expected: all clean.

```bash
cd ~/code/tinycld/boards && git add help/sharing-boards.md
git commit -m "docs(boards): sharing a board with a group"
git push -u origin user-groups
gh pr create --title "Share a board with a group" --body "$(cat <<'EOF'
Boards integration for core user groups (core PR on the same branch name).

- Migration 1986000003: optional `group` relation on `boards_project_members`, `user` optional, unique (project, user, group), rules deny client writes to derived rows and owner role on grants
- `groups.RegisterGrantTable` in `register.go`
- Share dialog renders core's `GroupShareSection`; people list shows direct shares only; a person's role is the strongest across their rows
- Rule tests, unit test, e2e, help
EOF
)"
```

---

## Self-review notes

- Spec coverage: data model (T1, T5), expansion + registry + listeners + reconcile (T2–T4), guest/offboard guards (T3, T4), audit (T4), admin UI (T8), members-drawer chips (T9), exported share UI + hook (T6, T7), help (T9, T16), boards integration incl. rules, register, dialog, hooks, e2e (T11–T15). The mail/drive/calendar integrations are later plans.
- Known deviation: no grant count in the delete confirmation (see Global Constraints).
- Type names used across tasks: `GroupGrantRow`, `NewGroupGrant`, `GroupRoleOption`, `GroupGrant` (T5) are what T6, T7, T14 import. `useGroupGrants` returns `{ grants, isReady, onAdd, onRoleChange, onRemove, isPending }`, which is the prop set of `GroupShareSection` minus `roles` and `canManage` (T7, T14).
