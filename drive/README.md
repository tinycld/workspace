# drive

Cloud file storage for your organization.

A feature package for the [tinycld](https://tinycld.org/) ecosystem. Lives as a standalone git repo alongside the [`tinycld`](https://tinycld.org/) app shell and other sibling packages (`contacts`, `mail`, `calendar`, `calc`, `text`, `google-takeout-import`). The app shell bundles `@tinycld/core` inside it — there is no separate core repo to clone.

## What it does

Stores files for an organization, with per-user folders, sharing, versioning, public links, server-rendered thumbnails, and a native WebDAV mount endpoint at `/drive/` so any OS can mount the drive as a network folder.

User-facing features:

- **Folders and files** — nested hierarchy, org-scoped. Create, rename, move, copy, trash.
- **Versioning** — every replacement of a file's bytes creates a `drive_item_versions` row with `version_number` (monotonic per-item), size, mime type, source (`upload` | `user` | `system`), and an optional label. Other packages (calc, text) call `POST /api/drive/versions/snapshot` to tag the current bytes as a labeled checkpoint without re-uploading. Restore or download any prior version.
- **Role-based sharing** — per-item shares with `owner` / `editor` / `viewer` roles. "Shared with me" lists everything other people have given you access to.
- **Public share links** — 64-hex-character tokenized URLs at `/share/<token>` with viewer or editor role, optional expiry, download counters, last-accessed timestamps, and an enable / disable toggle that reuses the same token. Served by a public route so recipients don't need an account.
- **Server-side thumbnails** — generated asynchronously on upload. PDFs, EPUBs, and Office documents render through MuPDF (`go-fitz`); HEIC/HEIF photos through `goheif`. Plain image types use PocketBase's built-in `?thumb=` query parameter.
- **In-app previews** — the preview modal and its viewers (PDF canvas renderer, image / video / audio players, text and code viewers) live in `@tinycld/core/file-viewer/`. Drive consumes them and lets other packages register custom previewers (e.g. Calc registers itself for `.xlsx`, surfaced as the "Open in Calc" file action).
- **Smart categories** — files are classified into `document`, `spreadsheet`, `pdf`, `image`, `presentation`, `drawing`, `video`, `audio`, `archive`, or `code` (mapping lives in `@tinycld/core/file-viewer/file-icons.ts`).
- **Starred / Recent / Trash** — per-user state. Soft-delete with restore; trashed items still count toward the storage quota until permanently deleted.
- **Per-user storage quotas** — limit is per-user-within-org, sourced from the core `settings` table at key `storage_limit_bytes` (0 = unlimited). Enforced on every create and on version uploads, aggregated across `drive_items` + `drive_item_versions`.
- **Drag-and-drop uploads** — web-only; walks `webkitGetAsEntry` trees so dropping a folder preserves its structure. A persistent upload status bar tracks pending / uploading / done / error per file.
- **Search** — SQLite FTS5 across file name, description, and extracted text content. Document text extraction (PDF, Office, plain text) runs asynchronously via `core/textextract` and updates the FTS row when finished.
- **WebDAV mount** — native `/drive/` endpoint. Mount from macOS Finder, Windows Explorer, or Linux GNOME / KDE; the drive becomes a network folder with one synthetic folder per org you belong to at the root. See the in-app help topic `drive:webdav` for per-OS connection steps.
- **Realtime updates** — uploads, renames, and share changes propagate immediately through PocketBase's collection-realtime subscriptions (consumed via `pbtsdb`'s `useLiveQuery`). No custom WebSocket layer.
- **Single-item download** — web-only. Individual files stream directly from PocketBase; folders are zipped on demand via a short-lived (60 s) per-folder download token, capped at 10,000 files and 5 GB per archive.
- **Notifications** — when a `drive_shares` row is created and the recipient isn't the creator (i.e. real share, not the bookkeeping owner self-share), the recipient receives a `drive_file_shared` notification through `core/notify`.
- **Audit logging** — every mutation on `drive_items`, `drive_item_state`, and `drive_shares` is recorded by `core/audit`. The latter two resolve their org via the linked `drive_items.org`.

## Mounting via WebDAV

The WebDAV endpoint is at **`https://<your-instance>/drive/`** (port 443, same domain as the web UI). Authentication is HTTP Basic using your TinyCld email and password.

At the WebDAV root, you'll see one folder per organization you belong to. Open an org folder to see that org's Drive.

The handler is `golang.org/x/net/webdav` with `webdav.NewMemLS()`, which advertises DAV class 2 (LOCK / UNLOCK) so macOS Finder mounts read-write. There is also a `/.well-known/webdav` route that 301-redirects to `/drive/` to help clients that auto-discover.

For step-by-step connection instructions on macOS Finder, Windows Explorer, and Linux file managers, see the **`drive:webdav`** help topic inside the app (`/a/<org>/help/drive/webdav`, or click any `<HelpIcon topic="drive:webdav" />`). They live there rather than in this README so they update in lockstep with what users actually see in the UI.

## Theory of operations

The short version: every file is a row in `drive_items` with a PocketBase-managed blob attached. Sharing, public links, version history, and per-user state are sibling collections that reference the item by id. A handful of Go hooks on the item collection enforce quota, dedup names, create the owner-share row, and trigger asynchronous text extraction and thumbnail generation. The WebDAV handler is a thin adapter over the same collections.

```
┌──────────────────────────────────────────────────────────────────────┐
│  Client (React Native / web)                                         │
│                                                                      │
│   DriveToolbar / DriveSidebar / FolderTree / PreviewModal            │
│   ShareDialog / DetailPanel / DropZone / UploadStatusBar             │
│                       │                                              │
│                       ▼                                              │
│   useDriveState  useDriveMutations  useFileUpload                    │
│                       │                                              │
│                       ▼                                              │
│   pbtsdb useLiveQuery / useMutation (TanStack DB collections)        │
│                       │                                              │
│                       ▼                                              │
│   PocketBase REST + realtime subscriptions ──────┐                   │
└──────────────────────────────────────────────────┼───────────────────┘
                                                   │
┌──────────────────────────────────────────────────┼───────────────────┐
│  Server (Go, PocketBase + tinycld.org/core)      │                   │
│                                                  ▼                   │
│   Collections                                                        │
│     drive_items            ── item rows, with `file` blob            │
│     drive_item_versions    ── snapshots, monotonic version_number    │
│     drive_shares           ── per-user-org access; role enum         │
│     drive_share_links      ── public links; 64-hex token             │
│     drive_item_state       ── per-user starred / last-viewed         │
│     fts_drive_items        ── SQLite FTS5 virtual table              │
│                                                                      │
│   Hooks (register.go)                                                │
│     OnRecordCreate(drive_items):  quota → dedup name →               │
│                                   create owner drive_shares (txn)    │
│     OnRecordAfterCreate(drive_items):  syncFTS, extractText (async), │
│                                        generateThumbnail (async)     │
│     OnRecordAfterUpdate(drive_items):  same                          │
│     OnRecordAfterDelete(drive_items):  remove FTS row                │
│     OnRecordAfterCreate(drive_shares): notify recipient              │
│                                                                      │
│   API endpoints (register.go)                                        │
│     GET    /api/drive/search                                         │
│     POST   /api/drive/share                                          │
│     POST   /api/drive/upload-version                                 │
│     POST   /api/drive/versions/restore                               │
│     POST   /api/drive/versions/snapshot                              │
│     POST   /api/drive/share-link                                     │
│     DELETE /api/drive/share-link/{id}                                │
│     GET    /api/drive/share-links                                    │
│     GET    /api/drive/share-link/{token}            ── public        │
│     GET    /api/drive/share-link/{token}/file       ── public        │
│     GET    /api/drive/share-link/{token}/thumbnail  ── public        │
│     POST   /api/drive/download-token                                 │
│     GET    /api/drive/download-folder?token=...                      │
│     GET    /api/drive/storage-usage                                  │
│                                                                      │
│   WebDAV                                                             │
│     ANY    /drive  /  /drive/{path...}                               │
│     GET    /.well-known/webdav → 301 /drive/                         │
└──────────────────────────────────────────────────────────────────────┘
```

### Item create: the three concerns the hook owns

`OnRecordCreate("drive_items")` runs three things in order before delegating to `e.Next()`, then a fourth after:

1. **Quota probe** — if `size > 0` and we have an `org` + `created_by`, `checkUserStorageQuota` reads the per-org limit and the user's current usage and rejects with `413 Request Entity Too Large` if the new bytes would push them over. The limit lives in core's `settings` table at `(app='core', key='storage_limit_bytes', org=<orgID>)`; 0 / unset means unlimited.
2. **Name dedup** — `chooseUniqueDriveItemName` probes the `(org, parent, name)` unique index and, on collision, appends `(1)`, `(2)`, … until it finds a free name. The probe is best-effort: the DB index is still the ultimate safety net, and a concurrent transaction committing a colliding name between probe and INSERT surfaces as a save error to the client, which is acceptable.
3. **Persist via `e.Next()`** — the actual INSERT.
4. **Owner share** — `createOwnerShare` inserts a `drive_shares` row with role `owner` in the same transaction. This is a load-bearing invariant: every `drive_item` has at least one `drive_shares` row, and the entire permission system (including the WebDAV adapter) assumes it. Self-shares like this are filtered out of recipient notifications because the recipient is the creator.

### Asynchronous post-create work

After a successful create or update, two goroutines fire-and-forget via `routine.FireAndForget`:

- **Text extraction** (`extract.go` → `core/textextract`) — pulls bytes from the attached file, runs the format-specific extractor (PDF via MuPDF, Office via `unioffice`, plain text passthrough, etc.), and writes the result into `fts_drive_items.content` via `updateFTSContent`. Failures log a warning but don't fail the request — the file is searchable by name and description even if content extraction breaks.
- **Thumbnail generation** (`thumbnails.go` → `core/thumbnails`) — only fires for mimes the core thumbnail package can render (PDF / EPUB / Word / Excel / PowerPoint / HEIC / HEIF). MuPDF-backed extraction is serialized through `fitzMu` because `go-fitz` is not concurrency-safe; HEIC goes through `goheif` and writes a JPEG. The thumbnail is stored on `drive_items.thumbnail`.

Both effectively run as eventual consistency: clients see the item appear immediately, the FTS row catches up when extraction finishes (typically <1 s for small docs, longer for large PDFs), and the thumbnail materializes when generation finishes.

### Sharing model

`drive_shares` has columns `(item, user_org, role, created_by)`. Roles are exactly:

- **`owner`** — full control, including delete. Created automatically by the item-create hook.
- **`editor`** — write access (rename, move, upload new version, share further). Enforced by `checkWritePermission`.
- **`viewer`** — read-only.

Owners are not assignable through the share dialog UI — the only way to become an owner is to be the row's `created_by`. Editors can re-share but cannot promote anyone to owner.

The collection's PocketBase access rules let any participant with role `owner` or `editor` insert new `drive_shares` rows for the item, and only `owner` can delete shares. Server endpoints that mutate items (`upload-version`, `restore-version`, the folder-download token) go through `resolveItemAndUserOrg`, which validates the calling user has a `user_org` in the item's org and then checks `drive_shares` for the required role.

### Public share links

A `drive_share_links` row is the entire public-link state: `(item, role, token, expires_at, is_active, download_count, last_accessed_at, created_by)`. Tokens are 32 random bytes hex-encoded — 64 characters of `[0-9a-f]`, with a `UNIQUE` index. The token is generated at create time and never changes; disabling a link sets `is_active = false`, re-enabling restores it, and the same URL works again. Permanent invalidation requires `DELETE /api/drive/share-link/{id}`, after which any new link generated for the same item gets a fresh token. Collection access rules require **owner** role on the underlying item for any CRUD on the link — editors of a file cannot create or revoke its public links.

Public endpoints (`/api/drive/share-link/{token}`, `.../file`, `.../thumbnail`) sit behind an in-process IP-based rate limiter (60 requests per minute per source IP) shared across all three endpoints. `X-Forwarded-For` is honored when present so the limiter sees the real client behind a reverse proxy.

### Search

`fts_drive_items` is a SQLite FTS5 virtual table with columns `(record_id, name, description, content)`. The first three are synced eagerly from the corresponding `drive_items` columns inside the after-create / after-update hook (via `syncDriveItemToFTS`). `content` is filled asynchronously by `extractAndIndexDriveItem` once the extractor finishes.

`handleDriveSearch` builds a parameterized FTS5 `MATCH` query, joins through `drive_shares` to enforce per-user access (the user's `user_org` IDs must appear in `drive_shares.user_org` for the row to be returned), optionally filters by `org`, and returns `snippet(..., '<mark>', '</mark>', '...', 30)` for client-side highlighting. Special FTS5 syntax characters (`:`, `*`, `^`, etc.) are stripped from user input before the MATCH so users can't accidentally write invalid queries.

### Thumbnails

`core/thumbnails.CanGenerate(mimeType)` says yes for:

- `application/pdf`
- `application/epub+zip`
- The OOXML and legacy Office types (`.docx`, `.xlsx`, `.pptx`, `.doc`, `.xls`, `.ppt`)
- `image/heic`, `image/heif` (including the `-sequence` variants)

For OOXML / legacy Office, MuPDF renders the first page (`doc.Image(0)`) and the result is resized with `imaging.Fit` (Lanczos) and JPEG-encoded at quality 85. For HEIC/HEIF, `goheif.Decode` handles the iPhone-photo case Go's stdlib can't.

Plain image types (`image/png`, `image/jpeg`, `image/gif`, `image/webp`, SVG) are *not* in either list — PocketBase's built-in `?thumb=` query parameter serves on-demand thumbnails for them directly off the original file, so we don't pre-render those.

The thumbnail field is set on a *re-fetched* `drive_items` record (not the one the hook received) to avoid clobbering other concurrent writes. Skip-if-current logic compares the thumbnail's source filename to the original file's filename so a re-uploaded file regenerates but a touch-only update doesn't.

### WebDAV

`DriveFileSystem` implements `webdav.FileSystem`. The path layout is `/drive/<orgSlug>/<segments...>` — the root and each org's root are *synthetic* directories that have no `drive_items` row. Underneath, every segment maps to a `drive_items` record by `(org, parent, name)`.

The flow per request:

1. `serveWebDAV` middleware calls `authenticateRequest` (HTTP Basic, email + password), which `bcrypt`-compares against the `users` collection. Failure returns 401 with `WWW-Authenticate: Basic realm="TinyCld WebDAV"`.
2. The authenticated user is stashed in the request context under `userKey`. FileSystem methods retrieve it via `userFromContext` — they never re-authenticate.
3. `resolveContext` parses the path into `(orgSlug, segments)`, looks up the org, and resolves the caller's `user_org` for that org. If the caller has no membership, every FS operation fails with `os.ErrPermission`.

`webdav.NewMemLS()` is used for the lock system, which is enough to advertise DAV class 2; macOS Finder requires class 2 to mount read-write. Locks are in-memory and per-process, which is fine for a single-instance deployment — clustered deployments would need a shared lock backend.

WebDAV deletes go through `MoveToTrash` semantics: removing a file via Finder moves the underlying `drive_items` row into trash, not permanent delete.

### Versioning

`snapshotCurrentFile` is the single entry point for creating a version row, called from `handleUploadVersion`, `handleRestoreVersion`, and `handleSnapshotVersion`. It:

1. Reads the *current* file's bytes off the `drive_items` record's attached file.
2. Inside an `app.RunInTransaction`, queries `MAX(version_number) FROM drive_item_versions WHERE item = ?` and assigns `result.Max + 1`.
3. Inserts the `drive_item_versions` row with the current bytes, size, mime type, the calling user_org as `created_by`, a caller-supplied `label`, and a `source` of `upload`, `user`, or `system`.

The three `source` values let the UI distinguish how a version came into being:

- **`upload`** — user replaced the file via "Upload new version" in the right-click menu. Label is empty.
- **`user`** — user explicitly snapshotted the current bytes with a description, typically from a host package's "Save version" menu item. Label is whatever the user typed (trimmed and capped at 500 chars).
- **`system`** — automatic safety snapshot taken before a destructive operation (currently just `handleRestoreVersion`). Hidden from the Detail panel's version list — `useVersionHistory` filters with `source != 'system'`.

Version-number assignment in a transaction guarantees monotonicity even under concurrent uploads; the upper layer doesn't need to retry.

`handleSnapshotVersion` is the cheap path used by packages whose content already lives in the `drive_items` file (calc spreadsheets, text documents). It takes JSON `{item, label}`, validates write access via `resolveItemAndUserOrg`, refuses items with no attached file (`422`, "nothing to snapshot — file is empty"), and snapshots in place. No file payload crosses the wire and no edit racing with autosave is possible because no bytes are written to `drive_items.file`.

`handleRestoreVersion` first snapshots the current file (with `source = "system"`) so restore is itself reversible, then copies the chosen version's bytes back onto `drive_items.file` and updates the item's size and mime type accordingly. Storage quota is re-checked on the size delta before the restore proceeds.

PocketBase renames the on-disk blob to a fresh hash on every save, so the prior version of `drive_items.file` is still on disk until PB's cleanup pass — even if a flush goes wrong, the bytes are recoverable. Permanent delete of an item removes every version row with it.

### File viewer registry

The "Open in Calc" / "Open in Text" actions on a file in Drive aren't defined in drive — they're contributed by the consuming packages at module-load time via `@tinycld/core/file-viewer/preview-action-registry.registerPreviewAction(...)`. Drive's `PreviewModal` reads the registry and renders any action whose `match(mime)` returns true. This is why a fresh Drive install with no other packages linked has no "Open in X" actions but still shows generic previews — drive itself doesn't bundle any.

The save-to-drive action (allowing other packages to push a generated file into Drive) is the only registry entry drive contributes itself, in `lib/save-to-drive-action.tsx`.

### Folder download

Folder downloads work via a two-step token flow because a streaming zip response wants to be a `GET` (so browsers download it natively) but the authorization wants to be a `POST` (so credentials don't end up in URL bars and history). `POST /api/drive/download-token` validates access through `resolveItemAndUserOrg`, generates a 32-byte hex token, stores `(folderID, orgID, expiresAt)` in an in-process map with a 60-second TTL, and returns the token + URL. The client immediately requests `GET /api/drive/download-folder?token=...`, which looks the token up, walks the folder tree, and streams a zip of every file underneath, capped at 10,000 files and 5 GB total.

The token map is in-process and uses a background goroutine that runs every 5 minutes to evict expired entries. Restarting the server invalidates all in-flight download tokens; the client gracefully re-requests a new one on next click.

### Notifications and audit

`OnRecordAfterCreateSuccess("drive_shares")` fires a `drive_file_shared` notification through `core/notify` when the recipient (`user_org`) differs from the creator (`created_by`). Owner self-shares — created by the item-create hook — match `userOrgID == createdBy` and are skipped, so users don't get a notification every time they upload one of their own files.

`audit.RegisterCollection` is called for `drive_items`, `drive_item_state`, and `drive_shares`. The latter two register a `ResolveOrg` callback that walks back through the linked `drive_items` to find the org, so audit log queries scoped to an org pick them up. Labels for `drive_items` use the `name` field.

## Platform support

| Feature                              | Web | iPad |
|--------------------------------------|-----|------|
| Browse / open / preview files        | ✅  | ✅   |
| Folder navigation (sidebar tree)     | ✅  | ✅   |
| Upload                               | ✅  | ✅ (Photos / Files pickers) |
| Drag-and-drop upload                 | ✅  | n/a  |
| Folder drag-and-drop                 | ✅  | n/a  |
| Download (file or folder zip)        | ✅  | n/a  |
| Rename / move / copy / trash         | ✅  | ✅   |
| Share with org members               | ✅  | ✅   |
| Public share links                   | ✅  | ✅   |
| Version history (view / restore)     | ✅  | ✅   |
| Search                               | ✅  | ✅   |
| WebDAV mount                         | OS-native (Finder / Explorer / Nautilus) | — |
| Realtime updates                     | ✅  | ✅   |

iPhone (small phone screens) isn't supported yet.

## Server package layout

```
server/
    register.go                Register(app) — hooks, API endpoints, WebDAV
    permissions.go             checkWritePermission / checkDeletePermission /
                               createOwnerShare / getUserOrgForOrg
    dedup_name.go              (org, parent, name) collision → "name (N)"
    storage_limits.go          per-user-within-org quota; settings table lookup
    storage.go                 internal storage helpers
    auth.go                    WebDAV HTTP Basic authentication
    paths.go                   /drive/<orgSlug>/<segments> parsing
    extract.go                 textextract → fts_drive_items.content
    thumbnails.go              core/thumbnails → drive_items.thumbnail
    search.go                  /api/drive/search (FTS5)
    versions.go                snapshotCurrentFile (txn, monotonic version_number)
    endpoints_share.go         /api/drive/share + invite emails
    endpoints_public_share.go  share-link create/list/delete + public token endpoints
    endpoints_download.go      folder-download token flow (POST then GET)
    webdav.go                  DriveFileSystem (webdav.FileSystem implementation)
    webdav_file.go             webdav.File implementation
    webdav_fileinfo.go         webdav.FileInfo for synthetic + real entries
```

Go module: `tinycld.org/packages/drive`. Imports `tinycld.org/core/{audit,notify,textextract,thumbnails}` via the standard go.mod replace directive the app shell installs.

## Client package layout

```
tinycld/drive/
    manifest.ts        package manifest (slug, nav, sidebar, provider, server)
    sidebar.tsx        sections (My Files / Shared with me / Recent / Starred / Trash) + folder tree + storage bar
    provider.tsx       mounts SaveToDriveDialog; registers save-to-drive action
    collections.ts     drive_items / drive_shares / drive_item_state /
                       drive_item_versions / drive_share_links pbtsdb registration
    types.ts           DriveSchema (merged into MergedSchema)
    seed.ts            sample data
    screens/
        index.tsx              section view (My Files / Shared / Recent / Starred / Trash)
        [...path].tsx          deep-link folder view by path
    public-screens/
        share/[token].tsx      public-share landing page (/share/<token>)
    components/
        DriveToolbar           list/grid toggle, search, primary actions
        DriveContextMenu       right-click / long-press actions on a file or folder
        DropZone               web-only drag-and-drop, walks webkit FS entries
        FileUploadFAB          iPad floating action button (Photos / Files pickers)
        UploadButton, UploadStatusBar, UploadingGridCard, UploadingListRow
        PreviewModal           file viewer (consumes core's file-viewer registry)
        Thumbnail              renders drive_items.thumbnail or category icon fallback
        ShareDialog            per-user shares + public link controls
        DetailPanel            details / versions / activity tabs
        ChooseFolderDialog     "Move to..." / "Copy to..." picker
        SaveToDriveDialog      cross-package "save this file to Drive"
        file-icons.ts          re-exports from @tinycld/core/file-viewer/file-icons
    hooks/
        useDrive.tsx           top-level state (active section, current folder, breadcrumbs)
        useDriveMutations.ts   create folder, rename, move, copy, trash, restore,
                               download, public-link CRUD, share CRUD
        useDriveState.ts       wires useDrive to URL params
        useFileUpload.ts       upload pipeline + folder-tree handling
        useUploadPlaceholders.ts  optimistic upload rows in the current view
        useVersionHistory.ts   list + restore versions
        useDriveSearch.ts      /api/drive/search hook
        useFolderTree.ts       sidebar folder tree
    lib/
        copy-drive-item.ts     POST-then-recursive copy
        item-actions-registry.ts  registry for cross-package "Open in X" actions
        save-to-drive.ts, save-to-drive-action.tsx, upload-to-drive.ts
    stores/
        upload-store.ts        zustand: uploading-files list (status + progress)
        ui-store.ts            zustand: shared UI state (dialogs, view mode)
```

## Development

```sh
# Clone the app shell and this package as siblings
cd ~/code/tinycld
git clone git@github.com:tinycld/tinycld.git
git clone git@github.com:tinycld/drive.git

# Install deps in the app shell
cd tinycld
npm install

# Link this package into the app shell
npm run packages:link ../drive

# Run the full stack
npm run dev
```

## Standalone checks

Lint and typecheck both run from the app shell — biome and TypeScript live there, and the app shell's tsconfig pulls in `expo`'s base config, `uniwind` type augments, and the live `~/types/pbSchema` generated from PocketBase, none of which a standalone invocation in this package can see. Biome's config lives in `tinycld/biome.json` and applies to every linked package (there is no `biome.json` in this repo).

```sh
cd ../tinycld
npm run packages:link ../drive    # only needed once per checkout
npm run lint                      # scans this package via the app's biome rules
npm run typecheck                 # full app-shell tsc
npm run test:unit                 # vitest, including this package's tests/
npm run test:go                   # go test on this package's server/
```

## CI

`.github/workflows/ci.yml` runs lint, typecheck, and vitest on every push to `main` and every PR. It clones `tinycld/tinycld@main` into a sibling directory, installs the app shell's deps, links this package in, and runs the checks — exactly what a developer does locally.

## Package anatomy

- `manifest.ts` — single source of truth for capabilities (routes, public routes, nav, sidebar, provider, collections, migrations, server module)
- `package.json` — name, exports map, peer deps
- `tsconfig.json` — typecheck config (lint config lives in the app shell's `biome.json`)
- `pb-migrations/` — PocketBase migrations (symlinked into the app shell's server on `packages:generate`)
- `server/` — Go server module, registered by the generator
- `help/` — in-app help topics (markdown + frontmatter)
- `tests/` — vitest unit tests (sibling tests run from the app shell)
- `tinycld/drive/` — TypeScript source
