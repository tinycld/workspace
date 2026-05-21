# calc

Spreadsheets for your organization.

A feature package for the [tinycld](https://github.com/tinycld/tinycld)
ecosystem. Lives as a standalone git repo alongside the
[`tinycld`](https://github.com/tinycld/tinycld) app shell and other sibling
packages (`contacts`, `mail`, `calendar`, `drive`,
`google-takeout-import`). The app shell bundles `@tinycld/core` inside it
— there is no separate core repo to clone.

## What it does

Stores spreadsheets as `.xlsx` files in `@tinycld/drive` and edits them
collaboratively. Workbooks open from the drive UI (calc registers an xlsx
preview + an "Open in Calc" file action) or from the dedicated `/a/<org>/calc`
index. The grid handles cell editing, formulas (via HyperFormula), styling
(font, fill, alignment, borders, number formats), structural mutations (insert
/ delete rows and columns, with formula-reference rewriting), copy / cut /
paste with marching-ants cut indicator, fill-handle series detection, column /
row resize, undo / redo, per-cell threaded comments, live presence
(cursors, selections, who's-editing-what), sort and filter, conditional
formatting (`lib/conditional-format/`), pivot tables (`lib/pivot/`),
per-sheet tab color and hidden-sheet support, CSV import / export
(`lib/csv/`), and print (`lib/print/`, with a dedicated render
pipeline that paginates the active sheet for the browser / iOS print
sheet).

Calc depends on `@tinycld/drive` — the drive_item record is the spreadsheet's
identity, the drive share rules govern who can open the room, and the xlsx
blob attached to the drive_item is the source of truth that survives across
sessions.

## Platform support

| Feature                              | Web | iPad |
|--------------------------------------|-----|------|
| Open / view spreadsheets             | ✅  | ✅   |
| Edit cells (tap, soft keyboard)      | ✅  | ✅   |
| Drag-select a range                  | ✅  | ✅   |
| Extend selection                     | shift+click / shift+arrow | drag corner handles |
| Fill handle (drag corner to autofill)| ✅  | ✅   |
| Context menus                        | right-click | long-press |
| Keyboard shortcuts                   | ✅  | external keyboard only |
| Soft-keyboard accessory (Tab/Enter/Esc/▲/▼/fx) | n/a | ✅ |
| CSV export                           | browser download | iOS share sheet |
| Print                                | browser print | iOS print sheet |
| Realtime collaboration               | ✅  | ✅   |
| Find/replace                         | ✅  | ✅   |
| Sort / filter                        | ✅  | ✅   |
| Conditional formatting               | ✅  | ✅   |
| Pivot tables                         | ✅  | ✅   |
| Disjoint selection (Ctrl-click)      | ✅  | n/a (no modifier key) |
| Live shift toggle mid-fill-drag      | ✅  | n/a (no modifier key) |
| Marching-ants cut animation          | ✅  | static dashed border |

iPhone (small screens) is not supported yet. Android has no testing surface
today; iOS-specific code paths use `Platform.OS === 'ios'` rather than
`Platform.OS !== 'web'` where the behavior is iOS-only (e.g. `InputAccessoryView`).

For manual iPad release-gating, see `tinycld/calc/tests/manual/ipad-smoke.md`.

## Menus

A Sheets-style menubar sits above the toolbar:

- **File** — New spreadsheet, Open, Import, Make a copy (clones the
  workbook's xlsx blob into a new drive_items row and opens it),
  Download as CSV (current sheet / all sheets), Rename, Move to trash,
  Details, Print. The menu is wired to accept an optional XLSX
  download handler (`onDownloadXlsx` on `FileMenu` / `Toolbar`), but no
  caller currently provides one — the "Download as XLSX" item is
  conditionally hidden until that handler is connected. Round-tripping
  the doc back to xlsx happens server-side on every save, so the bits
  for an XLSX download already exist on `drive_items.file`; wiring is
  the missing piece.
- **Edit** — Undo, Redo, Cut, Copy, Paste, Paste special (Values only,
  Format only), Find and replace.
- **View** — Freeze (rows / columns / up to selection / Unfreeze), Hidden
  sheets (re-show a hidden tab).
- **Format** — Number (preset registry), Text (Bold / Italic / Underline /
  Strikethrough with active-state check), Alignment (Left / Center / Right),
  Font size, Merge cells, Conditional formatting, Clear formatting (⌘\\).
- **Data** — Sort range, Create / Remove filter. (Pivot tables are
  created from a toolbar button, not the Data menu.)
- **Help** — Documentation (`tinycld.org/docs`), Function list (every
  HyperFormula function name), Keyboard shortcuts (⌘/).

The toolbar is trimmed to the core formatting controls (Undo/Redo, number
format, currency / percent / decimal stepper, font size, bold / italic /
underline / strike, text color, fill color, borders, horizontal alignment,
find), plus a "Insert pivot table" button (`PivotInsertButton`) that
opens the new-pivot dialog pre-filled with the current selection and
active sheet. Sort, filter, merge, freeze, download, and print are
menu-only.

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│  Client (React Native / web)                                         │
│                                                                      │
│   Grid / Toolbar / FormulaBar / SheetTabs / CommentPopover           │
│                       │                                              │
│                       ▼                                              │
│   hooks/use-y-cell  use-y-sheets  use-grid-store  use-realtime       │
│                       │                                              │
│                       ▼                                              │
│   Y.Doc  (sheets Y.Map, cells Y.Map, awareness, undo manager)        │
│                       │                                              │
│                       │  HyperFormula bridge mirrors formulas        │
│                       │  in/out of the doc (FORMULA_ORIGIN)          │
│                       │                                              │
│                       ▼                                              │
│   @tinycld/core useRealtimeRoom  ── WebSocket ──┐                    │
└─────────────────────────────────────────────────┼────────────────────┘
                                                  │
┌─────────────────────────────────────────────────┼────────────────────┐
│  Server (Go, PocketBase + tinycld.org/core)     │                    │
│                                                 ▼                    │
│   core/realtime  broker  (roomKind "calc")                           │
│                       │                                              │
│                       ▼                                              │
│   calc Runtime  (per-room server-side ycrdt.Doc; same shape as TS)   │
│        │   ▲                                                         │
│        │   │  bootstrapHook: on first open, parse xlsx blob and      │
│        │   │  stamp sheets + cells into the doc BEFORE SyncReply     │
│        │   │  ┌────────────────────────────────────────────────┐     │
│        │   └──┤ drive_items.file  (xlsx blob in PocketBase)     │    │
│        │      └────────────────────────────────────────────────┘     │
│        ▼                                                             │
│   SaveCoordinator  (debounce 3s, ceiling 15s, teardown 30s)          │
│        │                                                             │
│        ▼                                                             │
│   persist.SaveRoom: read original xlsx → snapshot ycrdt.Doc →        │
│                     overlay (sheets, dimensions, row/col sizes,      │
│                     row styles, cells, formulas, comments) →         │
│                     write back via excelize → save drive_items.file  │
└──────────────────────────────────────────────────────────────────────┘
```

### Y.Doc as the shared format

The wire format and the in-memory format are the same: a Yjs document with
three top-level `Y.Map`s, mirrored byte-for-byte on the client (yjs) and
the server (`github.com/skyterra/y-crdt`).

**`sheets`** — keyed by stable sheet id (`sheet1`, `sheet2`, …). Each value
is a `Y.Map` with:

- `name: string`
- `position: number` — render order
- `rowCount`, `colCount: number` — extent, written back to xlsx
  `<dimension>` (unioned with the original, never shrunk)
- `colWidths?: Record<number, number>`, `rowHeights?: Record<number, number>`
  — sparse pixel overrides; `0` means hidden
- `rowStyles?: Record<number, CellStyle>` — sparse row-level styling
- `color?: string` — optional tab color, e.g. `"#FF0000"`; written back
  to the xlsx tab color attribute
- `hidden?: boolean` — when `true` the sheet is filtered out of the tab
  bar and exposed only through the View menu's "Hidden sheets" submenu

**`cells`** — keyed by `${sheetId}:${row}:${col}` (see
`lib/y-cell-key.ts` and `parseCellKey` in `server/runtime.go`). Each value
is a `Y.Map` per cell:

- `kind: 'string' | 'number' | 'boolean' | 'date' | 'formula'` — semantic
  type, distinct from `typeof raw` so an ISO date string and literal text
  remain distinguishable
- `raw: string | number | boolean | null` — Yjs-serializable scalar (no
  `Date` — dates are ISO strings)
- `display: string` — cached `formatCell(kind, raw, formula, numFmt)` so
  non-formatter readers (server serializer, alternate clients) render
  identically without re-running the formatter
- `formula?: string` — present only for `kind === 'formula'`
- `style?: Y.Map` — nested `font` / `fill` / `alignment` / `borders` group
  maps plus scalar `numFmt`. Absent groups and absent keys mean
  "untracked" — the serializer leaves the source xlsx attribute alone

**`pivots`** — keyed by stable pivot id. Each value is a `Y.Map`
encoding a `PivotDefinition` (see `lib/workbook-types.ts`): `sourceRange`,
`targetSheetName`, `rows` / `cols` / `values` / `filters` field arrays,
per-filter `filterSelections`, grand-total and subtotal toggles, and
optional `styleName`. The materialized output range lives in the
target sheet's regular `cells` entries — the pivot Y.Map is the
definition, the cells are the cached evaluation. Server-side
`server/pivot.go` round-trips definitions through excelize's native
pivot-table XML; client-side keys live in `lib/pivot/keys.ts`
(`PIVOTS_MAP`, `PIVOT_SHEET_KEY`).

Both sides share a canonical bootstrap: `bootstrapYDocFromWorkbook` in
`tinycld/calc/lib/y-doc-bootstrap.ts` and `BootstrapYDocFromWorkbook` in
`server/bootstrap.go` produce identical doc shapes from the same parsed
`WorkbookModel`. The client never parses xlsx — when a room opens, the
server has already stamped the doc and the first `SyncReply` carries
populated state.

The `style` `Y.Map` shape is intentionally additive: a new attribute
lands as one field in TS `CellStyle`, one field in Go `CellStyle`, one
reader in `server/bootstrap.go::readWorkbookCellStyle`, and one writer
in `persist.go`. Nothing in between needs to change.

### Realtime room lifecycle

Calc registers itself as a `realtime.RoomKind` named `"calc"` (see
`server/realtime_authorize.go`). For each `drive_item.id` clients reach
via `useRealtimeRoom({ roomKind: 'calc', roomID: driveItemID, … })`:

1. **Authorize** — the room rejects clients without a `drive_shares` row
   linking them to the item.
2. **Bootstrap** — on first open, `Runtime.NewDoc` invokes the bootstrap
   hook, which loads `drive_items.file`, parses the xlsx with `excelize`,
   and seeds the `Y.Doc` via `BootstrapYDocFromWorkbook` — all
   synchronously, before the broker sends `SyncReply`. Empty / missing
   files yield an empty doc that the next save will materialize from
   scratch.
3. **WAL replay** — immediately after bootstrap, the broker calls
   `Journal.Replay` for this `(calc, roomID)` and folds every
   un-truncated update from the previous server lifetime back into
   the doc, in seq order. This is what makes edits that arrived
   between the last successful save and a server crash survive.
4. **Updates** — every accepted `MsgDocUpdate` is `Journal.Append`'d
   under a freshly minted, strictly-monotonic per-room seq, then
   folded into the server's doc via `ycrdt.ApplyUpdate`, then fanned
   out to other peers. Append precedes apply: a failed WAL write
   rejects the update rather than letting the in-memory doc and the
   on-disk WAL diverge.
5. **Save** — the `SaveCoordinator` watches doc updates and triggers
   `SaveRoom` on a 3-second debounce, 15-second ceiling, or 30-second
   teardown when the last client leaves. Failures retry with exponential
   backoff (1s, 2s, 4s, 8s, 16s, 30s cap).
6. **Truncate** — once a save completes, the coordinator calls
   `Journal.Truncate(throughSeq)` with the highest seq it observed at
   save start, dropping WAL rows whose state is now reflected in the
   xlsx blob.

`SaveRoom` reads the current xlsx bytes off `drive_items`, snapshots the
server-side `Y.Doc` (`Snapshot()` walks the `sheets` and `cells` maps
into Go structs), and applies the snapshot on top of the original
workbook via `excelize` — renaming or appending sheets, growing
dimensions, applying row/column sizes and styles, writing each cell's
formula or value, then writing classic xlsx cell notes for the threaded
comments. The resulting bytes replace `drive_items.file`; PocketBase
renames the on-disk blob to a fresh hash so the prior version isn't
overwritten in place.

### How core's WAL provides durability

The journal is core's, not calc's. Core exports a `Journal` interface
(`core/realtime/journal.go`) with three operations:

```go
type Journal interface {
    Append(kind, id string, seq int64, update []byte) error
    Replay(kind, id string, apply func(seq int64, update []byte) error) error
    Truncate(kind, id string, throughSeq int64) error
}
```

Calc uses the production implementation, `PocketBaseJournal`
(`core/realtime/journal_pocketbase.go`), which stores each update as a
row in the `realtime_doc_updates` PocketBase collection — created by a
core migration. The collection lives in the same SQLite database as
the rest of the app, so writes are durable against SIGKILL via
SQLite's WAL journal-mode `fsync`. The `update` column is
base64-encoded so the raw CRDT bytes survive PocketBase's text-field
encoding; the `(room_kind, room_id, seq)` index is unique so a
duplicate-seq write is a programming bug rather than a silent
overwrite.

The contract is:

- The broker serializes `Append` calls per `(kind, id)` (one
  goroutine per room route path), so seq monotonicity is the
  broker's responsibility, not the journal's.
- A failed `Append` aborts the apply — the in-memory doc and the
  on-disk WAL never diverge.
- A failed `Replay` aborts room bootstrap entirely; the alternative
  (silently dropping rows we can't decode) would let stale state
  leak back into the doc.
- `Truncate` with a `throughSeq` ≤ the current floor is a no-op,
  which keeps the post-save bookkeeping idempotent under retries.

A cascade hook in `realtime_authorize.go` calls
`Journal.Truncate(roomKindCalc, driveItemID, math.MaxInt64)` when a
`drive_items` record is deleted, so a deleted workbook's WAL rows
don't linger.

Worst-case durability window: between saves, the xlsx blob in
`drive_items.file` lags by up to `DefaultCeilingInterval` (15s) of
continuous editing, but the WAL has every accepted update. After a
server crash, the next client to open the room sees:

1. The bootstrap parses the last-saved xlsx into a fresh Y.Doc.
2. `Replay` folds every un-truncated WAL row on top, in seq order.
3. The `SyncReply` reflects the union — nothing is lost.

If a `Truncate` partially applies before a crash, replay re-applies
updates the doc has already absorbed; Yjs handles this as a no-op via
CRDT idempotence.

### Why server-side bootstrap

Bootstrap happens server-side (not client-side) so the wire shape clients
see is canonical regardless of join order — there is no "first joiner
parses xlsx, everyone else syncs from peer" race, and a peer dropping
mid-edit doesn't strand the next joiner with stale state. The client
package has no xlsx parser at all; `excelize` is a Go-only dependency.

### Formula evaluation

HyperFormula runs client-side only. The `FormulaBridge`
(`lib/formula/bridge.ts`) mirrors the `Y.Doc`'s cells into HF on bootstrap,
attaches a `valuesUpdated` listener, and writes cached scalars back into
each formula cell's `raw` tagged with `FORMULA_ORIGIN`. The `observeDeep`
callback short-circuits on that origin so HF never re-receives its own
outputs. The server stores the cached scalar in `raw` but does no
evaluation of its own — the formula text is the source of truth and any
client recomputes from there.

### Comments

Comments are not in the `Y.Doc`. They live in a regular PocketBase
collection, `calc_comments` (see `pb-migrations/`), one row per thread
root or reply. The grid subscribes via `useCellComments` with
`useOrgLiveQuery`; mutations go through `useMutation`. On save,
`SaveRoom` snapshots the threads and writes them into the xlsx as
classic cell notes (one-way: app → xlsx; external editor notes are
overwritten).

### Server package layout

```
server/
    register.go               Register(app) — wires realtime + API
    realtime_authorize.go     RoomKind "calc"; drive_shares-based access;
                              SaveCoordinator + Journal wiring; WAL cascade hook
    runtime.go                per-room ycrdt.Doc registry; Snapshot()
    bootstrap.go              ReadWorkbookFromXLSX, BootstrapYDocFromWorkbook
    bootstrap_hook.go         production bootstrap closure (load drive_items file)
    save_coordinator.go       calc-side flush wrapper around core's SaveCoordinator
    persist.go                SaveRoom — Y.Doc snapshot → xlsx via excelize
    comments.go               CommentRow loader; classic xlsx cell-note writer
    snapshot.go               Go-side YDocSnapshot / SheetMeta / CellEntry shapes
    pivot.go                  PivotDefinitionDTO + excelize pivot-table writer
    conditional_format.go     conditional formatting round-trip with excelize
    style_attribute_registry.go  single source of truth for every CellStyle
                                 leaf attribute (canaries, probes, extractors)
    style_reflect.go          overlayStyle — reflect-driven CellStyle →
                              *excelize.Style copy on the save path
    api.go                    GET /api/calc/preview/:id (thumbnail / file preview)
```

Go module: `tinycld.org/packages/calc`. Imports `tinycld.org/core/realtime`
through the standard go.mod replace directive the app shell installs.

### Client package layout

```
tinycld/calc/
    manifest.ts        package manifest (slug, nav, provider, server, deps)
    provider.tsx       registers CalcPreview for xlsx mime + drive actions
    collections.ts     calc_comments pbtsdb registration
    types.ts           CalcSchema (for MergedSchema) + CalcComments row shape
    seed.ts            sample data
    screens/
        index.tsx      workbook list + "new spreadsheet"
        [id].tsx       editor — opens room, mounts Grid + SheetTabs
    components/
        Grid.tsx, Body, Cell, CellContextMenu, ColumnHeader, RowHeader,
        CornerCell, CommentPopover, CommentIndicator,
        CutMarchingAntsOverlay, Toolbar (+ submenus), FormulaBar,
        SheetTabs, CalcPreview
        menubar/
            MenuBar.tsx, MenuBarTrigger.tsx, MenuShortcut.tsx,
            FileMenu, EditMenu, ViewMenu, FormatMenu, DataMenu, HelpMenu
        dialogs/
            FunctionListDialog.tsx
    hooks/
        use-realtime.ts            calc-flavored useRealtimeRoom
        use-workbook-context.tsx   provider with doc + awareness
        use-y-cell.ts              read/write a single cell with origin tagging
        use-y-sheets.ts            sheets + sparse dim/style overrides
        use-grid-store.tsx         zustand store for grid UI state
        use-formula-bridge.ts      mounts FormulaBridge to the doc
        use-cell-comments.ts       live calc_comments per workbook
        use-presence.ts            awareness selection/editing
        use-undo-manager.ts        Y.UndoManager wired to typing
        use-clipboard.ts           copy/cut/paste (web + native adapters)
        use-column-resize.ts, use-row-resize.ts
        use-calc-shortcuts.ts      keyboard handler + shortcut docs
        use-clear-formatting.ts    wipe cell styles in a range (⌘\)
        use-menu-dialogs-store.ts  zustand for Function list / Shortcuts dialogs
        use-workbook-file-actions.ts  rename / trash / details from File menu
    lib/
        workbook-types.ts          CellKind, CellStyle, formatCell, PivotDefinition
        y-doc-bootstrap.ts         SHEETS_MAP / CELLS_MAP / PIVOTS_MAP / readYCell / bootstrap
        y-cell-key.ts              ${sheet}:${row}:${col} keying
        cell-key-action.ts         cell-key-derived selection helpers
        cell-input.ts              parse a typed cell value into kind + raw
        structural-mutations.ts    insert/delete row/col (in a Y.Doc transaction)
        sort.ts, filter.ts, merge.ts, selection-range.ts
        normalize-color.ts, pluralize.ts
        formula/
            bridge.ts              HyperFormula ↔ Y.Doc mirror
            rewrite-on-structural-mutation.ts
            normalize.ts, origins.ts, autocomplete.ts, function-names.ts
        clipboard/                 web + native adapters, TSV/HTML codecs
        fill/detect-series.ts      fill-handle pattern detection
        number-format/             presets + formatter
        pivot/                     PivotDefinition writer, range materializer
        conditional-format/        rule model + evaluator
        csv/                       CSV import + export
        print/                     print-rendering pipeline (web + iOS)
        stores/                    zustand stores scoped to calc
        sheet-styles.ts, dimensions.ts, border-presets.ts, cell-style-render.ts
        comments.ts                comment thread grouping
        blank-workbook.ts          minimal xlsx for "new spreadsheet"
        open-in-calc-action.tsx, open-in-calc-drive-action.tsx
```

## Development

```sh
# Clone the app shell and this package as siblings
cd ~/code/tinycld
git clone git@github.com:tinycld/tinycld.git
git clone git@github.com:tinycld/calc.git

# Install deps in the app shell
cd tinycld
pnpm install

# Link this package (and its dependency, @tinycld/drive) into the app shell
pnpm run packages:link ../drive
pnpm run packages:link ../calc

# Run the full stack
pnpm run dev
```

## Standalone checks

From this directory, with `node_modules` symlinked to `../tinycld/node_modules`:

```sh
ln -s ../tinycld/node_modules node_modules

pnpm run lint        # biome (config lives in the app shell)
```

Typechecking is best done from inside `tinycld/` after this package is linked
in — the app shell's tsconfig pulls in `expo`'s base config, `uniwind` type
augments, and the live `~/types/pbSchema` generated from PocketBase, none of
which a standalone `tsc` invocation in this package can see:

```sh
cd ../tinycld
pnpm run typecheck
pnpm run test:unit       # vitest, including this package's tests/
pnpm run test:go         # go test on this package's server/
```

## CI

`.github/workflows/ci.yml` runs lint, typecheck, and vitest on every push to
`main` and every PR. It clones `tinycld/tinycld@main` into a sibling
directory, installs the app shell's deps, links this package in, and runs
the checks — exactly what a developer does locally.

## Package anatomy

- `manifest.ts` — single source of truth for capabilities (routes, nav,
  collections, migrations, provider, server module, package dependencies)
- `package.json` — name, exports map, peer deps (yjs, y-protocols,
  hyperformula, numfmt, pbtsdb, @tanstack/db, expo-clipboard, …)
- `pb-migrations/` — PocketBase migrations (symlinked into the app shell's
  server on `packages:generate`)
- `server/` — Go server module, registered by the generator
- `tests/` — vitest unit tests (sibling tests run from the app shell)
- `tinycld/calc/` — TypeScript source (screens, components, hooks, lib)
