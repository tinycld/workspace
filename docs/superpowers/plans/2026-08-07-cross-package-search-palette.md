# Cross-Package Search Palette Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/`-triggered command palette that searches across every installed package, with `pkg:` scope chips, `-term` exclusion, and cross-package relevance ordering.

**Architecture:** A core-owned palette shell federates over per-package "search adapters" contributed through the manifest. Each package declares `search: { endpoint, adapter }`; the generator emits a lazy module thunk; the palette calls the adapter's pure `toRow` to render and its `useSearchActions` hook to navigate. Backends stay heterogeneous — mail and drive keep their own routes, cards gets a new one on `core/fts`.

**Tech Stack:** TypeScript, React Native (web-first via `.web.tsx`), Zustand, TanStack Query (`useApiSearch`), Go + PocketBase + SQLite FTS5, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-07-cross-package-search-palette-design.md`

## Global Constraints

- **Never use `any`.** Adapters cast `unknown` → their own response type on one line; nowhere else.
- **Never use biome-ignore comments.** Fix the underlying issue.
- Biome: 4-space indent, single quotes, ES5 trailing commas, no superfluous semicolons.
- Components PascalCase, hooks camelCase `use`-prefixed, utility modules kebab-case.
- **No raw hex colors.** Semantic Tailwind tokens (`text-foreground bg-background`) or `useThemeColor('foreground')`.
- **Avoid `useState`/`useEffect`** where a better primitive exists. Genuine timer/subscription side-effects may use effects.
- **Never bypass pbtsdb** for PocketBase data — including in tests. E2E sets up data by driving the UI. Raw `page.request`/PB REST is read-only-assertions only.
- **E2E: no `page.goto()` for in-app navigation.** Use `login(page)`, then `navigateToPackage(page, '<slug>')`. Reserve `page.goto('/')` for the initial load in `login`.
- **No `waitForTimeout` in e2e.** `useApiSearch` debounces 300ms; wait on the response or poll.
- **Comments explain "why", not "what".**
- Run `pnpm install` only at the workspace root, never inside a member.
- Migrations: released ones are frozen. New schema ships as a NEW migration file.
- Go tests: `go test -count=1` (the cache does not invalidate on migration changes).

---

## File Structure

**Core TypeScript (`tinycld/core/`)**
| File | Responsibility |
|---|---|
| `lib/search/types.ts` | `SearchRow`, `SearchAdapterModule`, `SearchScope` — no logic |
| `lib/search/parse-query.ts` | Text → `{ chips, include, exclude }`; the `:` and `-` grammar |
| `lib/search/score.ts` | `scoreRow(query, row)` → number; tiers + tie-breaks |
| `lib/search/build-sections.ts` | Results + packages → flat rows or grouped sections |
| `lib/search/registry.ts` | Derive `packageSearchAdapters` from `tinycldConfig` |
| `lib/search/search-palette-store.ts` | Zustand: `isOpen`, `text`, `selectedRowId`. Chips are **derived** from `text` by `parseQuery`, never stored separately — two sources for one piece of state would drift. |
| `components/search-palette/SearchPalette.web.tsx` | The shell: overlay, chips, input, list, footer |
| `components/search-palette/SearchPalette.tsx` | Native stub returning `null` |
| `components/search-palette/useSearchResults.ts` | Fan-out over in-scope packages; merge + score |

**Core Go (`tinycld/core/server/fts/`)**
| File | Responsibility |
|---|---|
| `config.go` | `Scope` interface, `OwnerScope`, `MemberScope`, `ExcludeField` |
| `sanitize.go` | `SanitizeQuery` + `SanitizeQueryWithExclusions` |
| `search.go` | Scope via interface, disabled check, exclude clause |
| `register.go` | Read the `not` query param |

**Generator (`tinycld/scripts/`)** — `load-manifest.ts` (validate), `gen-config.ts` (emit thunk).

**Per package** — `manifest.ts` (+`search`), `package.json` (+`./search-adapter` export), `tinycld/<slug>/search-adapter.ts`.

---

## Task Sequencing

| Tasks | What | Depends on |
|---|---|---|
| 1–5 | Pure core TS (types, parser, scoring, sections, store) | Task 1 defines the types the rest import |
| 6 | Manifest field, generator, adapter registry | Task 1 |
| 7–8 | `core/fts` — scope interface + negation | — (Task 8 edits files Task 7 touches; do them in order) |
| 9 | Cards search route + migration | Tasks 7–8 |
| 10–11 | Mail and drive negation | — (independent of each other and of 7–9) |
| 12 | The four package adapters | Task 6 (manifest field), Task 9 (cards' route must exist) |
| 13 | The palette shell | Tasks 1–6, 12 |
| 14 | E2E + help | everything |

**Hard ordering constraints:**
- **Task 6 before Task 12** — adapters do not typecheck until the manifest `search` field exists.
- **Task 9 before Task 12** — cards' adapter targets a route that Task 9 creates.
- **Task 7 before Task 8** — both edit `search.go`; sequencing avoids a conflict.

Tasks 10 and 11 (mail/drive negation) are independent and can be done any time after Task 8 establishes the `not` param convention.

---

### Task 1: Search types

**Files:**
- Create: `tinycld/core/lib/search/types.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `SearchRow`, `SearchAdapterModule`, `ParsedQuery`, `SearchPackage`

No test — this file is types only, verified by `tsc` through its consumers.

- [ ] **Step 1: Create the types file**

```ts
/** One rendered row in the palette. Every adapter maps its hits to this. */
export interface SearchRow {
    /** The package slug this row came from. Set by the palette, not the adapter. */
    slug: string
    /** Record id, unique within the package. */
    id: string
    /** The name a user would recognize — file name, subject, card title. */
    title: string
    /** Identifying detail, e.g. 'Grace Hopper · Inbox · 1d'. */
    subtitle?: string
    /** Right-aligned trailing detail, e.g. a board name. */
    meta?: string
}

/**
 * What an adapter module exports. Two halves because rendering is pure but
 * selection needs router and store handles.
 */
export interface SearchAdapterModule {
    /**
     * Pure: one raw hit from this package's endpoint → one row, or null to
     * skip the hit (e.g. its parent record has not synced yet).
     *
     * Takes `unknown` because the palette holds a heterogeneous map of
     * adapters and cannot thread per-package types through it. Each adapter
     * casts to its own response type on its first line.
     */
    toRow: (hit: unknown) => Omit<SearchRow, 'slug'> | null
    /**
     * Returns this package's selection handler.
     *
     * MUST be side-effect free: the palette calls every in-scope package's
     * hook at the top level (hooks cannot be called conditionally at selection
     * time), so this runs even for packages with no visible results. Wire up
     * router/store handles here — never fetch, subscribe or mutate.
     */
    useSearchActions: () => { onSelect: (row: SearchRow) => void }
}

/** The result of parsing the palette input. */
export interface ParsedQuery {
    /** Package slugs to search. Empty = every package declaring `search`. */
    chips: string[]
    /** Terms that must match. */
    include: string[]
    /** Terms that must NOT match. */
    exclude: string[]
}

/** A package the palette can search, derived from the manifest registry. */
export interface SearchPackage {
    slug: string
    label: string
    icon: string
    order: number
    endpoint: string
}
```

- [ ] **Step 2: Typecheck**

Run: `cd tinycld && pnpm exec tinycld-pkg typecheck`
Expected: PASS (no consumers yet, but the file must be valid).

- [ ] **Step 3: Commit**

```bash
git add tinycld/core/lib/search/types.ts
git commit -m "feat(search): add palette and adapter types"
```

---

### Task 2: Query parser

**Files:**
- Create: `tinycld/core/lib/search/parse-query.ts`
- Test: `tinycld/core/tests/unit/search-parse-query.test.ts`

**Interfaces:**
- Consumes: `ParsedQuery` from Task 1
- Produces: `parseQuery(input: string, installedSlugs: string[]): ParsedQuery`

Grammar rules, all tested below:
- A word followed by `:` becomes a chip **only** if it matches an installed slug (case-insensitive).
- `-term` excludes, but only when `-` is at a term boundary (start of string or preceded by whitespace) and followed by a non-space.
- `&&`, `||`, `!`, `AND`, `OR`, `NOT`, quotes, parens are stripped.

- [ ] **Step 1: Write the failing test**

```ts
import { parseQuery } from '@tinycld/core/lib/search/parse-query'
import { describe, expect, it } from 'vitest'

const SLUGS = ['mail', 'drive', 'cards', 'contacts']

describe('parseQuery — chips', () => {
    it('turns a matching word followed by a colon into a chip', () => {
        expect(parseQuery('mail: budget', SLUGS)).toEqual({
            chips: ['mail'],
            include: ['budget'],
            exclude: [],
        })
    })

    it('leaves a non-matching word with a colon as literal text', () => {
        expect(parseQuery('budget: q3', SLUGS)).toEqual({
            chips: [],
            include: ['budget', 'q3'],
            exclude: [],
        })
    })

    // The regression test for "mail server migration": a package name typed
    // WITHOUT a colon must stay searchable text, or that email is unfindable.
    it('leaves a package name without a colon as searchable text', () => {
        expect(parseQuery('mail server', SLUGS)).toEqual({
            chips: [],
            include: ['mail', 'server'],
            exclude: [],
        })
    })

    it('accepts multiple chips', () => {
        expect(parseQuery('mail: drive: budget', SLUGS)).toEqual({
            chips: ['mail', 'drive'],
            include: ['budget'],
            exclude: [],
        })
    })

    it('ignores a duplicate chip but still consumes the word', () => {
        expect(parseQuery('mail: mail: budget', SLUGS)).toEqual({
            chips: ['mail'],
            include: ['budget'],
            exclude: [],
        })
    })

    it('matches a slug case-insensitively', () => {
        expect(parseQuery('Mail: budget', SLUGS)).toEqual({
            chips: ['mail'],
            include: ['budget'],
            exclude: [],
        })
    })
})

describe('parseQuery — negation', () => {
    it('splits a boundary hyphen into an exclusion', () => {
        expect(parseQuery('budget -draft', SLUGS)).toEqual({
            chips: [],
            include: ['budget'],
            exclude: ['draft'],
        })
    })

    // The hyphen is in the FTS strip set precisely because of filenames like
    // this one. A mid-token hyphen must stay literal.
    it('keeps a mid-token hyphen literal', () => {
        expect(parseQuery('budget-2026.xlsx', SLUGS)).toEqual({
            chips: [],
            include: ['budget-2026.xlsx'],
            exclude: [],
        })
    })

    it('excludes when the hyphen starts the input', () => {
        expect(parseQuery('-draft', SLUGS)).toEqual({
            chips: [],
            include: [],
            exclude: ['draft'],
        })
    })

    it('drops a bare hyphen with no attached term', () => {
        expect(parseQuery('budget - draft', SLUGS)).toEqual({
            chips: [],
            include: ['budget', 'draft'],
            exclude: [],
        })
    })
})

describe('parseQuery — operator stripping', () => {
    it.each([
        ['a && b', ['a', 'b']],
        ['a || b', ['a', 'b']],
        ['a AND b', ['a', 'b']],
        ['a OR b', ['a', 'b']],
        ['a NOT b', ['a', 'b']],
        ['!urgent', ['urgent']],
        ['"quoted phrase"', ['quoted', 'phrase']],
        ['(grouped)', ['grouped']],
    ])('strips operators from %s', (input, expected) => {
        expect(parseQuery(input, SLUGS).include).toEqual(expected)
    })
})

describe('parseQuery — empty input', () => {
    it('returns empty arrays for blank input', () => {
        expect(parseQuery('   ', SLUGS)).toEqual({ chips: [], include: [], exclude: [] })
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tinycld && pnpm exec vitest run tests/unit/search-parse-query.test.ts`
Expected: FAIL — cannot resolve `@tinycld/core/lib/search/parse-query`.

- [ ] **Step 3: Write the implementation**

```ts
import type { ParsedQuery } from './types'

// Bare boolean operators and grouping/quoting characters. Stripped rather than
// supported: every backend already strips them (core/fts sanitize.go), and
// passing incomplete expressions like `foo AND ` through to FTS5 turns a
// half-typed query into a parse error under search-as-you-type.
// Bounded by whitespace or string edge, NOT \b: `\b` treats `-` as a word
// boundary, so `plan-NOT-final.docx` would split into `plan-` and `-final.docx`
// and the filename's own text would become an exclusion.
const OPERATOR_WORDS = /(^|\s)(AND|OR|NOT)(?=\s|$)/g
const OPERATOR_CHARS = /[&|!"'()]/g

/**
 * Parse palette input into scope chips and include/exclude terms.
 *
 * A word becomes a chip only when the user types `:` after it AND it names an
 * installed package — so "mail" alone stays searchable text and the email
 * titled "mail server migration" remains findable.
 */
export function parseQuery(input: string, installedSlugs: string[]): ParsedQuery {
    const slugSet = new Set(installedSlugs.map(s => s.toLowerCase()))
    const chips: string[] = []
    const include: string[] = []
    const exclude: string[] = []

    // '$1 ' keeps the captured leading separator so two adjacent operator
    // words ('a AND OR b') both strip rather than the second surviving.
    const cleaned = input.replace(OPERATOR_WORDS, '$1 ').replace(OPERATOR_CHARS, ' ')

    for (const rawToken of cleaned.split(/\s+/)) {
        const token = rawToken.trim()
        if (!token) continue

        if (token.endsWith(':')) {
            const candidate = token.slice(0, -1).toLowerCase()
            if (slugSet.has(candidate)) {
                if (!chips.includes(candidate)) chips.push(candidate)
                continue
            }
            // Not a package name — keep it as text, minus the trailing colon.
            const literal = token.slice(0, -1)
            if (literal) include.push(literal)
            continue
        }

        // A leading hyphen negates only when a term follows it. Because we
        // split on whitespace first, any hyphen still inside a token is
        // mid-token by construction (budget-2026) and stays literal.
        if (token.startsWith('-')) {
            // Strip every leading hyphen, not just one: '--draft' should
            // exclude 'draft', not the literal '-draft'.
            const term = token.replace(/^-+/, '')
            if (term) exclude.push(term)
            continue
        }

        include.push(token)
    }

    return { chips, include, exclude }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tinycld && pnpm exec vitest run tests/unit/search-parse-query.test.ts`
Expected: PASS, 15 tests.

- [ ] **Step 5: Commit**

```bash
git add tinycld/core/lib/search/parse-query.ts tinycld/core/tests/unit/search-parse-query.test.ts
git commit -m "feat(search): parse chips, exclusions and strip operators"
```

---

### Task 3: Cross-package scoring

**Files:**
- Create: `tinycld/core/lib/search/score.ts`
- Test: `tinycld/core/tests/unit/search-score.test.ts`

**Interfaces:**
- Consumes: `SearchRow` from Task 1
- Produces: `scoreRow(includeTerms: string[], row: SearchRow): number`, `compareRows(a, b, terms, orderBySlug): number`

Why not BM25: FTS5 ranks are computed against each table's own corpus, so a drive score and a mail score are in different units. See the spec's "Cross-package scoring".

- [ ] **Step 1: Write the failing test**

```ts
import { compareRows, scoreRow } from '@tinycld/core/lib/search/score'
import type { SearchRow } from '@tinycld/core/lib/search/types'
import { describe, expect, it } from 'vitest'

const row = (over: Partial<SearchRow>): SearchRow => ({
    slug: 'mail',
    id: '1',
    title: 'untitled',
    ...over,
})

describe('scoreRow — tiers', () => {
    it('ranks an exact title match highest', () => {
        expect(scoreRow(['budget'], row({ title: 'budget' }))).toBeGreaterThan(
            scoreRow(['budget'], row({ title: 'budget review' }))
        )
    })

    it('ranks a title prefix above a word-prefix match', () => {
        expect(scoreRow(['budget'], row({ title: 'budget review' }))).toBeGreaterThan(
            scoreRow(['budget'], row({ title: 'Q3 budgeting notes' }))
        )
    })

    it('ranks a title match above a subtitle-only match', () => {
        expect(scoreRow(['grace'], row({ title: 'grace period' }))).toBeGreaterThan(
            scoreRow(['grace'], row({ title: 'Q3 approval', subtitle: 'Grace Hopper' }))
        )
    })

    it('ranks a subtitle match above a body-only hit with no visible match', () => {
        expect(
            scoreRow(['budget'], row({ title: 'Q3 approval', subtitle: 'budget team' }))
        ).toBeGreaterThan(scoreRow(['budget'], row({ title: 'Q3 approval' })))
    })

    it('is case- and punctuation-insensitive on an exact match', () => {
        expect(scoreRow(['budget-2026'], row({ title: 'Budget 2026' }))).toBe(
            scoreRow(['budget-2026'], row({ title: 'budget-2026' }))
        )
    })

    it('requires every term to match for the all-terms tier', () => {
        const both = scoreRow(['q3', 'budget'], row({ title: 'Q3 budget plan' }))
        const one = scoreRow(['q3', 'budget'], row({ title: 'Q3 plan' }))
        expect(both).toBeGreaterThan(one)
    })
})

describe('compareRows — cross-package ordering', () => {
    const order = { mail: 5, drive: 12, cards: 25 }

    // The case that motivates scoring at all: without it, nav.order alone
    // would put Mail's weak hit above Drive's exact filename match.
    it('puts a high-tier hit from a later package above a low-tier earlier one', () => {
        const driveExact = row({ slug: 'drive', id: 'd1', title: 'budget-2026' })
        const mailWeak = row({
            slug: 'mail',
            id: 'm1',
            title: 'Q3 approval',
            subtitle: 'budget team',
        })
        const sorted = [mailWeak, driveExact].sort((a, b) =>
            compareRows(a, b, ['budget-2026'], order)
        )
        expect(sorted[0].id).toBe('d1')
    })

    it('prefers the shorter title within a tier', () => {
        const short = row({ slug: 'mail', id: 'a', title: 'budget review' })
        const long = row({
            slug: 'drive',
            id: 'b',
            title: 'budget review for the third quarter of the year',
        })
        const sorted = [long, short].sort((a, b) => compareRows(a, b, ['budget'], order))
        expect(sorted[0].id).toBe('a')
    })

    it('falls back to nav.order when tier and title length tie', () => {
        const cards = row({ slug: 'cards', id: 'c', title: 'budget' })
        const mail = row({ slug: 'mail', id: 'm', title: 'budget' })
        const sorted = [cards, mail].sort((a, b) => compareRows(a, b, ['budget'], order))
        expect(sorted[0].id).toBe('m')
    })

    it('is deterministic regardless of input order', () => {
        const rows = [
            row({ slug: 'cards', id: 'c', title: 'budget plan' }),
            row({ slug: 'drive', id: 'd', title: 'budget' }),
            row({ slug: 'mail', id: 'm', title: 'Q3', subtitle: 'budget' }),
        ]
        const forward = [...rows].sort((a, b) => compareRows(a, b, ['budget'], order))
        const backward = [...rows].reverse().sort((a, b) => compareRows(a, b, ['budget'], order))
        expect(forward.map(r => r.id)).toEqual(backward.map(r => r.id))
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tinycld && pnpm exec vitest run tests/unit/search-score.test.ts`
Expected: FAIL — cannot resolve `@tinycld/core/lib/search/score`.

- [ ] **Step 3: Write the implementation**

```ts
import type { SearchRow } from './types'

const TIER_EXACT_TITLE = 1000
const TIER_TITLE_PREFIX = 800
const TIER_ALL_TERMS_IN_TITLE = 600
const TIER_TITLE_SUBSTRING = 400
const TIER_SECONDARY_MATCH = 200
const TIER_NO_VISIBLE_MATCH = 100

/**
 * Fold case and punctuation so 'Budget 2026' and 'budget-2026' compare equal.
 * Punctuation becomes a space rather than being deleted, so 'budget-2026' and
 * 'budget 2026' normalize identically instead of collapsing to 'budget2026'.
 */
function normalize(value: string): string {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
}

/**
 * Score how well a row matches the query, using only text the row displays.
 *
 * Deliberately NOT BM25: FTS5 ranks weight terms by frequency within their own
 * table's corpus, so scores from two packages are in different units and a
 * perfect filename match can sort below a marginal mail hit. Match quality
 * against visible text is unit-free and identical for every package.
 */
export function scoreRow(includeTerms: string[], row: SearchRow): number {
    const terms = includeTerms.map(normalize).filter(Boolean)
    if (terms.length === 0) return TIER_NO_VISIBLE_MATCH

    const title = normalize(row.title)
    const query = terms.join(' ')

    if (title === query) return TIER_EXACT_TITLE
    if (title.startsWith(query)) return TIER_TITLE_PREFIX

    const titleWords = title.split(' ')
    const everyTermPrefixesAWord = terms.every(term =>
        titleWords.some(word => word.startsWith(term))
    )
    if (everyTermPrefixesAWord) return TIER_ALL_TERMS_IN_TITLE

    if (title.includes(query)) return TIER_TITLE_SUBSTRING

    const secondary = normalize([row.subtitle, row.meta].filter(Boolean).join(' '))
    if (secondary && terms.some(term => secondary.includes(term))) return TIER_SECONDARY_MATCH

    // The backend matched something we cannot see — a mail body or drive file
    // content. Keep it, but below anything with a visible match.
    return TIER_NO_VISIBLE_MATCH
}

/**
 * Sort comparator for a flat cross-package list. Tie-breaks, in order:
 * shorter title (a tighter match), then the package's nav.order so the
 * ordering is stable while results stream in from several packages.
 */
export function compareRows(
    a: SearchRow,
    b: SearchRow,
    includeTerms: string[],
    orderBySlug: Record<string, number>
): number {
    const scoreDelta = scoreRow(includeTerms, b) - scoreRow(includeTerms, a)
    if (scoreDelta !== 0) return scoreDelta

    const lengthDelta = a.title.length - b.title.length
    if (lengthDelta !== 0) return lengthDelta

    return (orderBySlug[a.slug] ?? 0) - (orderBySlug[b.slug] ?? 0)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tinycld && pnpm exec vitest run tests/unit/search-score.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add tinycld/core/lib/search/score.ts tinycld/core/tests/unit/search-score.test.ts
git commit -m "feat(search): score rows by match quality across packages"
```

---

### Task 4: Section builder

**Files:**
- Create: `tinycld/core/lib/search/build-sections.ts`
- Test: `tinycld/core/tests/unit/search-build-sections.test.ts`

**Interfaces:**
- Consumes: `SearchRow`, `SearchPackage` (Task 1), `compareRows` (Task 3)
- Produces: `buildSections(rowsBySlug, packages, chips, includeTerms): SearchSection[]` and `SearchSection`

Grouping rule from the spec: zero chips → one flat score-ordered section with badges; one chip → one flat section, no badges; 2+ chips → one section per package ordered by `nav.order`.

- [ ] **Step 1: Write the failing test**

```ts
import { buildSections } from '@tinycld/core/lib/search/build-sections'
import type { SearchPackage, SearchRow } from '@tinycld/core/lib/search/types'
import { describe, expect, it } from 'vitest'

const PACKAGES: SearchPackage[] = [
    { slug: 'mail', label: 'Mail', icon: 'mail', order: 5, endpoint: '/api/mail/search' },
    { slug: 'drive', label: 'Drive', icon: 'hard-drive', order: 12, endpoint: '/api/drive/search' },
    {
        slug: 'cards',
        label: 'Cards',
        icon: 'square-kanban',
        order: 25,
        endpoint: '/api/cards/search',
    },
]

const row = (slug: string, id: string, title: string): SearchRow => ({ slug, id, title })

describe('buildSections', () => {
    it('returns one flat badged section when no chips are set', () => {
        const sections = buildSections(
            { mail: [row('mail', 'm1', 'Q3 approval')], drive: [row('drive', 'd1', 'budget')] },
            PACKAGES,
            [],
            ['budget']
        )
        expect(sections).toHaveLength(1)
        expect(sections[0].title).toBeUndefined()
        expect(sections[0].showBadges).toBe(true)
        // Drive's exact match outranks mail despite mail's lower nav.order.
        expect(sections[0].rows.map(r => r.id)).toEqual(['d1', 'm1'])
    })

    it('returns one unbadged section when exactly one chip is set', () => {
        const sections = buildSections(
            { mail: [row('mail', 'm1', 'budget'), row('mail', 'm2', 'Q3')] },
            PACKAGES,
            ['mail'],
            ['budget']
        )
        expect(sections).toHaveLength(1)
        expect(sections[0].showBadges).toBe(false)
        // A single package keeps its own backend rank order.
        expect(sections[0].rows.map(r => r.id)).toEqual(['m1', 'm2'])
    })

    it('groups by package ordered by nav.order when 2+ chips are set', () => {
        const sections = buildSections(
            { cards: [row('cards', 'c1', 'budget')], mail: [row('mail', 'm1', 'budget')] },
            PACKAGES,
            ['cards', 'mail'],
            ['budget']
        )
        expect(sections.map(s => s.title)).toEqual(['Mail', 'Cards'])
        expect(sections.map(s => s.icon)).toEqual(['mail', 'square-kanban'])
    })

    it('omits a package that returned no rows', () => {
        const sections = buildSections(
            { cards: [], mail: [row('mail', 'm1', 'budget')] },
            PACKAGES,
            ['cards', 'mail'],
            ['budget']
        )
        expect(sections.map(s => s.title)).toEqual(['Mail'])
    })

    it('returns no sections when nothing matched', () => {
        expect(buildSections({}, PACKAGES, [], ['budget'])).toEqual([])
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tinycld && pnpm exec vitest run tests/unit/search-build-sections.test.ts`
Expected: FAIL — cannot resolve `@tinycld/core/lib/search/build-sections`.

- [ ] **Step 3: Write the implementation**

```ts
import { compareRows } from './score'
import type { SearchPackage, SearchRow } from './types'

export interface SearchSection {
    /** Group heading; undefined for a flat list. */
    title?: string
    /** Lucide icon name for the heading. */
    icon?: string
    /** Whether rows show a per-row package badge (flat multi-package only). */
    showBadges: boolean
    rows: SearchRow[]
}

/**
 * Arrange per-package results for rendering.
 *
 * Unscoped search is FLAT and score-ordered: it is the "I don't know where it
 * is" case, so the best answer has to be able to reach the top. Grouping would
 * pin a perfect match below every row of an earlier package. With 2+ explicit
 * chips the user has already narrowed the field, and scan-by-package is the
 * more useful affordance.
 */
export function buildSections(
    rowsBySlug: Record<string, SearchRow[]>,
    packages: SearchPackage[],
    chips: string[],
    includeTerms: string[]
): SearchSection[] {
    const orderBySlug: Record<string, number> = {}
    for (const pkg of packages) orderBySlug[pkg.slug] = pkg.order

    if (chips.length >= 2) {
        const sections: SearchSection[] = []
        for (const pkg of [...packages].sort((a, b) => a.order - b.order)) {
            if (!chips.includes(pkg.slug)) continue
            const rows = rowsBySlug[pkg.slug] ?? []
            if (rows.length === 0) continue
            sections.push({ title: pkg.label, icon: pkg.icon, showBadges: false, rows })
        }
        return sections
    }

    const all = Object.values(rowsBySlug).flat()
    if (all.length === 0) return []

    // One chip means one package, whose backend already ranked its own rows —
    // re-sorting would discard that judgement for no gain.
    if (chips.length === 1) {
        return [{ showBadges: false, rows: all }]
    }

    const sorted = [...all].sort((a, b) => compareRows(a, b, includeTerms, orderBySlug))
    return [{ showBadges: true, rows: sorted }]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tinycld && pnpm exec vitest run tests/unit/search-build-sections.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add tinycld/core/lib/search/build-sections.ts tinycld/core/tests/unit/search-build-sections.test.ts
git commit -m "feat(search): build flat or grouped result sections"
```

---

### Task 5: Palette store

**Files:**
- Create: `tinycld/core/lib/search/search-palette-store.ts`
- Test: `tinycld/core/tests/unit/search-palette-store.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `useSearchPaletteStore` with `{ isOpen, text, selectedRowId, open(seedSlug), close(), setText(v), setSelectedRowId(id) }`

Selection is tracked by **row id, not index**, because the flat list re-sorts as slower packages resolve and an index would move the cursor to a different row. Not persisted — a restored palette would greet the user with a dialog they did not open.

- [ ] **Step 1: Write the failing test**

```ts
import { useSearchPaletteStore } from '@tinycld/core/lib/search/search-palette-store'
import { beforeEach, describe, expect, it } from 'vitest'

describe('useSearchPaletteStore', () => {
    beforeEach(() => {
        useSearchPaletteStore.getState().close()
    })

    it('opens seeded with the current package as a chip', () => {
        useSearchPaletteStore.getState().open('mail')
        const state = useSearchPaletteStore.getState()
        expect(state.isOpen).toBe(true)
        expect(state.text).toBe('mail: ')
    })

    it('opens with empty text when no package is active', () => {
        useSearchPaletteStore.getState().open(null)
        expect(useSearchPaletteStore.getState().text).toBe('')
    })

    it('resets text and selection on close', () => {
        const store = useSearchPaletteStore.getState()
        store.open('mail')
        store.setText('mail: budget')
        store.setSelectedRowId('m1')
        store.close()
        const state = useSearchPaletteStore.getState()
        expect(state.isOpen).toBe(false)
        expect(state.text).toBe('')
        expect(state.selectedRowId).toBeNull()
    })

    it('clears the selection when the text changes', () => {
        const store = useSearchPaletteStore.getState()
        store.open(null)
        store.setSelectedRowId('m1')
        store.setText('budget')
        expect(useSearchPaletteStore.getState().selectedRowId).toBeNull()
    })

    it('keeps the selection when set explicitly', () => {
        const store = useSearchPaletteStore.getState()
        store.open(null)
        store.setText('budget')
        store.setSelectedRowId('d1')
        expect(useSearchPaletteStore.getState().selectedRowId).toBe('d1')
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tinycld && pnpm exec vitest run tests/unit/search-palette-store.test.ts`
Expected: FAIL — cannot resolve the store module.

- [ ] **Step 3: Write the implementation**

```ts
import { create } from '@tinycld/core/lib/store'

interface SearchPaletteState {
    isOpen: boolean
    text: string
    /**
     * The selected row's id rather than its index: the flat list re-sorts as
     * slower packages resolve, and an index would leave the cursor pointing at
     * whatever row happened to land in that slot.
     */
    selectedRowId: string | null
    /** Open, seeding the active package as a chip so the common case is free. */
    open: (seedSlug: string | null) => void
    close: () => void
    setText: (value: string) => void
    setSelectedRowId: (id: string | null) => void
}

// Not persisted: a restored palette would open a dialog the user did not ask
// for, and a restored query would run against data that has since changed.
export const useSearchPaletteStore = create<SearchPaletteState>()(set => ({
    isOpen: false,
    text: '',
    selectedRowId: null,
    open: seedSlug => set({ isOpen: true, text: seedSlug ? `${seedSlug}: ` : '', selectedRowId: null }),
    close: () => set({ isOpen: false, text: '', selectedRowId: null }),
    // A new query invalidates the old selection — the row may no longer exist.
    setText: value => set({ text: value, selectedRowId: null }),
    setSelectedRowId: id => set({ selectedRowId: id }),
}))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tinycld && pnpm exec vitest run tests/unit/search-palette-store.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add tinycld/core/lib/search/search-palette-store.ts tinycld/core/tests/unit/search-palette-store.test.ts
git commit -m "feat(search): add the palette store"
```

---

### Task 6: Manifest field + generator wiring

**Files:**
- Modify: `tinycld/core/lib/packages/types.ts` (add `search` to `PackageManifest`)
- Modify: `tinycld/core/lib/packages/config-types.ts` (add `search` to `PackageEntry`)
- Modify: `tinycld/scripts/load-manifest.ts` (carry `search` through)
- Modify: `tinycld/scripts/gen-config.ts` (validate + emit)
- Create: `tinycld/core/lib/search/registry.ts`
- Test: `tinycld/core/tests/unit/search-registry.test.ts`

**Interfaces:**
- Consumes: `SearchPackage`, `SearchAdapterModule` (Task 1)
- Produces: `deriveSearchPackages(entries)`, `packageSearchPackages`, `loadSearchAdapter(slug)`

**Critical:** every component the generator emits today is wrapped in `lazy(...)`. An adapter is a module of two non-component exports, so it must be emitted as a **bare thunk** — `load: () => import('...')` — not `lazy(() => import('...'))`.

- [ ] **Step 1: Write the failing test**

```ts
import { deriveSearchPackages } from '@tinycld/core/lib/search/registry'
import { describe, expect, it } from 'vitest'

const entry = (
    slug: string,
    label: string,
    icon: string,
    order: number,
    search?: { endpoint: string; label?: string }
) => ({
    manifest: { slug, name: label, nav: { label, icon, order } },
    search: search ? { ...search, load: async () => ({ toRow: () => null, useSearchActions: () => ({ onSelect: () => {} }) }) } : undefined,
})

describe('deriveSearchPackages', () => {
    it('includes only packages declaring search', () => {
        const packages = deriveSearchPackages([
            entry('mail', 'Mail', 'mail', 5, { endpoint: '/api/mail/search' }),
            entry('calc', 'Calc', 'table', 30),
        ])
        expect(packages.map(p => p.slug)).toEqual(['mail'])
    })

    it('sorts by nav.order', () => {
        const packages = deriveSearchPackages([
            entry('cards', 'Cards', 'square-kanban', 25, { endpoint: '/api/cards/search' }),
            entry('mail', 'Mail', 'mail', 5, { endpoint: '/api/mail/search' }),
        ])
        expect(packages.map(p => p.slug)).toEqual(['mail', 'cards'])
    })

    it('defaults the label to nav.label', () => {
        const packages = deriveSearchPackages([
            entry('mail', 'Mail', 'mail', 5, { endpoint: '/api/mail/search' }),
        ])
        expect(packages[0].label).toBe('Mail')
    })

    it('prefers an explicit search label over nav.label', () => {
        const packages = deriveSearchPackages([
            entry('mail', 'Mail', 'mail', 5, { endpoint: '/api/mail/search', label: 'Email' }),
        ])
        expect(packages[0].label).toBe('Email')
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tinycld && pnpm exec vitest run tests/unit/search-registry.test.ts`
Expected: FAIL — cannot resolve `@tinycld/core/lib/search/registry`.

- [ ] **Step 3: Add the manifest field**

In `tinycld/core/lib/packages/types.ts`, add to `PackageManifest` after `help`:

```ts
    /**
     * How this package participates in the global `/` search palette.
     * `endpoint` is its search route; `adapter` is a package-exports subpath
     * to a module exporting `toRow` and `useSearchActions`. Omit to stay out
     * of the palette.
     */
    search?: {
        endpoint: string
        adapter: string
        /** Chip and group label. Defaults to `nav.label`. */
        label?: string
    }
```

In `tinycld/core/lib/packages/config-types.ts`, add to the `PackageEntry` interface and to the `definePackageEntry` parameter object:

```ts
    search?: {
        endpoint: string
        label?: string
        load: () => Promise<unknown>
    }
```

- [ ] **Step 4: Wire the generator**

In `tinycld/scripts/load-manifest.ts`, add `search` to the manifest interface so it survives loading:

```ts
    search?: { endpoint: string; adapter: string; label?: string }
```

In `tinycld/scripts/gen-config.ts`, add to the validation function alongside the other `assertSafeImportField` calls:

```ts
    if (p.search) assertSafeImportField('search.adapter', p.search.adapter)
```

and emit it inside the entry, after the `sidebarContributions` block:

```ts
        if (p.search) {
            lines.push('        search: {')
            lines.push(`            endpoint: ${jsonLiteral(p.search.endpoint)},`)
            if (p.search.label) lines.push(`            label: ${jsonLiteral(p.search.label)},`)
            // A bare thunk, NOT lazy(): the adapter module exports two
            // non-component values, which React.lazy cannot wrap.
            lines.push(
                `            load: () => import('${p.packageName}/${p.search.adapter}'),`
            )
            lines.push('        },')
        }
```

Also add `search` to the `ConfigPackage`-shaped type in `gen-config.ts` so `p.search` typechecks.

- [ ] **Step 5: Write the registry**

Create `tinycld/core/lib/search/registry.ts`:

```ts
import { tinycldConfig } from '@tinycld/app-generated/tinycld-config'
import type { SearchAdapterModule, SearchPackage } from './types'

type SearchEntryLike = {
    manifest: { slug: string; nav?: { label?: string; icon?: string; order?: number } }
    search?: { endpoint: string; label?: string; load: () => Promise<unknown> }
}

/** Packages that declare `search`, ordered by nav.order. */
export function deriveSearchPackages(entries: readonly SearchEntryLike[]): SearchPackage[] {
    const out: SearchPackage[] = []
    for (const e of entries) {
        if (!e.search) continue
        out.push({
            slug: e.manifest.slug,
            label: e.search.label ?? e.manifest.nav?.label ?? e.manifest.slug,
            icon: e.manifest.nav?.icon ?? 'search',
            order: e.manifest.nav?.order ?? 0,
            endpoint: e.search.endpoint,
        })
    }
    return out.sort((a, b) => a.order - b.order)
}

export const searchPackages = deriveSearchPackages(tinycldConfig as readonly SearchEntryLike[])

const loaders = new Map<string, () => Promise<unknown>>()
for (const e of tinycldConfig as readonly SearchEntryLike[]) {
    if (e.search) loaders.set(e.manifest.slug, e.search.load)
}

// Adapter modules are cached after first load so opening the palette in an
// eight-package workspace does not re-import on every keystroke.
const cache = new Map<string, SearchAdapterModule>()

export async function loadSearchAdapter(slug: string): Promise<SearchAdapterModule | null> {
    const cached = cache.get(slug)
    if (cached) return cached
    const load = loaders.get(slug)
    if (!load) return null
    const mod = (await load()) as SearchAdapterModule
    cache.set(slug, mod)
    return mod
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd tinycld && pnpm exec vitest run tests/unit/search-registry.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 7: Regenerate and typecheck**

Run: `cd tinycld && pnpm run packages:generate && pnpm exec tinycld-pkg typecheck`
Expected: PASS. No package declares `search` yet, so the generated config is unchanged.

- [ ] **Step 8: Commit**

```bash
git add tinycld/core/lib/packages/types.ts tinycld/core/lib/packages/config-types.ts \
        tinycld/scripts/load-manifest.ts tinycld/scripts/gen-config.ts \
        tinycld/core/lib/search/registry.ts tinycld/core/tests/unit/search-registry.test.ts
git commit -m "feat(search): add the search manifest contribution and registry"
```

---

### Task 7: core/fts — Scope interface, MemberScope, ExcludeField, disabled check

**Files:**
- Modify: `tinycld/core/server/fts/config.go`
- Modify: `tinycld/core/server/fts/search.go`
- Modify: `contacts/server/register.go:50` (`Owner:` → `Scope:`)
- Test: `tinycld/core/server/fts/search_test.go`

**Interfaces:**
- Consumes: nothing
- Produces: `fts.Scope` interface, `fts.OwnerScope`, `fts.MemberScope`, `Config.Scope`, `Config.ExcludeField`

Three changes bundled because they touch the same two files and one migration of callers. `ExcludeField` is separate from `SoftDeleteField` because cards' `archived` is a **bool**, and `field = ''` against a bool misbehaves under SQLite's loose typing.

- [ ] **Step 1: Write the failing test**

Add to `tinycld/core/server/fts/search_test.go`:

```go
func TestOwnerScopeClause(t *testing.T) {
	s := OwnerScope{Field: "owner"}
	if got := s.clause(); got != "c.owner IN ({:scopeUser})" {
		t.Errorf("clause() = %q", got)
	}
	if got := s.params("u1")["scopeUser"]; got != "u1" {
		t.Errorf("params()[scopeUser] = %v", got)
	}
}

func TestMemberScopeClause(t *testing.T) {
	s := MemberScope{
		Table:       "cards_project_members",
		MemberField: "project",
		UserField:   "user",
		RecordField: "project",
	}
	want := "c.project IN (SELECT project FROM cards_project_members WHERE user = {:scopeUser})"
	if got := s.clause(); got != want {
		t.Errorf("clause() = %q, want %q", got, want)
	}
	if got := s.params("u1")["scopeUser"]; got != "u1" {
		t.Errorf("params()[scopeUser] = %v", got)
	}
}

func TestExcludeClause(t *testing.T) {
	if got := excludeClause(Config{}); got != "" {
		t.Errorf("no ExcludeField should emit nothing, got %q", got)
	}
	if got := excludeClause(Config{ExcludeField: "archived"}); got != " AND c.archived != true" {
		t.Errorf("excludeClause = %q", got)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tinycld/core/server && go test ./fts/ -run 'Scope|Exclude' -count=1`
Expected: FAIL — `OwnerScope.clause` undefined, `MemberScope` undefined, `excludeClause` undefined.

- [ ] **Step 3: Implement in config.go**

Replace the `OwnerScope` block at the end of `config.go`:

```go
// Scope constrains search results to rows the requesting user may see. It is an
// interface because ownership is not uniform: some collections hold the owner's
// id directly, others grant access through a membership table.
type Scope interface {
	// clause returns a SQL fragment ANDed into the WHERE. Identifiers come
	// from config (trusted); the user id is always a bound parameter.
	clause() string
	params(userID string) map[string]any
}

// OwnerScope resolves ownership through a single relation field holding the
// user's id directly (single-org: the former user_org junction is gone).
type OwnerScope struct {
	// Field is the collection field holding the owner reference.
	Field string
}

func (s OwnerScope) clause() string {
	return "c." + s.Field + " IN ({:scopeUser})"
}

func (s OwnerScope) params(userID string) map[string]any {
	return map[string]any{"scopeUser": userID}
}

// MemberScope resolves access through a membership table: the record is visible
// when the user holds a row granting them its parent. Emitted as a live
// subquery rather than a cached grant, so removing a member takes effect on the
// next search.
type MemberScope struct {
	// Table is the membership collection (e.g. "cards_project_members").
	Table string
	// MemberField is the column in Table pointing at the parent record.
	MemberField string
	// UserField is the column in Table pointing at the user.
	UserField string
	// RecordField is the column on the SEARCHED collection pointing at the
	// same parent.
	RecordField string
}

func (s MemberScope) clause() string {
	return "c." + s.RecordField + " IN (SELECT " + s.MemberField +
		" FROM " + s.Table + " WHERE " + s.UserField + " = {:scopeUser})"
}

func (s MemberScope) params(userID string) map[string]any {
	return map[string]any{"scopeUser": userID}
}
```

Then in the `Config` struct, replace the `Owner OwnerScope` field:

```go
	// Scope constrains results to rows the caller may see.
	Scope Scope

	// ExcludeField, when set, drops rows whose BOOL field is true (e.g.
	// cards' `archived`).
	//
	// Deliberately distinct from SoftDeleteField: that one splits on
	// `field = ''` vs `!= ''`, which is correct for a TEXT timestamp but
	// misbehaves against a bool column under SQLite's loose typing. Two
	// mechanisms, two column types — do not conflate them.
	ExcludeField string
```

- [ ] **Step 4: Implement in search.go**

Replace the params/inClause setup and the `base` construction:

```go
	params := map[string]any{"match": match}
	for k, v := range cfg.Scope.params(userID) {
		params[k] = v
	}

	// Search is raw SQL behind requireAuth, so PocketBase's collection rules
	// never run on this path. Without this check a disabled account keeps
	// reading titles and content until its token expires — the same hole drive
	// had to patch separately.
	if isDisabled(app, userID) {
		return nil, 0, nil
	}
```

and:

```go
	base := " FROM " + cfg.Table +
		" JOIN " + cfg.Collection + " c ON c.id = " + cfg.Table + ".record_id" +
		" WHERE " + cfg.Table + " MATCH {:match}" +
		" AND " + cfg.Scope.clause() +
		deletedClause +
		excludeClause(cfg)
```

Add the two helpers at the bottom of `search.go`:

```go
// excludeClause drops rows whose bool ExcludeField is true.
func excludeClause(cfg Config) string {
	if cfg.ExcludeField == "" {
		return ""
	}
	return " AND c." + cfg.ExcludeField + " != true"
}

// isDisabled reports whether the user record is missing or flagged disabled.
// A missing record is treated as disabled: a token for a deleted user must not
// keep reading.
func isDisabled(app *pocketbase.PocketBase, userID string) bool {
	user, err := app.FindRecordById("users", userID)
	if err != nil || user == nil {
		return true
	}
	return user.GetBool("disabled")
}
```

- [ ] **Step 5: Update the only caller**

In `contacts/server/register.go`, change `Owner: fts.OwnerScope{Field: "owner"},` to:

```go
	Scope: fts.OwnerScope{Field: "owner"},
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd tinycld/core/server && go test ./fts/ -count=1`
Expected: PASS.

Run: `cd contacts/server && go build ./... && go test ./... -count=1`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git -C tinycld add core/server/fts/config.go core/server/fts/search.go core/server/fts/search_test.go
git -C tinycld commit -m "feat(fts): add MemberScope, ExcludeField and a disabled-user check"
git -C contacts add server/register.go
git -C contacts commit -m "refactor(search): rename Owner to Scope for the fts interface"
```

---

### Task 8: core/fts — negation

**Files:**
- Modify: `tinycld/core/server/fts/sanitize.go`
- Modify: `tinycld/core/server/fts/search.go` (thread `Exclude` through `SearchOpts`)
- Modify: `tinycld/core/server/fts/register.go` (read the `not` param)
- Test: `tinycld/core/server/fts/sanitize_test.go`

**Interfaces:**
- Consumes: Task 7's `Config`
- Produces: `SanitizeQueryWithExclusions(include, exclude string) string`, `SearchOpts.Exclude`

The client sends exclusions as a separate `not` param — no backend ever parses operator syntax, so `sanitize.go`'s injection defense stays intact.

- [ ] **Step 1: Write the failing test**

Add to `tinycld/core/server/fts/sanitize_test.go`:

```go
func TestSanitizeQueryWithExclusions(t *testing.T) {
	cases := []struct {
		name             string
		include, exclude string
		want             string
	}{
		{"no exclusions", "budget", "", `"budget"*`},
		{"one exclusion", "budget", "draft", `"budget"* NOT "draft"*`},
		{"two exclusions", "budget", "draft old", `"budget"* NOT "draft"* NOT "old"*`},
		{"exclude only yields nothing", "", "draft", ""},
		{"blank both", "", "", ""},
	}
	for _, tc := range cases {
		if got := SanitizeQueryWithExclusions(tc.include, tc.exclude); got != tc.want {
			t.Errorf("%s: got %q, want %q", tc.name, got, tc.want)
		}
	}
}

// An exclusion must actually remove the row, not merely fail to boost it.
func TestExclusionRemovesMatchingRow(t *testing.T) {
	db := newContactsShapedFTS(t, liveFTSTokenizer,
		seedRow{id: "1", first: "Ada", notes: "budget planning"},
		seedRow{id: "2", first: "Grace", notes: "budget draft"},
	)
	q := SanitizeQueryWithExclusions("budget", "draft")
	rows, err := db.Query(`SELECT record_id FROM fts_contacts WHERE fts_contacts MATCH ?`, q)
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			t.Fatal(err)
		}
		ids = append(ids, id)
	}
	if len(ids) != 1 || ids[0] != "1" {
		t.Errorf("got %v, want [1]", ids)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tinycld/core/server && go test ./fts/ -run Exclusion -count=1`
Expected: FAIL — `SanitizeQueryWithExclusions` undefined.

- [ ] **Step 3: Implement in sanitize.go**

```go
// SanitizeQueryWithExclusions builds an FTS5 MATCH expression requiring every
// include term and rejecting every exclude term.
//
// Both sides arrive as already-split plain terms from the client's parseQuery —
// no operator syntax ever reaches this function, so the quoting below stays the
// only trust boundary. An exclude-only query returns "" rather than a bare NOT,
// which FTS5 rejects: there is no result set to subtract from.
func SanitizeQueryWithExclusions(include, exclude string) string {
	base := SanitizeQuery(include)
	if base == "" {
		return ""
	}

	cleaned := fts5SpecialChars.ReplaceAllString(exclude, " ")
	for _, term := range strings.Fields(cleaned) {
		term = strings.ReplaceAll(term, `"`, `""`)
		base += ` NOT "` + term + `"*`
	}
	return base
}
```

- [ ] **Step 4: Thread it through search.go and register.go**

In `search.go`, add to `SearchOpts`:

```go
	// Exclude holds space-separated terms that must NOT match.
	Exclude string
```

and change the first line of `Search`:

```go
	match := SanitizeQueryWithExclusions(opts.Query, opts.Exclude)
```

In `register.go`, add to the `SearchOpts` literal:

```go
			Exclude:        q.Get("not"),
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd tinycld/core/server && go test ./fts/ -count=1`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git -C tinycld add core/server/fts/sanitize.go core/server/fts/sanitize_test.go \
                  core/server/fts/search.go core/server/fts/register.go
git -C tinycld commit -m "feat(fts): support term exclusion via the not param"
```

---

### Task 9: Cards search route + migration

**Files:**
- Create: `cards/pb-migrations/1980000002_create_fts_cards.js`
- Modify: `cards/server/register.go`
- Test: `cards/server/search_scope_test.go`

**Interfaces:**
- Consumes: `fts.Config`, `fts.MemberScope`, `fts.Register` (Tasks 7–8)
- Produces: `GET /api/cards/search` returning `{items:[{id,title,project,list}], total}`

Migrations are append-only; 1980000000 and 1980000001 are shipped and frozen. Unlike contacts/drive/mail, `cards_cards` already shipped, so the migration must **backfill** — sync hooks only fire on future writes.

- [ ] **Step 1: Write the failing test**

Create `cards/server/search_scope_test.go`, modeled on `drive/server/search_disabled_test.go` (a hand-built minimal schema, not `rlstest` — raw SQL bypasses the rule engine):

```go
package cards

import (
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"tinycld.org/core/fts"
)

// setupSearchApp builds the minimal schema fts.Search reads for cards: users
// with a `disabled` flag, cards_projects, cards_project_members, cards_cards,
// and the FTS virtual table.
func setupSearchApp(t *testing.T) *tests.TestApp {
	t.Helper()
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	t.Cleanup(func() { app.Cleanup() })

	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatal(err)
	}
	users.Fields.Add(&core.BoolField{Name: "disabled"})
	if err := app.Save(users); err != nil {
		t.Fatal(err)
	}

	projects := core.NewBaseCollection("cards_projects")
	projects.Fields.Add(&core.TextField{Name: "name"})
	projects.Fields.Add(&core.BoolField{Name: "archived"})
	if err := app.Save(projects); err != nil {
		t.Fatal(err)
	}

	members := core.NewBaseCollection("cards_project_members")
	members.Fields.Add(&core.RelationField{Name: "project", CollectionId: projects.Id, MaxSelect: 1})
	members.Fields.Add(&core.RelationField{Name: "user", CollectionId: users.Id, MaxSelect: 1})
	if err := app.Save(members); err != nil {
		t.Fatal(err)
	}

	lists := core.NewBaseCollection("cards_lists")
	lists.Fields.Add(&core.TextField{Name: "name"})
	if err := app.Save(lists); err != nil {
		t.Fatal(err)
	}

	cards := core.NewBaseCollection("cards_cards")
	cards.Fields.Add(&core.TextField{Name: "title"})
	cards.Fields.Add(&core.TextField{Name: "description"})
	cards.Fields.Add(&core.RelationField{Name: "project", CollectionId: projects.Id, MaxSelect: 1})
	cards.Fields.Add(&core.RelationField{Name: "list", CollectionId: lists.Id, MaxSelect: 1})
	cards.Fields.Add(&core.BoolField{Name: "archived"})
	if err := app.Save(cards); err != nil {
		t.Fatal(err)
	}

	if _, err := app.DB().NewQuery(`
		CREATE VIRTUAL TABLE fts_cards USING fts5(
			record_id UNINDEXED, title, description, tokenize='porter unicode61'
		)`).Execute(); err != nil {
		t.Fatalf("create fts_cards: %v", err)
	}

	return app
}

func TestSearchScopedToMembership(t *testing.T) {
	app := setupSearchApp(t)
	member, other, projectID := seedProjectWithCard(t, app, "Ship the budget")

	hits, _, err := fts.Search(app, ftsConfig, member, fts.SearchOpts{Query: "budget", Limit: 25})
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	if len(hits) != 1 {
		t.Fatalf("member: got %d hits, want 1", len(hits))
	}
	if hits[0].Columns["project"] != projectID {
		t.Errorf("project = %v, want %v", hits[0].Columns["project"], projectID)
	}

	hits, _, err = fts.Search(app, ftsConfig, other, fts.SearchOpts{Query: "budget", Limit: 25})
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	if len(hits) != 0 {
		t.Errorf("non-member: got %d hits, want 0", len(hits))
	}
}

// Proves the scope is a live subquery rather than a grant captured at index
// time: revoking membership must take effect on the very next search.
func TestSearchDeniesRemovedMember(t *testing.T) {
	app := setupSearchApp(t)
	member, _, _ := seedProjectWithCard(t, app, "Ship the budget")

	rows, err := app.FindRecordsByFilter("cards_project_members", "user = {:u}", "", 0, 0,
		map[string]any{"u": member})
	if err != nil {
		t.Fatal(err)
	}
	for _, r := range rows {
		if err := app.Delete(r); err != nil {
			t.Fatal(err)
		}
	}

	hits, _, err := fts.Search(app, ftsConfig, member, fts.SearchOpts{Query: "budget", Limit: 25})
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	if len(hits) != 0 {
		t.Errorf("removed member: got %d hits, want 0", len(hits))
	}
}

func TestSearchDeniesDisabledUser(t *testing.T) {
	app := setupSearchApp(t)
	member, _, _ := seedProjectWithCard(t, app, "Ship the budget")

	user, err := app.FindRecordById("users", member)
	if err != nil {
		t.Fatal(err)
	}
	user.Set("disabled", true)
	if err := app.Save(user); err != nil {
		t.Fatal(err)
	}

	hits, _, err := fts.Search(app, ftsConfig, member, fts.SearchOpts{Query: "budget", Limit: 25})
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	if len(hits) != 0 {
		t.Errorf("disabled user: got %d hits, want 0", len(hits))
	}
}

func TestSearchExcludesArchivedCards(t *testing.T) {
	app := setupSearchApp(t)
	member, _, _ := seedProjectWithCard(t, app, "Ship the budget")

	card, err := app.FindFirstRecordByFilter("cards_cards", "title ~ 'budget'")
	if err != nil {
		t.Fatal(err)
	}
	card.Set("archived", true)
	if err := app.Save(card); err != nil {
		t.Fatal(err)
	}

	hits, _, err := fts.Search(app, ftsConfig, member, fts.SearchOpts{Query: "budget", Limit: 25})
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	if len(hits) != 0 {
		t.Errorf("archived card: got %d hits, want 0", len(hits))
	}
}
```

Add the shared seed helper in the same file:

```go
// seedProjectWithCard creates two users, a project the first belongs to, and
// one card in it. Returns (memberID, nonMemberID, projectID).
func seedProjectWithCard(t *testing.T, app *tests.TestApp, title string) (string, string, string) {
	t.Helper()
	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatal(err)
	}

	newUser := func(email string) string {
		u := core.NewRecord(users)
		u.Set("email", email)
		u.Set("password", "1234567890")
		if err := app.Save(u); err != nil {
			t.Fatal(err)
		}
		return u.Id
	}
	member := newUser("member@example.com")
	other := newUser("other@example.com")

	projects, err := app.FindCollectionByNameOrId("cards_projects")
	if err != nil {
		t.Fatal(err)
	}
	project := core.NewRecord(projects)
	project.Set("name", "Q3 Planning")
	if err := app.Save(project); err != nil {
		t.Fatal(err)
	}

	membersColl, err := app.FindCollectionByNameOrId("cards_project_members")
	if err != nil {
		t.Fatal(err)
	}
	m := core.NewRecord(membersColl)
	m.Set("project", project.Id)
	m.Set("user", member)
	if err := app.Save(m); err != nil {
		t.Fatal(err)
	}

	cardsColl, err := app.FindCollectionByNameOrId("cards_cards")
	if err != nil {
		t.Fatal(err)
	}
	card := core.NewRecord(cardsColl)
	card.Set("title", title)
	card.Set("project", project.Id)
	if err := app.Save(card); err != nil {
		t.Fatal(err)
	}

	if _, err := app.DB().NewQuery(
		`INSERT INTO fts_cards (record_id, title, description) VALUES ({:id}, {:t}, '')`,
	).Bind(map[string]any{"id": card.Id, "t": title}).Execute(); err != nil {
		t.Fatal(err)
	}

	return member, other, project.Id
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd cards/server && go test ./... -run Search -count=1`
Expected: FAIL — `ftsConfig` undefined.

- [ ] **Step 3: Write the migration**

Create `cards/pb-migrations/1980000002_create_fts_cards.js`, copying the `types.d.ts` reference-path convention from the sibling `1980000001` file:

```js
/// <reference path="../pb_data/types.d.ts" />
migrate(
    app => {
        app.db()
            .newQuery(`
                CREATE VIRTUAL TABLE IF NOT EXISTS fts_cards USING fts5(
                    record_id UNINDEXED, title, description, tokenize='porter unicode61'
                )
            `)
            .execute()

        // cards_cards shipped before this index existed, so the sync hooks —
        // which only fire on future writes — would leave every existing card
        // unsearchable. Unlike contacts/drive/mail, whose FTS tables shipped
        // alongside their collections, cards needs an explicit backfill.
        app.db()
            .newQuery(`
                INSERT INTO fts_cards (record_id, title, description)
                SELECT id, title, description FROM cards_cards
            `)
            .execute()
    },
    app => {
        app.db().newQuery('DROP TABLE IF EXISTS fts_cards').execute()
    }
)
```

- [ ] **Step 4: Wire the server**

In `cards/server/register.go`, add near the top-level vars:

```go
// ftsConfig is the cards FTS index/search config, driving both the index-sync
// hooks and the /api/cards/search route. The fts_cards virtual table is created
// by pb-migrations/1980000002; this only reads and writes it.
//
// description is markdown source rather than HTML, so it is indexed verbatim.
var ftsConfig = fts.Config{
	Slug:       "cards",
	Collection: "cards_cards",
	Table:      "fts_cards",
	Columns: []fts.Column{
		{FTS: "title", Field: "title"},
		{FTS: "description", Field: "description"},
	},
	Scope: fts.MemberScope{
		Table:       "cards_project_members",
		MemberField: "project",
		UserField:   "user",
		RecordField: "project",
	},
	Output: []fts.OutputColumn{
		{Name: "title"},
		{Name: "project"},
		{Name: "list"},
	},
	// Someone typing `/` wants active work, not history.
	ExcludeField: "archived",
}
```

and inside `registerShared`:

```go
	fts.Register(app, []fts.Config{ftsConfig})
```

Add `"tinycld.org/core/fts"` to the imports.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd cards/server && go build ./... && go test ./... -count=1`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git -C cards add pb-migrations/1980000002_create_fts_cards.js server/register.go server/search_scope_test.go
git -C cards commit -m "feat(search): index cards for full-text search"
```

---

### Task 10: Mail negation across both UNION arms

**Files:**
- Modify: `mail/server/search.go` (`buildThreadFTSQuery`, `buildMessageFTSQuery`)
- Modify: `mail/server/endpoints_search.go` (read the `not` param)
- Test: `mail/server/search_negation_test.go`

**Interfaces:**
- Consumes: nothing (mail keeps its own engine)
- Produces: mail's `/api/mail/search` honors `?not=`

**This is the highest-risk task in the plan.** Mail unions two FTS indexes. A negation applied to only one arm silently returns the rows the user asked to exclude, via the other arm.

- [ ] **Step 1: Write the failing test**

Create `mail/server/search_negation_test.go`:

```go
package mail

import "testing"

// Both arms of the UNION must carry the exclusion. Applying it to only one
// lets the other arm resurrect exactly the rows the user asked to drop —
// the most likely way this feature ships subtly broken.
func TestBothUnionArmsCarryExclusions(t *testing.T) {
	thread := buildThreadFTSQuery("budget", "draft")
	message := buildMessageFTSQuery("budget", "", "draft")

	for name, got := range map[string]string{"thread": thread, "message": message} {
		if !contains(got, `NOT "draft"*`) {
			t.Errorf("%s arm missing exclusion: %q", name, got)
		}
		if !contains(got, `"budget"*`) {
			t.Errorf("%s arm missing include term: %q", name, got)
		}
	}
}

func TestExclusionsOmittedWhenEmpty(t *testing.T) {
	if got := buildThreadFTSQuery("budget", ""); contains(got, "NOT") {
		t.Errorf("empty exclusion should emit no NOT, got %q", got)
	}
}

func contains(haystack, needle string) bool {
	return len(haystack) >= len(needle) && stringIndex(haystack, needle) >= 0
}

func stringIndex(haystack, needle string) int {
	for i := 0; i+len(needle) <= len(haystack); i++ {
		if haystack[i:i+len(needle)] == needle {
			return i
		}
	}
	return -1
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mail/server && go test ./... -run Union -count=1`
Expected: FAIL — `buildThreadFTSQuery` takes 1 argument, not 2.

- [ ] **Step 3: Implement**

In `mail/server/search.go`, add the exclusion helper and thread it into both builders:

```go
// appendExclusions adds a NOT clause per excluded term. Applied to EVERY arm of
// the search UNION: an exclusion missing from one arm lets that arm return the
// rows the user asked to exclude.
func appendExclusions(base, exclude string) string {
	if base == "" {
		return ""
	}
	cleaned := fts5SpecialChars.ReplaceAllString(exclude, " ")
	for _, term := range strings.Fields(cleaned) {
		term = strings.ReplaceAll(term, `"`, `""`)
		base += ` NOT "` + term + `"*`
	}
	return base
}
```

Change `buildThreadFTSQuery`:

```go
func buildThreadFTSQuery(q, exclude string) string {
	return appendExclusions(sanitizeFTSQuery(q), exclude)
}
```

Change `buildMessageFTSQuery`'s signature to `(q, hasWords, exclude string)` and wrap its return:

```go
	return appendExclusions(strings.TrimSpace(base), exclude)
```

Update both call sites in `endpoints_search.go` to pass the new argument, and add to `parseSearchRequest`:

```go
	req.Exclude = r.URL.Query().Get("not")
```

with a matching `Exclude string` field on `api.SearchRequest`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd mail/server && go build ./... && go test ./... -count=1`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C mail add server/search.go server/endpoints_search.go server/search_negation_test.go
git -C mail commit -m "feat(search): honor term exclusions in both search arms"
```

---

### Task 11: Drive negation

**Files:**
- Modify: `drive/server/search.go`
- Test: `drive/server/search_negation_test.go`

**Interfaces:**
- Consumes: nothing
- Produces: drive's `/api/drive/search` honors `?not=`

Drive carries its own copy of `sanitizeFTSQuery` — a second instance of the drift that motivates eventually folding drive onto `core/fts`.

- [ ] **Step 1: Write the failing test**

```go
package drive

import (
	"strings"
	"testing"
)

func TestSanitizeWithExclusions(t *testing.T) {
	got := sanitizeFTSQueryWithExclusions("budget", "draft")
	if !strings.Contains(got, `"budget"*`) {
		t.Errorf("missing include term: %q", got)
	}
	if !strings.Contains(got, `NOT "draft"*`) {
		t.Errorf("missing exclusion: %q", got)
	}
}

func TestExcludeOnlyReturnsEmpty(t *testing.T) {
	if got := sanitizeFTSQueryWithExclusions("", "draft"); got != "" {
		t.Errorf("exclude-only should return empty, got %q", got)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd drive/server && go test ./... -run Exclusi -count=1`
Expected: FAIL — `sanitizeFTSQueryWithExclusions` undefined.

- [ ] **Step 3: Implement**

In `drive/server/search.go`:

```go
// sanitizeFTSQueryWithExclusions builds a MATCH expression that requires the
// include terms and rejects the excluded ones. Returns "" for an exclude-only
// query: FTS5 rejects a bare NOT, and there is no result set to subtract from.
func sanitizeFTSQueryWithExclusions(include, exclude string) string {
	base := sanitizeFTSQuery(include)
	if base == "" {
		return ""
	}
	cleaned := fts5SpecialChars.ReplaceAllString(exclude, " ")
	for _, term := range strings.Fields(cleaned) {
		term = strings.ReplaceAll(term, `"`, `""`)
		base += ` NOT "` + term + `"*`
	}
	return base
}
```

Change `searchDriveItems` to take an `exclude string` parameter and use the new function; in `handleDriveSearch`, pass `re.Request.URL.Query().Get("not")`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd drive/server && go build ./... && go test ./... -count=1`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C drive add server/search.go server/search_negation_test.go
git -C drive commit -m "feat(search): honor term exclusions"
```

---

### Task 12: Package adapters (cards, contacts, drive, mail)

**Files (per package):**
- Create: `<pkg>/tinycld/<slug>/search-adapter.ts`
- Modify: `<pkg>/manifest.ts` (add `search`)
- Modify: `<pkg>/package.json` (add `"./search-adapter"` to `exports`)
- Test: `<pkg>/tests/search-adapter.test.ts`

**Interfaces:**
- Consumes: `SearchRow`, `SearchAdapterModule` (Task 1); the `search` manifest field (Task 6)
- Produces: four adapter modules resolvable as `@tinycld/<slug>/search-adapter`

All four follow one shape. **Cards is shown in full**; the other three repeat the same structure with their own field mappings — do not skip writing them out.

- [ ] **Step 1: Write the failing cards test**

Create `cards/tests/search-adapter.test.ts`:

```ts
import { toRow } from '@tinycld/cards/search-adapter'
import { describe, expect, it } from 'vitest'

describe('cards toRow', () => {
    it('maps a hit to a row with the card title', () => {
        const row = toRow({ id: 'c1', title: 'Ship the budget', project: 'p1', list: 'l1' })
        expect(row).toEqual({ id: 'c1', title: 'Ship the budget', subtitle: undefined, meta: undefined })
    })

    it('keeps a hit whose title is empty', () => {
        expect(toRow({ id: 'c1', title: '', project: 'p1', list: 'l1' })?.title).toBe('Untitled card')
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd cards && pnpm exec vitest run tests/search-adapter.test.ts`
Expected: FAIL — cannot resolve `@tinycld/cards/search-adapter`.

- [ ] **Step 3: Write the cards adapter**

Create `cards/tinycld/cards/search-adapter.ts`:

```ts
import type { SearchRow } from '@tinycld/core/lib/search/types'
import { useOrgHref } from '@tinycld/core/lib/org-routes'
import { useRouter } from 'expo-router'
import { useCardsUIStore } from './stores/cards-ui-store'

interface CardsSearchHit {
    id: string
    title: string
    project: string
    list: string
}

export function toRow(hit: unknown): Omit<SearchRow, 'slug'> | null {
    const card = hit as CardsSearchHit
    return {
        id: card.id,
        title: card.title || 'Untitled card',
        subtitle: undefined,
        meta: undefined,
    }
}

// The palette calls this for every in-scope package while it is open, so it
// only takes handles — no fetching, no subscriptions.
export function useSearchActions() {
    const router = useRouter()
    const orgHref = useOrgHref()

    return {
        onSelect: (row: SearchRow) => {
            const { projectByCardId, setActiveProject, openCard } = useCardsUIStore.getState()
            const projectId = projectByCardId(row.id)
            if (!projectId) return

            // The [cardId] screen derives its card from the ROUTE PARAM, not
            // from openCardId, so switching the project underneath it would
            // leave a stale id in the URL rendering "card doesn't exist".
            router.replace(orgHref('cards'))

            // Order matters: setActiveProject deliberately clears openCardId,
            // so opening the card first would immediately undo it. Both are
            // synchronous Zustand set() calls batched into one render.
            setActiveProject(projectId)
            openCard(row.id)
        },
    }
}
```

Add `projectByCardId` to `cards/tinycld/cards/stores/cards-ui-store.ts` — it resolves a card to its board without the palette needing a live query:

```ts
    /**
     * Resolve a card id to its project id. Set by the board screen as cards
     * sync; the palette needs it to open a card from another board and cannot
     * run a live query from inside an adapter hook.
     */
    projectByCardId: (cardId: string) => string | null
```

If the board screen does not already maintain such a map, implement `projectByCardId` by reading the cards collection through `useStore('cards_cards')` inside `useSearchActions` instead, and adjust the test accordingly.

- [ ] **Step 4: Declare the contribution**

In `cards/manifest.ts`, add after `help`:

```ts
    search: { endpoint: '/api/cards/search', adapter: 'search-adapter' },
```

In `cards/package.json` `exports`:

```json
        "./search-adapter": "./tinycld/cards/search-adapter.ts",
```

- [ ] **Step 5: Repeat for contacts, drive and mail**

`contacts/tinycld/contacts/search-adapter.ts`:

```ts
import type { SearchRow } from '@tinycld/core/lib/search/types'
import { useOrgHref } from '@tinycld/core/lib/org-routes'
import { useRouter } from 'expo-router'

interface ContactSearchHit {
    id: string
    first_name: string
    last_name: string
    email: string
    company: string
}

export function toRow(hit: unknown): Omit<SearchRow, 'slug'> | null {
    const c = hit as ContactSearchHit
    const name = [c.first_name, c.last_name].filter(Boolean).join(' ')
    return {
        id: c.id,
        title: name || c.email || 'Unnamed contact',
        subtitle: c.email || undefined,
        meta: c.company || undefined,
    }
}

export function useSearchActions() {
    const router = useRouter()
    const orgHref = useOrgHref()
    return {
        onSelect: (row: SearchRow) => {
            router.push(`${orgHref('contacts')}/${row.id}`)
        },
    }
}
```

`drive/tinycld/drive/search-adapter.ts`:

```ts
import type { SearchRow } from '@tinycld/core/lib/search/types'
import { useOrgHref } from '@tinycld/core/lib/org-routes'
import { useRouter } from 'expo-router'

interface DriveSearchHit {
    id: string
    name: string
    description: string
}

export function toRow(hit: unknown): Omit<SearchRow, 'slug'> | null {
    const item = hit as DriveSearchHit
    return {
        id: item.id,
        title: item.name || 'Untitled file',
        subtitle: item.description || undefined,
        meta: undefined,
    }
}

export function useSearchActions() {
    const router = useRouter()
    const orgHref = useOrgHref()
    return {
        onSelect: (row: SearchRow) => {
            router.push(`${orgHref('drive')}?item=${row.id}`)
        },
    }
}
```

`mail/tinycld/mail/search-adapter.ts`:

```ts
import type { SearchRow } from '@tinycld/core/lib/search/types'
import { useOrgHref } from '@tinycld/core/lib/org-routes'
import { useRouter } from 'expo-router'

interface MailSearchHit {
    thread_id: string
    subject: string
    participants: string
    latest_date: string
    mailbox_id: string
}

export function toRow(hit: unknown): Omit<SearchRow, 'slug'> | null {
    const thread = hit as MailSearchHit
    return {
        // Mail returns thread_id rather than id — the palette never sees the
        // difference because this is the only place that shape is read.
        id: thread.thread_id,
        title: thread.subject || '(no subject)',
        subtitle: thread.participants || undefined,
        meta: undefined,
    }
}

export function useSearchActions() {
    const router = useRouter()
    const orgHref = useOrgHref()
    return {
        onSelect: (row: SearchRow) => {
            router.push(`${orgHref('mail')}/${row.id}`)
        },
    }
}
```

Add the matching `search` manifest block and `./search-adapter` export to each of the three packages, and write a `tests/search-adapter.test.ts` per package asserting `toRow` maps that package's real hit shape (including the empty-title fallback).

- [ ] **Step 6: Regenerate and run all four test suites**

Run: `cd tinycld && pnpm run packages:generate`
Then: `cd cards && pnpm exec tinycld-pkg check` (repeat for contacts, drive, mail)
Expected: PASS.

- [ ] **Step 7: Commit (one per repo)**

```bash
git -C cards add manifest.ts package.json tinycld/cards/search-adapter.ts \
                 tinycld/cards/stores/cards-ui-store.ts tests/search-adapter.test.ts
git -C cards commit -m "feat(search): contribute a search adapter to the palette"
# repeat for contacts, drive, mail with their own paths
```

---

### Task 13: The palette shell

**Files:**
- Create: `tinycld/core/components/search-palette/SearchPalette.web.tsx`
- Create: `tinycld/core/components/search-palette/SearchPalette.tsx`
- Create: `tinycld/core/components/search-palette/useSearchResults.ts`
- Create: `tinycld/core/lib/search/use-active-package-slug.ts`
- Create: `tinycld/core/lib/use-debounced-value.ts` (extracted — see Step 1)
- Modify: `tinycld/core/lib/use-api-search.ts` (import the extracted helper)
- Modify: `tinycld/core/components/CoreShortcuts.tsx` (register `/`)
- Modify: the app shell layout that already mounts `HelpSearchPalette`, to mount `SearchPalette` alongside it

**Interfaces:**
- Consumes: everything from Tasks 1–6
- Produces: the rendered palette

Mirror `HelpSearchPalette`'s `.web.tsx` / `.tsx` split exactly. These land under core's existing `./components/*` wildcard export — no `package.json` change.

- [ ] **Step 1: Extract the debounce helper**

`useApiSearch` fetches ONE endpoint, so the palette cannot use it for an
N-package fan-out. But its 300ms debounce is still needed, and duplicating it
would let the two drift. Move `useDebouncedValue` out of
`tinycld/core/lib/use-api-search.ts` into `tinycld/core/lib/use-debounced-value.ts`
verbatim, export it, and have `use-api-search.ts` import it. No behavior change.

```ts
import { useEffect, useState } from 'react'

// Debounce a value: only surface the latest after `delayMs` of quiet. Genuine
// timer side-effect (not a server-data sync), so it stays in an effect.
export function useDebouncedValue<T>(value: T, delayMs: number): T {
    const [debounced, setDebounced] = useState(value)
    useEffect(() => {
        const timer = setTimeout(() => setDebounced(value), delayMs)
        return () => clearTimeout(timer)
    }, [value, delayMs])
    return debounced
}
```

Run `cd tinycld && pnpm exec vitest run tests/unit/` and confirm any existing
`use-api-search` tests still pass before continuing.

- [ ] **Step 2: Write the results hook**

Create `useSearchResults.ts`. **Use `useQueries`, not a loop of `useApiSearch`
calls** — the in-scope package list is dynamic, and calling a hook per package
in a `for` loop violates the Rules of Hooks. `useQueries` takes a dynamic array
and is the supported API for exactly this.

```ts
import { useQueries } from '@tanstack/react-query'
import { pb } from '@tinycld/core/lib/pocketbase'
import { buildSections, type SearchSection } from '@tinycld/core/lib/search/build-sections'
import { loadSearchAdapter, searchPackages } from '@tinycld/core/lib/search/registry'
import type { ParsedQuery, SearchAdapterModule, SearchRow } from '@tinycld/core/lib/search/types'
import { useDebouncedValue } from '@tinycld/core/lib/use-debounced-value'

const MIN_QUERY_LENGTH = 2
const DEBOUNCE_MS = 300

/**
 * Fan out one search per in-scope package and merge the results.
 *
 * useQueries rather than a loop of single-query hooks: the in-scope list
 * changes as the user adds and removes chips, and a hook called per iteration
 * of a `for` loop breaks the Rules of Hooks. React Query also gives each
 * package independent caching and abort-on-supersede for free, so a slow
 * package cannot hold up the rest.
 */
export function useSearchResults(parsed: ParsedQuery): {
    sections: SearchSection[]
    isSearching: boolean
} {
    const scoped =
        parsed.chips.length > 0
            ? searchPackages.filter(p => parsed.chips.includes(p.slug))
            : searchPackages

    const query = useDebouncedValue(parsed.include.join(' '), DEBOUNCE_MS)
    const not = useDebouncedValue(parsed.exclude.join(' '), DEBOUNCE_MS)
    const enabled = query.length >= MIN_QUERY_LENGTH

    // Adapter modules are dynamic imports. Running them through Query rather
    // than an effect keeps the resolution cached and out of component state;
    // loadSearchAdapter already memoizes, so this is belt-and-braces.
    const adapterQueries = useQueries({
        queries: scoped.map(pkg => ({
            queryKey: ['search-adapter', pkg.slug],
            queryFn: () => loadSearchAdapter(pkg.slug),
            staleTime: Number.POSITIVE_INFINITY,
        })),
    })

    const searchQueries = useQueries({
        queries: scoped.map(pkg => ({
            queryKey: ['package-search', pkg.slug, query, not],
            queryFn: ({ signal }: { signal: AbortSignal }) =>
                pb.send(pkg.endpoint, {
                    method: 'GET',
                    query: not ? { q: query, not } : { q: query },
                    signal,
                }),
            enabled,
            // A search is point-in-time: don't retry a failure (the user is
            // still typing) and don't refetch on window focus.
            retry: false,
            refetchOnWindowFocus: false,
        })),
    })

    const rowsBySlug: Record<string, SearchRow[]> = {}
    let isSearching = false

    scoped.forEach((pkg, i) => {
        if (searchQueries[i]?.isFetching) isSearching = true

        const adapter = adapterQueries[i]?.data as SearchAdapterModule | null | undefined
        const data = searchQueries[i]?.data as { items?: unknown[] } | undefined
        if (!adapter || !data?.items) return

        // A package whose request failed simply contributes no rows — one
        // backend erroring must not empty the whole palette.
        rowsBySlug[pkg.slug] = data.items
            .map(hit => adapter.toRow(hit))
            .filter((r): r is Omit<SearchRow, 'slug'> => r !== null)
            .map(r => ({ ...r, slug: pkg.slug }))
    })

    return {
        // Ordering lives entirely here and is unaffected by fetch order:
        // compareRows tie-breaks on nav.order precisely so a late-arriving
        // package cannot change the ranking of what already landed.
        sections: buildSections(rowsBySlug, searchPackages, parsed.chips, parsed.include),
        isSearching,
    }
}
```

- [ ] **Step 3: Write the shell**

Create `SearchPalette.web.tsx` following `HelpSearchPalette.web.tsx`'s structure: a module-level `<style>` injection with the id `tinycld-search-palette-styles` (distinct from help's, so the two cannot collide), `createPortal` to `document.body`, a capture-phase `keydown` listener, and click-outside dismiss.

Key differences from the help palette, all required:

```tsx
// Selection is tracked by ROW ID, not index: the flat list re-sorts as slower
// packages resolve, and an index would leave the cursor on a different row.
const flatRows = sections.flatMap(s => s.rows)
const selectedRow = flatRows.find(r => r.id === selectedRowId) ?? flatRows[0]

function moveSelection(delta: number) {
    if (flatRows.length === 0) return
    const current = flatRows.findIndex(r => r.id === selectedRow?.id)
    const next = (current + delta + flatRows.length) % flatRows.length
    setSelectedRowId(flatRows[next].id)
}
```

Backspace handling. Chips live inside `text` as `slug: ` prefixes, so both
helpers are string operations on it — add them at the top of the file:

```tsx
/** Render a chip list back into the `slug: slug: ` prefix form. */
function chipsToText(chips: string[]): string {
    return chips.map(c => `${c}: `).join('')
}

/** The free-text remainder after every leading chip. */
function textAfterChips(text: string, chips: string[]): string {
    return text.slice(chipsToText(chips).length)
}
```

```tsx
// Backspace on empty text pops the trailing chip, so widening the search to
// everywhere is one keystroke from the seeded state.
const remainder = textAfterChips(text, parsed.chips)
if (key === 'Backspace' && remainder.length === 0 && parsed.chips.length > 0) {
    event.preventDefault()
    setText(chipsToText(parsed.chips.slice(0, -1)))
    return
}
```

The footer is state-dependent:

```tsx
interface FooterHintsProps {
    chips: string[]
    remainder: string
}

// The footer is where the `:` and ⌫ grammar is discoverable, so it reacts to
// what the user has typed rather than showing three static hints.
function FooterHints({ chips, remainder }: FooterHintsProps) {
    // The last word matches a package but has no colon yet — offer the gesture.
    const lastWord = remainder.trim().split(/\s+/).pop() ?? ''
    const pending = searchPackages.find(
        p => p.slug === lastWord.toLowerCase() && !chips.includes(p.slug)
    )
    if (pending) {
        return <Hints items={['↑↓ move', '↵ open', `: scope to ${pending.slug}`, 'esc close']} />
    }
    if (chips.length > 0 && remainder.length === 0) {
        return <Hints items={['↑↓ move', '↵ open', `⌫ remove ${chips[chips.length - 1]}`, 'esc close']} />
    }
    return <Hints items={['↑↓ move', '↵ open', 'esc close']} />
}

function Hints({ items }: { items: string[] }) {
    return (
        <View className="flex-row gap-4 px-4 py-2 border-t border-border">
            {items.map(item => (
                <Text key={item} className="text-xs text-muted-foreground">
                    {item}
                </Text>
            ))}
        </View>
    )
}
```

Selection dispatch — every in-scope adapter's hook is called at the top level, then indexed:

`useSearchActions` is a genuine per-package hook and cannot go through Query.
Give each package a fixed child component so its hook sits at a component's top
level — iterating `searchPackages` (module-constant, never reordered at runtime)
rather than the filtered in-scope list keeps the number and order of hook calls
identical on every render:

```tsx
type SelectHandler = (row: SearchRow) => void

/**
 * Registers one package's selection handler. A component per package rather
 * than a loop of hook calls inside the palette: `useSearchActions` is a hook,
 * and calling it in a loop would break the Rules of Hooks the moment the
 * package list changed. Renders nothing.
 */
function PackageActions({
    slug,
    onReady,
}: {
    slug: string
    onReady: (slug: string, handler: SelectHandler) => void
}) {
    const adapter = useAdapterModule(slug)
    const actions = adapter?.useSearchActions()
    // Registering during render would mutate a parent ref mid-render; a ref
    // write in an effect is the standard imperative-handle pattern.
    useEffect(() => {
        if (actions) onReady(slug, actions.onSelect)
    }, [slug, actions, onReady])
    return null
}
```

The palette holds the handlers in a ref (not state — a handler landing must not
trigger a re-render) and indexes it on Enter:

```tsx
const handlersRef = useRef<Record<string, SelectHandler>>({})
const registerHandler = useCallback((slug: string, handler: SelectHandler) => {
    handlersRef.current[slug] = handler
}, [])

function selectRow(row: SearchRow) {
    handlersRef.current[row.slug]?.(row)
    close()
}
```

and renders one `PackageActions` per installed package inside the palette:

```tsx
{searchPackages.map(pkg => (
    <PackageActions key={pkg.slug} slug={pkg.slug} onReady={registerHandler} />
))}
```

`useAdapterModule(slug)` is a one-line `useQuery` wrapper over
`loadSearchAdapter`, sharing the `['search-adapter', slug]` key with
`useSearchResults` so the module resolves once:

```tsx
function useAdapterModule(slug: string): SearchAdapterModule | null {
    const { data } = useQuery({
        queryKey: ['search-adapter', slug],
        queryFn: () => loadSearchAdapter(slug),
        staleTime: Number.POSITIVE_INFINITY,
    })
    return (data as SearchAdapterModule | null) ?? null
}
```

Use only semantic tokens for styling — `bg-background`, `text-foreground`, `border-border`, `bg-surface-secondary` for the selected row — matching the help palette.

Create `SearchPalette.tsx` (the native stub):

```tsx
// Web-only for now: the palette is a keyboard surface, and the mobile
// equivalent is a separate design problem. Mirrors HelpSearchPalette's split.
export function SearchPalette() {
    return null
}
```

- [ ] **Step 4: Register the shortcut**

There is no existing "which package am I in" helper, so add one first. Create
`tinycld/core/lib/search/use-active-package-slug.ts`:

```ts
import { searchPackages } from './registry'
import { usePathname } from 'expo-router'

/**
 * The slug of the package the user is currently viewing, or null outside one.
 *
 * Derived from the path rather than stored, because the route IS the source of
 * truth — a separate store would drift on back/forward navigation. Only
 * packages that declare `search` can be seeded, so a match here is always a
 * valid chip.
 */
export function useActivePackageSlug(): string | null {
    const pathname = usePathname()
    const segments = pathname.split('/').filter(Boolean)
    for (const segment of segments) {
        if (searchPackages.some(p => p.slug === segment)) return segment
    }
    return null
}
```

Then in `tinycld/core/components/CoreShortcuts.tsx`, add the hook call beside
the existing `useOrgHref()` line:

```tsx
    const activeSlug = useActivePackageSlug()
```

add `activeSlug` to the `useMemo` dependency array, and add to the shortcuts list:

```tsx
            {
                id: 'core.search.open',
                keys: '/',
                scope: 'global',
                group: 'General',
                description: 'Search across packages',
                // allowInInputs omitted deliberately: `/` must stay suppressed
                // while the user is typing in the app.
                run: () => useSearchPaletteStore.getState().open(activeSlug),
            },
```

Import `useSearchPaletteStore` from `@tinycld/core/lib/search/search-palette-store`
and `useActivePackageSlug` from `@tinycld/core/lib/search/use-active-package-slug`.

- [ ] **Step 5: Mount the palette**

Find where `HelpSearchPalette` is mounted in the app shell and mount `SearchPalette` beside it.

Run: `cd tinycld && grep -rn "HelpSearchPalette" app/ core/components/ --include='*.tsx' | grep -v 'help/'`

- [ ] **Step 6: Verify**

Run: `cd tinycld && pnpm exec tinycld-pkg check`
Expected: PASS.

Manually: start the app, press `/`, confirm the palette opens seeded with the current package, typing returns results, `Escape` closes.

- [ ] **Step 7: Commit**

```bash
git -C tinycld add core/components/search-palette/ core/components/CoreShortcuts.tsx \
                  core/lib/search/use-active-package-slug.ts \
                  core/lib/use-debounced-value.ts core/lib/use-api-search.ts app/
git -C tinycld commit -m "feat(search): add the cross-package search palette"
```

---

### Task 14: E2E + help topic

**Files:**
- Create: `tinycld/tests/e2e/search-palette.spec.ts`
- Create: `tinycld/core/help/search.md`

**Interfaces:**
- Consumes: everything

Cross-package, so the spec lives at the workspace root rather than in one member.

- [ ] **Step 1: Write the help topic**

Create `tinycld/core/help/search.md`:

```markdown
---
title: Searching across packages
summary: Find anything from anywhere with the / palette
tags: [search, keyboard, packages]
order: 20
---

Press `/` anywhere in the app to open the search palette. It opens already
scoped to whatever you are looking at, so searching the current package costs
nothing extra.

## Searching everywhere

Press ⌫ (backspace) on an empty search box to remove the scope chip and search
every installed package at once. Results are grouped by package, best match
first.

## Scoping to a package

Type a package name followed by a colon — `drive:` — to limit the search to it.
The name becomes a chip once you type the colon, so you can still search for the
word itself: typing `mail` without a colon finds messages containing "mail".

Add more than one chip to search several packages at once:

    drive: mail: budget

That finds anything matching "budget" in Drive or Mail, and nothing else.

## Excluding words

Put a minus sign in front of a word to exclude it:

    budget -draft

Hyphens inside a word are left alone, so `budget-2026` still searches for the
whole term.

The palette does not support `AND`, `OR`, quotes or parentheses. Words are
combined automatically — every word you type has to match.

## Keys

- `↑` `↓` — move through results
- `↵` — open the selected result
- `⌫` — remove the last scope chip
- `esc` — close
```

- [ ] **Step 2: Regenerate help**

Run: `cd tinycld && pnpm run packages:generate`

- [ ] **Step 3: Write the e2e spec**

Create `tinycld/tests/e2e/search-palette.spec.ts`:

```ts
import { expect, test } from '@playwright/test'
import { login, navigateToPackage } from './helpers'

// useApiSearch debounces 300ms, so every assertion here waits on the actual
// response or on the resulting DOM — never a fixed timeout, which flakes
// under CI load.
async function search(page, text: string) {
    await page.keyboard.press('/')
    await expect(page.getByRole('dialog', { name: 'Search' })).toBeVisible()
    await page.keyboard.type(text)
    await page.waitForResponse(r => r.url().includes('/search') && r.status() === 200)
}

test('opens seeded with the current package', async ({ page }) => {
    await login(page)
    await navigateToPackage(page, 'cards')
    await page.keyboard.press('/')
    await expect(page.getByTestId('search-chip-cards')).toBeVisible()
})

test('backspace widens the search to every package', async ({ page }) => {
    await login(page)
    await navigateToPackage(page, 'cards')
    await page.keyboard.press('/')
    await page.keyboard.press('Backspace')
    await expect(page.getByTestId('search-chip-cards')).toHaveCount(0)
})

test('a colon scopes the search to one package', async ({ page }) => {
    await login(page)
    await navigateToPackage(page, 'cards')
    await search(page, 'drive: budget')
    await expect(page.getByTestId('search-chip-drive')).toBeVisible()
})

test('a package name without a colon stays searchable text', async ({ page }) => {
    await login(page)
    await navigateToPackage(page, 'cards')
    await page.keyboard.press('/')
    await page.keyboard.press('Backspace')
    await page.keyboard.type('mail')
    await expect(page.getByTestId('search-chip-mail')).toHaveCount(0)
})

test('selecting a card result opens it on its board', async ({ page }) => {
    await login(page)
    await navigateToPackage(page, 'cards')
    await search(page, 'budget')
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('card-peek')).toBeVisible()
})

test('escape closes without navigating', async ({ page }) => {
    await login(page)
    await navigateToPackage(page, 'cards')
    const url = page.url()
    await page.keyboard.press('/')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: 'Search' })).toHaveCount(0)
    expect(page.url()).toBe(url)
})

test('slash inside a text field does not open the palette', async ({ page }) => {
    await login(page)
    await navigateToPackage(page, 'cards')
    await page.getByTestId('card-composer-input').first().click()
    await page.keyboard.press('/')
    await expect(page.getByRole('dialog', { name: 'Search' })).toHaveCount(0)
})
```

Add the seeded-data-dependent cases once the seed content is known:
- an exact-title match from a later-`nav.order` package sorts above a weak earlier one
- `budget -draft` excludes the "budget draft" item
- `budget-2026` still finds the hyphenated item
- the selection survives a re-sort when a slower package resolves

Add `data-testid` attributes to the palette shell for `search-chip-<slug>` and the dialog while writing these.

- [ ] **Step 4: Run e2e**

Run: `cd tinycld && pnpm exec playwright test tests/e2e/search-palette.spec.ts`
Expected: PASS.

- [ ] **Step 5: Full gate**

```bash
cd tinycld && pnpm run packages:generate && pnpm run lint && pnpm run pkg:check
cd tinycld/core/server && go test ./fts/ -count=1
cd cards/server && go test ./... -count=1
cd mail/server && go test ./... -count=1
cd drive/server && go test ./... -count=1
cd contacts/server && go test ./... -count=1
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git -C tinycld add tests/e2e/search-palette.spec.ts core/help/search.md
git -C tinycld commit -m "test(search): cover the palette end to end"
```

---

## Notes for the implementer

**Verify early (Task 6, before building on it):** the generator emits `() => import(...)` without a `lazy()` wrapper — a pattern not used anywhere in the generated config today. Confirm Metro resolves it before Task 13 depends on it. If it does not, the fallback is a static import map in the generated config keyed by slug, which costs eager loading but is otherwise equivalent.

**Task 12's `projectByCardId`** is the one place the plan leaves a real choice: cards needs a card→project lookup inside an adapter hook, and hooks in adapters must stay side-effect free. If the store does not already carry the mapping, read the collection via `useStore('cards_cards')` in `useSearchActions` rather than adding a live query.

**Repos are separate.** `tinycld/`, `cards/`, `mail/`, `drive/` and `contacts/` each have their own git remote — commit in each, and note the cross-repo ordering in the PRs (core first: adapters do not typecheck until Task 6's manifest field exists).
