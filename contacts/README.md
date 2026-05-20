# contacts

Personal address book per user, per org, with a native CardDAV endpoint so any standards-compliant address book client (Apple Contacts, GNOME Contacts / Evolution, DAVx5, Thunderbird) can read and write the same records.

A feature package for the [tinycld](https://tinycld.org/) ecosystem. Lives as a standalone git repo alongside the [`tinycld`](https://tinycld.org/) app shell and other sibling packages (`drive`, `mail`, `calendar`, `calc`, `text`, `google-takeout-import`). The app shell bundles `@tinycld/core` inside it — there is no separate core repo to clone.

## What it does

Stores contacts in a single `contacts` PocketBase collection, scoped to the calling user's `user_org` membership. A user with memberships in multiple orgs has one address book per org. CardDAV exposes the same collection at `/carddav/` with one address book per org-membership.

User-facing features:

- **Per-user, per-org address book** — contacts are owned by a `user_org`, not the org itself, and PocketBase access rules (`owner.user = @request.auth.id`) enforce that other org members can't see them. CardDAV honors the same scope.
- **Rich contact fields** — `first_name` (required), `last_name`, `company`, `job_title`, `email` (one), `phone` (one), `notes` (rich-text / HTML), `favorite` flag. The web UI's avatar is `NameAvatar` (initials with a deterministic color); there is no avatar-image upload.
- **Favorites** — toggle a star; the **Favorites** sidebar view filters to starred contacts.
- **Soft delete with restore and permanent delete** — `deleted_at` is the source of truth; soft-deleted contacts move to a **Deleted** sidebar view; permanent delete removes the row, the FTS entry, and the vcard_uid.
- **Labels** — colored tags that live in `core`'s `labels` / `label_assignments` collections and work across packages. Contacts contributes nothing to the label system itself; it consumes core's `useLabels`, `useLabelMutations`, and `LabelManagerDialog`. A `label_assignments` row has `(record_id, collection, label, user_org)`, so a label's meaning is consistent across mail, contacts, etc.
- **Org directory** — a separate sidebar view (`/a/<org>/contacts/directory`) listing **org members** (`user_org` records expanded with their `user` relation), with role badges (owner / admin / member / guest). This is read-only and orthogonal to the contact list — there's no "save member to contacts" action.
- **Search** — SQLite FTS5 across `first_name`, `last_name`, `email`, `company`, `phone`, and `notes` (HTML-stripped). Porter stemmer for English, prefix matches (typing `joh` matches `john`, `johnson`) via `"term"*` syntax. **Not indexed**: `job_title`, `favorite`, labels, `deleted_at`. The server endpoint filters soft-deleted rows (`c.deleted_at = ''`) so search matches the sidebar's main-list view.
- **Stable vCard identity** — every contact has a `vcard_uid` (UUID v4 with `urn:uuid:` prefix), auto-generated on create via an `OnRecordCreate` hook if the client didn't set one. A partial unique index (`WHERE vcard_uid != ''`) guarantees uniqueness without breaking the empty-string fallback. This is how [Google Takeout import](https://tinycld.org/docs) and CardDAV re-syncs dedupe instead of creating duplicates.
- **CardDAV** — full read-write CardDAV server at `/carddav/`, served via `github.com/emersion/go-webdav/carddav` over HTTP Basic auth. One address book is exposed per `user_org` the caller has, at `/carddav/u/ab/<orgSlug>/`. There's a `/.well-known/carddav` redirect for auto-discovery.
- **Keyboard shortcuts** — `t o` jumps to Contacts; `j` / `k` navigate the list; `Enter` opens the focused contact; `c` creates a new one.
- **Realtime updates** — edits made anywhere (web UI, mobile UI, CardDAV client) appear in other open sessions within seconds via PocketBase's built-in collection-realtime subscriptions, consumed through `pbtsdb`'s `useLiveQuery`.
- **Audit logging** — every contact mutation goes through `core/audit`, with the org resolved via `owner → user_org.org`.

## Theory of operations

The short version: contacts is a single `contacts` PocketBase collection plus a SQLite FTS5 virtual table that mirrors it. Access control is enforced via PocketBase's `owner.user = @request.auth.id` rule. A pair of OnRecord hooks keep the FTS row and the `vcard_uid` in sync. The CardDAV adapter is a thin layer that authenticates via HTTP Basic, resolves the caller's `user_org` for the requested org, and translates between vCards and `contacts` records.

```
┌──────────────────────────────────────────────────────────────────────┐
│  Client (React Native / web)                                         │
│                                                                      │
│   Sidebar  ContactList  ContactDetail  ContactForm  LabelManagerDialog│
│                       │                                              │
│                       ▼                                              │
│   pbtsdb useLiveQuery  +  useLabels / useLabelMutations (core)       │
│                       │                                              │
│                       ▼                                              │
│   PocketBase REST + realtime subscriptions ──────┐                   │
└──────────────────────────────────────────────────┼───────────────────┘
                                                   │
┌──────────────────────────────────────────────────┼───────────────────┐
│  Server (Go, PocketBase + tinycld.org/core)      │                   │
│                                                  ▼                   │
│   Collections                                                        │
│     contacts            ── owner.user = @request.auth.id             │
│     fts_contacts        ── FTS5 virtual table                        │
│                                                                      │
│   Hooks (register.go)                                                │
│     OnRecordCreate(contacts):              auto-generate vcard_uid   │
│     OnRecordAfterCreate / Update / Delete:  sync fts_contacts row    │
│                                                                      │
│   API endpoints (register.go)                                        │
│     GET    /api/contacts/search    (auth, FTS5 with prefix matching) │
│                                                                      │
│   CardDAV                                                            │
│     ANY    /carddav  /  /carddav/{path...}                           │
│     GET    /.well-known/carddav → 301 /carddav/                      │
└──────────────────────────────────────────────────────────────────────┘
```

### Ownership model

`contacts.owner` is a relation to `user_org` (not directly to `user`), so the same human in two orgs has two address books. The collection's PocketBase access rules are *all* `owner.user = @request.auth.id`:

- **list / view** — only your contacts come back.
- **create** — you can only insert rows whose `owner` resolves to one of your `user_org` IDs.
- **update / delete** — only on your own contacts.

This is a hard isolation: there is no admin / owner / superuser path through the regular API that returns someone else's contacts. CardDAV uses the same `owner` filter manually because its SDK calls bypass collection rules.

### CardDAV authorization (the manual filter)

`github.com/emersion/go-webdav/carddav` uses the `Backend` interface, which calls our methods directly — it doesn't speak PocketBase's REST API, so it doesn't pass through the collection rules. Every `Backend` method (`ListAddressObjects`, `GetAddressObject`, `PutAddressObject`, `DeleteAddressObject`) re-authenticates the caller via `authenticateRequest` and re-applies the `owner = <userOrg.Id>` filter manually. The two enforcement paths converge on the same predicate (`owner.user == auth.id`) by construction.

The middleware in `register.go` does the HTTP-Basic challenge once per request (sending `WWW-Authenticate: Basic realm="TinyCld CardDAV"` on missing creds). The authenticated request is stashed in the context under `httpRequestKey`; backend methods retrieve it via `authFromContext`, then call `bcrypt`-validated `authenticateRequest` to resolve the `*core.Record`. There is no token caching; every CardDAV request re-runs `ValidatePassword`. Clients typically batch (PROPFIND once, GETs in parallel), so the bcrypt cost is amortized.

### CardDAV paths

The path layout is hand-rolled rather than auto-derived from the carddav library, so client behavior is predictable:

- `/carddav/u/` — `CurrentUserPrincipal`. Returned to clients that ask "who am I?".
- `/carddav/u/ab/` — `AddressBookHomeSetPath`. The collection of address books.
- `/carddav/u/ab/<orgSlug>/` — one address book per `user_org` the caller has. `ListAddressBooks` enumerates `user_org` rows for the user and produces a book per org with `Name = orgs.name` and `Description = "Contacts for <orgName>"`.
- `/carddav/u/ab/<orgSlug>/<vcard_uid>.vcf` — individual contact path. `vcard_uid` is the `urn:uuid:` value.

`CreateAddressBook` and `DeleteAddressBook` return errors — the set of address books is derived from org membership and can't be mutated from a CardDAV client.

### vCard mapping

The translation is intentionally one-of-each-field, not full multi-value vCard:

| TinyCld field | vCard field | Notes |
|---|---|---|
| `first_name`, `last_name` | `N` (and `FN` for display) | `N` is `lastName;firstName;;;` |
| `email` | `EMAIL` | one only |
| `phone` | `TEL` | one only |
| `company` | `ORG` | |
| `job_title` | `TITLE` | |
| `notes` | `NOTE` | HTML in TinyCld, plain in vCard |
| `vcard_uid` | `UID` | stable across exports |
| `updated` (autodate) | `REV` | UTC, `20060102T150405Z` format |

`favorite`, `deleted_at`, and label assignments are TinyCld-side metadata and don't map to vCard. A contact starred in TinyCld will not be starred in Apple Contacts after a CardDAV sync — vCard has no native "favorite" concept.

When a vCard *with multiple* `EMAIL` / `TEL` entries is `PUT` from a client, only the first of each lands in TinyCld (the SDK call `card.Value(vcard.FieldEmail)` returns the first value of the multi-value field). This is a known asymmetry; if the user later edits the contact in TinyCld and the CardDAV client picks up the change, the additional values get dropped on the round-trip.

### vcard_uid generation and dedup

`OnRecordCreate("contacts")` runs before persistence and stamps `vcard_uid = "urn:uuid:" + uuid.NewString()` if the client didn't supply one. This guarantees:

- Every web-UI-created contact has a UID without the form needing to know about it.
- CardDAV `PUT`s that supply their own `UID` (the normal case) are honored verbatim.
- Google Takeout imports that carry their own UIDs round-trip cleanly: re-importing the same export hits the existing row via `FindFirstRecordByFilter('contacts', 'vcard_uid = {:uid}')` and updates it instead of creating a duplicate.

A backfill loop in the `_add_vcard_uid` migration assigns UIDs to pre-existing rows. The unique index is partial (`WHERE vcard_uid != ''`) so the migration's two-step backfill (column-add followed by row-update) doesn't violate uniqueness mid-flight.

### Soft delete

`deleted_at` is a nullable `Date` field. The migration that added it (`1712000004`) also indexed it. Three states matter:

- **Empty string** — live contact. The default for new rows.
- **A timestamp** — soft-deleted. Hidden from the main list, Favorites, and label views. Shown in the **Deleted** sidebar entry. Excluded from the FTS index by the OnRecordAfterDelete hook? — no, soft deletes still write to FTS (because the row isn't being deleted, just updated); the *client* filters them out by the same `deleted_at` predicate the sidebar count uses. CardDAV deletes a contact when the row hits `deleted_at`.
- **Hard delete (row gone)** — only from the "Delete permanently" action in the Deleted view. Removes the row, the FTS entry (via the OnRecordAfterDelete hook), and the `vcard_uid`. There's no recovery path from this state.

Audit-log entries are retained even after permanent delete.

### FTS5 index

`fts_contacts` is a SQLite FTS5 virtual table with columns `(record_id UNINDEXED, first_name, last_name, email, company, phone, notes)` and `tokenize='porter unicode61'`. The hooks in `register.go` keep it in sync:

- **After create / update** — `syncContactToFTS(record, "create"|"update")` does a `DELETE WHERE record_id = ?` (idempotent upsert) followed by an `INSERT`. HTML in `notes` is stripped via a `<[^>]*>` regex before indexing.
- **After delete** — `syncContactToFTS(record, "delete")` drops the row.

The search endpoint (`endpoints_search.go`) takes a `q` query parameter (min length 2), runs it through `sanitizeFTSQuery` (strips FTS5 special characters, splits on whitespace, wraps each term in double quotes and adds a `*` suffix for prefix matching), then queries `fts_contacts MATCH '"term1"* "term2"* ...'` joined back to `contacts`. The user's `user_org` IDs gate which rows can be returned. `snippet(..., '<mark>', '</mark>', '...', 30)` returns highlighted excerpts for the client UI.

A 100-row hard cap and offset-based pagination are enforced server-side.

### Labels (consumed from core)

Labels live in core. The schema is:

- `labels` — `(id, name, color, user_org)`. Owned by a `user_org`.
- `label_assignments` — `(id, record_id, collection, label, user_org)`. Labels can be assigned to records in *any* collection by reference (untyped FK).

Contacts uses both:

- The sidebar queries `label_assignments` filtered by `collection='contacts'` to compute per-label contact counts.
- The contact detail screen renders core's `LabelManagerDialog` and uses `useLabelMutations()` to assign/unassign labels.
- The list view filters by `?label=<labelId>` via `useContactList`.

Labels are shared with any other package that uses core's label system (mail, for example). Deleting a label removes every assignment row referencing it, across all packages — there is no cascade scoped to a single collection.

### Realtime updates

Contacts has no custom WebSocket layer. PocketBase ships with a built-in realtime channel over server-sent events; `pbtsdb`'s `useLiveQuery` subscribes to the `contacts` collection for the user and replays changes. The effect is that:

- Editing a contact in tab A immediately updates tab B.
- A CardDAV client `PUT`ing a contact causes the web UI to pick it up on the next realtime tick (typically <1 s).
- An audit-log change doesn't propagate this way — audit lives in a separate viewer outside contacts' surface.

### Audit

`audit.RegisterCollection(app, "contacts", ...)` wires contacts into core's audit subsystem. The `ResolveOrg` callback walks `owner → user_org.org` so audit-log queries scoped to an org return contact events. The label for each audit row is the contact's `name` field — note this is a *legacy* field name that no longer exists on the record (the schema migrated to `first_name` / `last_name` in `_add_contact_fields`), so the labeller currently emits an empty string for new contacts. This is a known minor issue.

## Platform support

| Feature                              | Web | iPad |
|--------------------------------------|-----|------|
| List / view contacts                 | ✅  | ✅   |
| Create / edit / delete               | ✅  | ✅   |
| Favorites                            | ✅  | ✅   |
| Labels                               | ✅  | ✅   |
| Soft delete + restore                | ✅  | ✅   |
| Permanent delete                     | ✅  | ✅   |
| Org directory                        | ✅  | ✅   |
| FTS search                           | ✅  | ✅   |
| `j` / `k` / Enter / `c` shortcuts    | ✅  | external keyboard only |
| CardDAV mount                        | OS-native (Apple Contacts, DAVx5, Thunderbird, Evolution) | — |
| Realtime updates                     | ✅  | ✅   |

iPhone (small phone screens) isn't supported yet.

## Server package layout

```
server/
    register.go              Register(app) — hooks, search endpoint, CardDAV
    auth.go                  HTTP Basic authentication for CardDAV
    carddav.go               CardDAVBackend (emersion/go-webdav/carddav)
    vcard.go                 record ↔ vcard.Card translation (one of each field)
    search.go                fts_contacts upsert + FTS5 query sanitization
    endpoints_search.go      /api/contacts/search handler
```

Go module: `tinycld.org/packages/contacts`. Imports `tinycld.org/core/audit` via the standard go.mod replace directive the app shell installs.

## Client package layout

```
tinycld/contacts/
    manifest.ts                 package manifest (slug, nav, sidebar, server, help)
    sidebar.tsx                 Contacts / Favorites / Directory / Deleted + Labels
    collections.ts              contacts + label_assignments pbtsdb registration
    types.ts                    ContactsSchema (merged into MergedSchema)
    seed.ts                     sample data
    screens/
        index.tsx               main list (filter / label / search aware)
        directory.tsx           org members view with role badges
        [id].tsx                contact detail editor
        new.tsx                 create form
    components/
        ContactForm             shared between new + detail screens
        contactSchema.ts        zod schema (single source of truth for validation)
        ContactRow              list row with star + actions
        ContactAvatar           re-exports core's NameAvatar
    hooks/
        useContactList          list + filters + mutations (favorite / delete / restore)
        useContactSearch        /api/contacts/search hook
        useContactsShortcuts    j / k / Enter / c
    stores/
        contacts-ui-store       zustand: sort field, sort direction
```

## Development

This package is a member of the TinyCld npm workspace. Clone the workspace
members as siblings under one root, then install at the **workspace root** (never
inside a member — members carry no `node_modules` of their own):

```sh
# Clone the workspace members as siblings under one root
git clone <app-remote>      ~/code/tinycld/new/app       # the app shell (member "app")
git clone <core-remote>     ~/code/tinycld/new/core      # @tinycld/core
git clone <this-remote>     ~/code/tinycld/new/contacts  # @tinycld/contacts

# Install at the WORKSPACE ROOT — links members + runs the generator (postinstall)
cd ~/code/tinycld/new
npm install

# Run the full stack (Expo + PocketBase behind a proxy)
cd app && npm run dev
```

## Standalone checks

Run checks from **inside this package** — they scope to this package only:

```sh
cd ~/code/tinycld/new/contacts
npm run typecheck   # tsc against this package's tsconfig (extends the shared base)
npm run test        # vitest, this package's tests/ only
npm run check       # typecheck + unit
npm run test:e2e    # Playwright against the app shell's live stack
```

These scripts delegate to `tinycld-pkg` (the `@tinycld/package-scripts` workspace
member): it locates the app shell, then runs the scoped command with the shell's
toolchain (so `@tinycld/core/*` imports, the `~/*` source alias, and the uniwind
type augmentation all resolve). No app-shell knowledge required.

To run checks across **every** member at once, from the app shell:

```sh
cd ~/code/tinycld/new/app
npm run pkg:check      # typecheck + unit, every member, with a per-package summary
npm run pkg:test:unit  # unit only, every member
npm run pkg:test:e2e   # e2e, every member with a Playwright project
```

## CI

`.github/workflows/ci.yml` (in the workspace root) runs `npm install` then
`cd app && npm run pkg:check` — typecheck + unit across every member, exactly
what you'd run locally. Go tests and live e2e run in separate lanes.

## Package anatomy

- `manifest.ts` — single source of truth for capabilities (routes, nav, sidebar, collections, migrations, server module, help)
- `package.json` — name, exports map, peer deps
- `tsconfig.json` — typecheck config (a thin extend of the app's `tsconfig.package-base.json`)
- `pb-migrations/` — PocketBase migrations (symlinked into the app shell's server on `packages:generate`)
- `server/` — Go server module, registered by the generator
- `help/` — in-app help topics (markdown + frontmatter)
- `tests/` — vitest unit tests + Playwright e2e specs (run via `tinycld-pkg` from this dir)
- `vitest.config.ts` / `playwright.config.ts` — thin per-package configs inheriting the app shell's canonical config
- `tinycld/contacts/` — TypeScript source
