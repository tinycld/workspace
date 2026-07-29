# Handoff: doctaculous migration (2026-07-11)

> **CLOSED 2026-07-29.** Every phase merged (tinycld #129, drive #40, mail #38,
> calc #47, text #41) and all five modules are pinned to **doctaculous v0.1.0**.
> The version blockers this doc tracked — the unpushed `cfRuleElement` fix, the
> v0.0.4 docx APIs, the local-path `go.work` replace — are all resolved: no
> `replace` for doctaculous remains in any `go.work`. What is left is the
> **manual QA** in "Verification still owed" below, which unit tests cannot
> cover: the Docker image build and the upload/thumbnail/round-trip flows.

Migrating all document rendering/reading/writing onto **doctaculous**
(`github.com/nathanstitt/doctaculous`, pure Go, local checkout
`~/code/doctaculous`). Replaces go-fitz/MuPDF + goheif-adjacent CGo baggage,
ledongthuc/pdf, bluemonday (in core), the hand-rolled office scrapers, excelize
(calc), and wordZero + ~6,000 lines of hand-rolled OOXML (text). Full approved
plan (context, phase specs, decisions): `~/.claude/plans/woolly-finding-glacier.md`.

Decisions already made: phased drive/core → calc → text; Go 1.26 everywhere;
legacy binary Office (.doc/.xls/.ppt) regression accepted (no thumbnails, no
extraction); HEIC stays on goheif until doctaculous ships HEIF (so gcc/g++ and
CGO_ENABLED=1 remain, but libmupdf-dev is gone).

## Status at a glance

| Phase | Scope | State |
|---|---|---|
| 0 | Go 1.26 toolchain, doctaculous linkage | ✅ done, in PRs |
| 1 | core thumbnails + textextract, drive/mail callers, Docker/bare-metal | ✅ done, in PRs, all suites green |
| 2 | calc excelize → pkg/xlsx | ✅ merged (calc #47) |
| 3 | text wordZero → pkg/docx | ✅ merged (text #41) |
| — | pin every module to v0.1.0 | ✅ done 2026-07-29 |

## Open PRs (merge order matters)

1. **tinycld #129** — core migration + Go 1.26 (Dockerfile, install.sh,
   gen-server go.work template now emits `go 1.26.3`). Merge first.
2. **bootstrap #17** — template `go.mod` + `templates/workspace/.go-version` →
   1.26.3. `.go-version` drives `setup-go` in every member repo's CI, so this
   must land for any member CI to use Go 1.26. Merge with/right after #129.
3. **drive #40**, **mail #38** — callers of the new streaming
   `thumbnails.Generate(ctx, w, r, mime, w, h)`. Depend on #129.
4. **calendar #27**, **contacts #24**, **text #39** — `go 1.26.3` directive bumps.
5. **calc #47 (DRAFT)** — full xlsx migration, rebased onto calc main as of
   today (absorbed PRs #34/#36/#37/#38/#39 semantically — incl. derived pivot
   ranges replacing `A1:Z200` inside the doctaculous `writePivots`).

## doctaculous version situation (the one real blocker)

- **v0.0.2** (tagged + pushed by this effort) = v0.0.1 + the PDF-extractor
  `/ToUnicode` CMap fix (PDFs written by doctaculous itself extracted as
  U+FFFD; fixed in `pkg/font/{tounicode,type0,simple}.go` with tests).
  Core requires v0.0.2. Sufficient for PRs #129/#40/#38.
- **calc #47 needs one more fix**: `cfRuleElement` minting a dxf when a Raw CF
  rule carries a Style (used by the legacy-blob converter). It is committed
  **locally only**, bundled inside css commit `e752f55` on the unpushed
  local-main/`fidelity-fixes` line of `~/code/doctaculous`. **To un-draft
  calc #47**: push that work, tag (v0.0.3+), bump calc `server/go.mod`'s
  doctaculous require, mark ready.
- **API heads-up**: local doctaculous HEAD removed the `ConvertXToY` wrappers
  (`ed549cd`). Core's extractor was already rewritten onto the stable
  `OpenBytesAs` + `WriteText` API, so core works against both v0.0.2 and HEAD.
  Anything new should use `Open*` + `Document.Write*`/`Convert` only.

## Local machine state / gotchas

- Member `server/go.work` files are **generator-emitted and gitignored**
  (`tinycld/scripts/gen-server.ts`). The calc checkout's
  `calc/server/go.work` currently carries an extra
  `replace github.com/nathanstitt/doctaculous => /Users/nas/code/doctaculous`
  — leave it until v0.0.3 lands; the stashed calc WIP needs it.
- calc repo stash `calc-wip-server-and-screens-DO-NOT-LOSE` holds the
  pre-PR migration WIP + someone's screens edits. The server side is fully
  superseded by PR #47; only `tinycld/calc/screens/[id].tsx` in it may still
  matter to whoever owns it.
- Working trees of tinycld/drive/mail/etc. still contain uncommitted copies of
  the PR'd changes (they were committed from clean worktrees, not from the
  shared trees). Safe to discard those hunks once PRs merge — but the trees
  also hold other sessions' unrelated WIP, so discard selectively.
- Workspace root `.go-version` (not a git repo) was set to 1.26.3.

## Verification still owed (plan §Verification)

- **Docker image build** — never run (Docker down locally). Confirms the
  golang:1.26-trixie, mupdf-free build + tagged doctaculous fetch. While in
  there: eyeball a DOCX thumbnail rendered inside the container (slim base has
  few fonts; doctaculous falls back to bundled substitutes — check it looks OK).
- **Manual flows**: upload PDF/DOCX/XLSX/PPTX/EPUB/HEIC → thumbnails render;
  FTS finds body text; public share-link thumbnail serves `image/jpeg`;
  `.doc` upload → no thumbnail, no error; several concurrent PDF uploads (the
  MuPDF mutex is gone — concurrency is the point).
- **calc manual**: open an existing sheet with data bars/color scales, edit,
  save, reopen in Excel/LibreOffice (opaque CF must survive); open a
  pre-migration room (exercises the legacy excelize-JSON CF-blob converter).

## Phase 3 — text → pkg/docx (DONE, awaiting doctaculous v0.0.4 release)

Completed 2026-07-12. Import + export both migrated onto doctaculous `pkg/docx`;
wordZero fully removed from `text` source. All suites green (incl. `-race`):
`TestRoundTrip_FeatureTest`, `TestCrossEra_WordZeroFixture`, the golden import
test, and every export round-trip/suggestion/comment/table/image suite.

**text repo — branch `migrate/docx-doctaculous`** (4 commits):
- `f629a5d` cross-era wordZero fixture (irreversible safety net — the old
  exporter's output + how the importer read it; guards already-persisted docs).
- `125e108` import: `docx_to_pm.go` walks `docx.OpenBytes(*docx.Document)`
  instead of raw XML (new `docx_to_pm_walk.go` / `docx_to_pm_table.go`; ~37 raw
  producers deleted; all PM-tree post-passes kept verbatim).
- `1fb1322` export: `PMJSONToDocx` builds a `*docx.Document` + `docx.Bytes`
  (new `pm_to_docx_{inline,table,image,helpers}.go`). Deleted
  `pm_to_docx_extras.go` + the four `*_rewriter.go` + all `{{__pm...}}` markers
  + `numberingMu`. Concurrent flushes now race-free.
- `4d36f84` drop wordZero from `go.mod`. **doctaculous require still pinned at
  v0.0.3** (placeholder) — code needs the v0.0.4 APIs, resolved locally via the
  gitignored `go.work` replace.

**doctaculous repo — branch `feat/docx-content-controls-title`** (2 commits,
ahead of main, NOT pushed): `8d0be27` (sdt unwrap block+inline+nested,
Drawing.Title, RunProps.HighlightName, bare-`<w:u>` underline fix) + `40bc0ad`
(VerbatimChar char style, Run.NoteSep for footnote separators). All tests green.

**REMAINING (user handling the release):**
1. Merge `feat/docx-content-controls-title` → doctaculous main, tag **v0.0.4**, push.
2. In text: bump `server/go.mod` doctaculous require `v0.0.3` → `v0.0.4`,
   remove the `go.work` replace line, `go mod tidy` (prunes go.sum wordZero).
3. Open the text PR (branch `migrate/docx-doctaculous`).
4. Manual QA (below) — the one thing unit tests can't prove.

### Phase 3 spec (original, for reference) — text → pkg/docx

Blocked on: text repo free (currently on `fix/blank-doc-no-file-create`), and
the doctaculous docx gap work below. Full spec in the plan file §Phase 3;
summary:

**doctaculous prep (do first, tag a release):**
- G1: unwrap `w:sdt`/`w:sdtContent` at block + inline level in
  `pkg/docx/parse.go` (today content controls are silently dropped; text
  preserves their content with `WarningContentControls`).
- G2: additive `Document.ParseNotes` diagnostics (sdt unwrapped, unknown body
  child skipped) so text can emit its warnings.
- G3: footnote/endnote separator notes (reserved ids −1/0 with
  `<w:separator/>`) — synthesize in `notesXML` or add `Run.NoteSep`.
- G6: `Drawing.Title` (wp:docPr `title`) parse + write.
- Verify the writer emits `wp:anchor` + wrap + `wp:positionH/wp:align` for
  `Anchored/WrapKind/AlignH` drawings.

**text migration (import first, then export):**
1. New `docx_to_pm.go` internals: walk `docx.OpenBytes(blob)` into the same
   intermediate PM paragraphs; keep every PM-tree post-pass and the public API
   (`DocxToPMJSONWithSuggestions` etc.) byte-stable. **Gate: `translate`'s
   `feature-test.expected.json` golden stays byte-identical** and the full
   round-trip suite passes (old exporter still shipping). Suggestions custom
   XML part rides in `Document.ExtraParts` unchanged.
2. New `pm_to_docx.go`: build `*docx.Document` (DefaultStyles + VerbatimChar
   char style, `NewNumbering()` with `LevelOverride{Start}` for resumed lists,
   `AddImage`, revisions as `Revision` containers, comments/footnotes as
   first-class parts) and `docx.Write`. Delete `pm_to_docx_extras.go`, the four
   `*_rewriter.go` files, all `{{__pm…}}` marker machinery, `numberingMu`, and
   flush's `recover()`.
3. Drop wordZero from `text/server/go.mod`. New tests: cross-era fixture
   (a doc flushed by the OLD exporter — **generate it before migrating** — must
   import identically), no-`{{__pm` regression guard, `blank.docx` opens.
4. Manual: round-trip a real tracked-changes + comments doc through Word and
   LibreOffice — the one thing unit tests can't prove.

## Post-switch follow-ups

- excelize deletion PR after the parity oracle (`calc/server/parity_oracle_test.go`)
  soaks a release cycle.
- When doctaculous HEIF lands: delete goheif + `heifMimeTypes`, drop gcc/g++
  from the runtime image and install.sh → fully CGo-free build.
- Optional: lazy Y.Doc upgrade of legacy CF blobs to `rawXml`, then delete
  `legacy_cf.go`.
- Text niceties deferred for golden stability (each regenerates the golden):
  strike marks, nested table-cell content, richer footnote bodies.
