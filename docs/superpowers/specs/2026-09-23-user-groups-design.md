# User groups

**Date:** 2026-09-23
**Status:** Design approved, not yet implemented

## Problem

Every share in tinycld names one user. Boards, drive (and so text and calc),
calendar and mail each keep a flat junction table of (resource, user, role),
and their PocketBase rules test `…_via_x.user ?= @request.auth.id`. An admin
who wants a team of twelve people on a project adds twelve rows, and adds a
thirteenth when someone joins. Mail provisions every user on the first
verified domain because there is no way to say who a domain is for.

There is no group, team or org-unit concept anywhere. `users.role`
(`owner|admin|member|guest`) is the only privilege field, and `org_pkg_access`
(user, pkg) is the closest thing to a grouping.

## Goals

- An admin defines named groups of users once and reuses them everywhere a
  user can be shared with.
- Membership is live. Joining a group grants everything the group holds.
  Leaving removes it.
- A mail domain can be limited to a group, and every member gets a personal
  mailbox on it.
- Existing realtime checks and Go mirrors (`driveshare`, boards/calendar/mail
  realtime, IMAP auth) do not change. Content rules keep their logic, but
  every rule that tests the membership table's `user` gains a login guard
  (see "Grant rows and anonymous requests").
- Core stays ignorant of package tables. Packages register with core.
- Works on web and native.

## Decisions

| Question | Decision |
|---|---|
| Who manages groups | Admins and owners only. Users cannot create groups. |
| Guests | Never members of a group. |
| Membership effect | Continuous. Live for shares and for mail provisioning. |
| Nesting | No. A group holds users only. |
| Direct share plus group share | Both rows exist. The highest role applies, because rules match any row. |
| Owner role | A group grant never carries `owner`. Last-owner guards keep their meaning. |
| Enforcement | Expansion in core (see Architecture). Not rule traversal. |

## Architecture

### Three kinds of membership row

A package's existing membership table gains an optional `group` relation next
to `user`, and `user` becomes optional. A row is one of three kinds:

| user | group | kind | written by |
|---|---|---|---|
| set | empty | direct share (today's rows) | client |
| empty | set | group grant | client |
| set | set | derived row | core Go only |

A derived row is a clone of its grant row with `user` set. All other fields
(`role`, `created_by`, …) copy through. Existing rules test `user`, so a
derived row satisfies them the same as a direct share. Go mirrors and
realtime do not change.

#### Grant rows and anonymous requests

It is NOT true that a grant row (`user` empty) never matches a rule that
tests `user`. For a request with no login, PocketBase resolves
`@request.auth.id` to NULL and rewrites `x = NULL` as `(x = '' OR x IS NULL)`.
So `…_via_x.user ?= @request.auth.id` matches every grant row, and a caller
with no token gets the grant's role. `@request.auth.disabled != true` does not
stop it, because NULL is not true either.

Rule: every rule, in any collection, that tests the membership table's `user`
must also require `@request.auth.id != ""`, conjoined with that test. On a
rule that also admits anonymous callers another way (a share-link token), put
the guard inside the member branch only. `rlstest.RequireAuthGuardOnGrantRules`
scans every rule of a migrated test app and fails on any that forgets it;
each package with a grant table calls it from its rule tests.

Rules on the membership table only:

- create, update, delete: add `(user = "" || group = "")`. A client can never
  write or remove a derived row.
- create: add `(group = "" || role != "owner")`.
- The unique index becomes (resource, user, group).

### Core data model

New migration under `tinycld/core/server/pb_migrations/`.

`groups`
- `name` text, required, unique.
- `description` text, optional.

`group_members`
- `group` relation → `groups`, required, cascade delete.
- `user` relation → `users`, required, cascade delete.
- Unique index on (group, user).

Rules
- `groups` list/view: any authenticated non-guest. Create/update/delete: admin
  or owner.
- `group_members` list/view: any authenticated non-guest. Create/delete: admin
  or owner, and `user.role != "guest" && user.disabled != true`. No update rule.

Core Go guards
- When a user's role changes to guest, or the user is offboarded, core deletes
  their `group_members` rows. Cascade covers hard deletes.
- Both collections register with `audit.RegisterCollection`.
- Groups are readable under the existing OAuth profile scope. No new scope.

Client store: `newCollection('groups', …)` and
`newCollection('group_members', …)` in `tinycld/core/lib/pocketbase.ts`, with
a `relations` entry that files a member's user row into `users`.

### Expansion service: `tinycld/core/server/groups/`

Registry, called from each package's `Register(app)`:

```go
groups.RegisterGrantTable(groups.GrantTable{
    Collection:    "boards_project_members",
    ResourceField: "project",
})
```

A registered table must have optional `user` and `group` relation fields,
with `group` cascade-deleting from `groups`.

Reconciliation runs inside the triggering write's transaction, through
`OnRecordCreate` / `OnRecordUpdate` / `OnRecordDelete` with `e.Next()`. A
client never observes a half-expanded grant.

| event | action |
|---|---|
| `group_members` created | for each table, for each grant of that group: insert a derived row for the user |
| `group_members` deleted | delete derived rows for (group, user) in every table |
| grant row created | insert one derived row per current member |
| grant row updated | copy changed fields to its derived rows |
| grant row deleted | delete its derived rows |
| `groups` deleted | PocketBase cascade removes members and grants, which fire the rows above |

Derived rows are written with superuser context.

`groups.Reconcile(app)` runs once at boot. It diffs expected derived rows
against actual rows for every registered table and repairs both directions.
It is idempotent. It is the safety net for a crash between hook and commit.

Membership hook for side effects:

```go
groups.OnMembershipChange(func(e groups.MembershipEvent) error)
// e.UserID, e.GroupID, e.Joined
```

It fires after the membership row commits. It does not fire during boot
reconcile.

Core tests use a fictional `zoo_keepers` table. Core names no package, so
`pnpm run check:core-isolation` stays clean.

### Core UI

Admin management
- New settings page `Settings → Groups` at
  `tinycld/app/a/(app)/settings/groups.tsx`, admin and owner only, next to
  Members. Components live in `tinycld/core/components/settings/groups/`.
- List of groups with member counts. Create, rename, delete. Delete confirms
  and states how many grants it removes.
- A drawer per group: member list, remove, and an add-member picker over the
  org roster that excludes guests and disabled users.
- The existing members drawer shows a user's groups as read-only chips.
  Editing stays on the groups page.

Exported share UI in `tinycld/core/components/groups/`
- `GroupShareSection`. Props: `collection` (the package's membership
  collection object, typed structurally as rows with `group`, `user`,
  `role`), `resourceField`, `resourceId`, `roles`, `canManage`. It queries
  grant rows (`user = ''`) for the resource, shows each group with a role
  select, member count and remove button, and an add button that opens the
  picker. Writes go through `useMutation`.
- `GroupPicker`. Searchable group list with an `excludeIds` prop.
- `useGroupGrants(collection, resourceField, resourceId)` for a package with
  a custom layout.

The package passes its collection object in. Core passes no collection name
to `useStore`.

Help: a core topic `tinycld/core/help/groups.md` for admins, and a paragraph
in each package's sharing topic.

All components use plain React Native primitives, so they work on web and
native.

### Package integrations

Common pattern, one new appended migration per package:

1. Membership table: `user` optional, add `group` relation (cascade from
   `groups`). Unique index becomes (resource, user, group).
2. Rules on that table only, as listed under "Three kinds of membership row".
3. `register.go` adds one `groups.RegisterGrantTable` call.
4. Share dialog: the user list filters `group = ''` and renders
   `GroupShareSection` under it.

Per package

- **Boards** (`boards_project_members`). Reference integration. Roles offered
  to groups: editor, commentor, viewer.
- **Drive** (`drive_shares`). Covers text and calc, which lazy-load drive's
  dialog. `driveshare.go` and `POST /api/drive/share` do not change. Roles:
  editor, commentor, viewer.
- **Calendar** (`calendar_members`). Roles: editor, viewer. Limitation: the
  per-member color on a derived row copies the grant's color and is
  server-owned, so a user cannot recolor a group-shared calendar. Documented,
  not solved here.
- **Mail, shared mailboxes** (`mail_mailbox_members`). Role: member. The admin
  mailbox drawer gets `GroupShareSection`.
- **Mail, domains.** `mail_domains` gets an optional `group` relation. A
  domain with no group is open, as today. A domain with a group is limited to
  its members. Provisioning becomes one idempotent function
  `ensurePersonalMailboxes(user)`: a mailbox on the first verified open
  domain (today's rule), plus one on every verified domain limited to a group
  the user belongs to. It runs on user create, on `groups.OnMembershipChange`
  join, on domain group change, and once at boot. Leaving a limited group
  sets `disabled = true` on the user's personal mailbox for that domain.
  `disabled` is a new boolean on `mail_mailboxes`: inbound is rejected, IMAP,
  SMTP and the UI deny access, and the mail is kept. Rejoining clears it.
  Admins can delete a disabled mailbox from the mailboxes screen.

Build order: core, then boards, drive, calendar, mail. Each is its own plan
and PR set. All PRs use one shared branch name so packages find core.

## Error handling

- Expansion runs inside the triggering transaction. A failed derived-row
  write fails the client's request with the PocketBase error. A grant is
  never half applied.
- Boot reconcile logs each repair at warn through
  `logging.ForPackage("groups")` and continues past a bad row. One broken
  table cannot block startup.
- Adding a guest or disabled user to a group fails the rule. The picker never
  offers them. The rule is the backstop.
- Deleting a group shows the count of grants it removes before confirming.
- Mail provisioning failures log at error and leave the user without that
  mailbox. The boot pass retries. There is no user-facing error, because it
  is an admin-side effect.

## Testing

- Go unit tests for the expansion service against a fictional `zoo_keepers`
  table: each event in the reconciliation table, reconcile repair in both
  directions, and a user in two groups granted on one resource.
- Go tests for the guest and offboard guards.
- Vitest for `GroupShareSection`, `GroupPicker` and the groups settings page,
  with the shared pbtsdb test helpers.
- Boards e2e, all through the UI: an admin creates a group, adds a user,
  shares a project with the group through the dialog. The member logs in and
  sees the project. Removing the member from the group hides it again.
- Mail Go tests for `ensurePersonalMailboxes`: open domain, limited domain,
  join, leave sets `disabled`, rejoin clears it.
- Each later package adds one e2e in the same shape as boards.

## Out of scope

Ideas recorded for later, each a separate spec:

- Package access by group (`org_pkg_access`).
- Group calendars and group address books.
- Mail distribution lists (`sales@` fans out to members).
- `@group` mentions in boards comments and text documents.
- Boards automation actions that target a group.
- Invite links that place a new user in a group.
- Offboarding successor defaults to a group owner.
- Sidebar grouping of boards by group (boards TODO #30).
- Guest roster containment by group.
- User-created ad hoc groups.
