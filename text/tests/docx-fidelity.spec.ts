import { expect, type Page, test } from '@playwright/test'
import { EDITOR_REACTION_TIMEOUT, openTextDocument, TEXT_TEST_TIMEOUT } from './_menubar-helpers'

const TEST_TIMEOUT = TEXT_TEST_TIMEOUT

// Hex color the Heading 1 run carries in feature-test.docx. The translator
// reads <w:color w:val="C00000"> into a textStyle mark; TextStyle+Color
// extensions in the editor schema render this as `color: rgb(192, 0, 0)`
// on the inline <span>.
const HEADING1_RED_RGB = 'rgb(192, 0, 0)'

async function openFixture(page: Page): Promise<string> {
    return openTextDocument(page, 'fidelity')
}

// domSnapshot reads what the user actually sees — rendered HTML in the
// editor, never ProseMirror's internal node tree. The point of the
// fidelity fixes is that the Word document round-trips through the
// import pipeline AND the Y.Doc bridge AND y-prosemirror AND the
// schema's renderHTML — assertions therefore have to live at the DOM
// level, since anything earlier in the chain could be silently dropped
// before the user sees it.
type DomSnapshot = {
    headings: { tag: string; text: string }[]
    orderedLists: { start: number; firstItem: string; itemTexts: string[] }[]
    sampleDocColors: string[]
    tables: {
        width: number
        firstHeaderTexts: string[]
        // Per-cell {colspan, rowspan, text} for every row, so a test
        // can check that the merged headers ("May 2012", "September 2010")
        // actually render with colspan=2 instead of collapsing to plain
        // 1-col cells. Reads HTMLTableCellElement.colSpan, which is
        // the *rendered* value the browser uses for layout — exactly
        // what determines whether the cell visually spans columns.
        cells: { colspan: number; rowspan: number; text: string }[][]
    }[]
    editorWidth: number
}
async function domSnapshot(page: Page): Promise<DomSnapshot> {
    return page.evaluate(() => {
        const pmDom = document.querySelector<HTMLElement>('.ProseMirror')
        if (!pmDom) throw new Error('no ProseMirror DOM found')

        const headings = Array.from(
            pmDom.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')
        ).map(h => ({ tag: h.tagName, text: (h.textContent ?? '').slice(0, 80) }))

        // Only collect top-level (un-nested) ordered lists. The fixture's
        // structure puts both numbered runs at the same depth (the bullet
        // list lives between them but isn't a parent), so a list nested
        // inside another <li> is a different concept and shouldn't enter
        // the "did the outline list resume" assertion.
        const orderedLists = Array.from(pmDom.querySelectorAll<HTMLOListElement>('ol'))
            .filter(ol => !ol.parentElement?.closest('li'))
            .map(ol => {
                // `start` defaults to 1 when omitted (HTMLOListElement.start
                // exposes the effective value), so read the live property
                // — not getAttribute — to mirror what the browser renders.
                const items = Array.from(ol.querySelectorAll<HTMLLIElement>(':scope > li'))
                return {
                    start: ol.start,
                    firstItem: (items[0]?.textContent ?? '').trim().slice(0, 80),
                    itemTexts: items.map(li => (li.textContent ?? '').trim().slice(0, 80)),
                }
            })

        // For "Sample Document" find every descendant element under its
        // heading whose text contains the title and read the COMPUTED
        // color the browser uses to paint it. TextStyle+Color renders as
        // a <span style="color: …">; if no inline span exists, falling
        // back to the heading's own computed color still gives us the
        // user-visible result.
        const sampleDocColors: string[] = []
        for (const h of Array.from(pmDom.querySelectorAll<HTMLElement>('h1, h2'))) {
            if (!(h.textContent ?? '').includes('Sample Document')) continue
            const spans = Array.from(h.querySelectorAll<HTMLElement>('*')).filter(n =>
                (n.textContent ?? '').includes('Sample Document')
            )
            const sources = spans.length > 0 ? spans : [h]
            for (const node of sources) {
                sampleDocColors.push(window.getComputedStyle(node).color)
            }
            break
        }

        // Table rendered widths: TipTap's TableView writes inline
        // `style="width: Npx"` from the summed colwidth attributes,
        // and the import preserves the .docx column widths. Reading
        // the rendered offsetWidth captures exactly what the user
        // sees (regardless of how those widths got there).
        const tables = Array.from(pmDom.querySelectorAll<HTMLTableElement>('table')).map(t => {
            const headerRow = t.querySelector('tr')
            const headerTexts = headerRow
                ? Array.from(headerRow.querySelectorAll<HTMLElement>('td, th')).map(c =>
                      (c.textContent ?? '').trim().slice(0, 40)
                  )
                : []
            const cells = Array.from(t.querySelectorAll<HTMLTableRowElement>('tr')).map(row =>
                Array.from(row.querySelectorAll<HTMLTableCellElement>('td, th')).map(c => ({
                    colspan: c.colSpan,
                    rowspan: c.rowSpan,
                    text: (c.textContent ?? '').trim().slice(0, 40),
                }))
            )
            return { width: t.offsetWidth, firstHeaderTexts: headerTexts, cells }
        })

        const editorWidth = pmDom.offsetWidth

        return { headings, orderedLists, sampleDocColors, tables, editorWidth }
    })
}

test.describe('Text — .docx fidelity', () => {
    test.setTimeout(TEST_TIMEOUT)

    test('heading levels render with the correct tag', async ({ page }) => {
        // Regression: prior to the yjs-bridge normalizeAttrValue fix,
        // every heading rendered as <h1> because the float64 `level`
        // value from JSON-decoded attrs was silently dropped by
        // y-crdt's TypeMapSet (which only accepts int, not float64),
        // so PM applied the schema default and y-prosemirror rendered
        // every heading at level 1.
        await openFixture(page)
        const { headings } = await domSnapshot(page)

        const byText = new Map(headings.map(h => [h.text.trim(), h.tag]))
        expect(byText.get('Sample Document'), 'Sample Document should render as H1').toBe('H1')
        expect(byText.get('Headings')).toBe('H2')
        expect(byText.get('Lists')).toBe('H2')
        expect(byText.get('Links')).toBe('H2')
        expect(byText.get('Images')).toBe('H2')
        expect(byText.get('Tables')).toBe('H2')
        expect(byText.get('Simple Tables')).toBe('H3')
        expect(byText.get('Complex Tables')).toBe('H3')
        expect(byText.get('Columns')).toBe('H2')

        // Lock the per-tag counts to catch silent collapses of the
        // hierarchy (e.g. every heading becoming an H1 again).
        await expect(page.locator('.ProseMirror h1')).toHaveCount(1)
        await expect(page.locator('.ProseMirror h2')).toHaveCount(6)
        await expect(page.locator('.ProseMirror h3')).toHaveCount(2)
    })

    test('outline list nests the interrupting bullets under item 5 (single ol 1–6)', async ({
        page,
    }) => {
        // The fixture's outline is decimal 1–5 (Headings…Tables), then a
        // nested bulleted list (Simple/Complex Tables) that Word emits as
        // a separate list-paragraph stream, then a final numbered item
        // (Columns). The importer's renestInterruptingBulletSubLists pass
        // (server/translate/docx_to_pm.go) merges this into ONE ordered
        // list of six items with the bullets nested inside item 5's
        // <li> — matching the user's mental model of one outline with
        // sub-bullets. The numbering then flows naturally (1–6) with no
        // `start`-attribute resumption.
        await openFixture(page)
        const { orderedLists } = await domSnapshot(page)

        // Exactly one top-level ordered list — the bullets are nested,
        // not a sibling, and the second numbered half was merged in.
        expect(orderedLists, 'expected a single merged top-level <ol> (1–6)').toHaveLength(1)

        const outline = orderedLists[0]
        expect(outline.start, 'merged list starts at 1 (no resumption)').toBe(1)
        expect(outline.firstItem.startsWith('Headings')).toBe(true)
        expect(outline.itemTexts, 'six items, Headings…Columns').toHaveLength(6)
        expect(outline.itemTexts[5].startsWith('Columns')).toBe(true)

        // The interrupting bullet list is nested inside the outline's
        // "Tables" item (#5), not at top level. Find the <ul> whose
        // closest ancestor <li> contains "Tables".
        const nestedBullets = page.locator('.ProseMirror li', { hasText: 'Tables' }).locator('ul')
        await expect(nestedBullets.first()).toBeVisible()
        await expect(
            nestedBullets.locator('li', { hasText: 'Simple Tables' }).first()
        ).toBeVisible()

        // No top-level <ol> carries a `start` attribute — numbering is
        // continuous, not resumed.
        const topLevelOls = page.locator('.ProseMirror > ol, .ProseMirror ol:not(li ol)')
        const count = await topLevelOls.count()
        for (let i = 0; i < count; i++) {
            await expect(topLevelOls.nth(i)).not.toHaveAttribute('start', /.*/)
        }
    })

    test('tables keep their .docx column widths instead of stretching to 100%', async ({
        page,
    }) => {
        // The fixture's simple table totals ~3.93 in worth of columns
        // (1617 + 1270 + 884 dxa, where 1 in = 1440 dxa). The complex
        // table totals ~6.57 in — practically the full width of a US
        // Letter page's usable area, so it should fill most of the
        // page-width-capped editor. Both widths come from the docx
        // pipeline (parser writes per-cell colwidth attrs, TipTap's
        // TableView sets table.style.width to the summed colwidths).
        await openFixture(page)
        const { tables, editorWidth } = await domSnapshot(page)

        expect(tables.length, 'expected both fixture tables to render').toBeGreaterThanOrEqual(2)
        const simple = tables.find(t => t.firstHeaderTexts.includes('Screen Reader'))
        expect(simple, 'expected the "Screen Reader" simple table').toBeTruthy()
        // 3771 dxa ≈ 251 px at our 1-dxa-per-15-px conversion. Allow
        // a small TableView/cell-padding fudge factor on either side.
        expect(simple?.width).toBeGreaterThan(220)
        expect(simple?.width).toBeLessThan(320)
        // The simple table is genuinely narrow in Word — it should NOT
        // stretch to fill the page-width editor.
        expect(simple?.width, 'simple table should be narrower than the editor').toBeLessThan(
            editorWidth * 0.6
        )

        const complex = tables.find(t => t.firstHeaderTexts.includes('May 2012'))
        expect(complex, 'expected the merged-header complex table').toBeTruthy()
        // 9461 dxa ≈ 631 px. Same fudge factor.
        expect(complex?.width).toBeGreaterThan(580)
        expect(complex?.width).toBeLessThan(700)
        // The complex table fills nearly the whole Word page; with the
        // editor capped to ~page width, it should also fill most of the
        // editor pane (the visual cue a Word user expects to see).
        expect(complex?.width, 'complex table should fill ≥85% of the editor').toBeGreaterThan(
            editorWidth * 0.85
        )
    })

    test('content area is capped at roughly a Word page width', async ({ page }) => {
        // We mirror Word's "Web Layout" feel by capping the editor's
        // content area at ~US Letter's usable width (8.5in - 2*1in
        // margins = 6.5in ≈ 624px at 96dpi, plus a small fudge factor).
        // Without this, a wide browser pane would render every imported
        // table tiny relative to surrounding whitespace.
        await openFixture(page)
        const { editorWidth } = await domSnapshot(page)
        // Allow 600–760 px (covers 624 page width + breathing room and
        // any wrapper padding). A failure here means the page-width cap
        // got removed or overridden by a parent rule.
        expect(editorWidth).toBeGreaterThan(600)
        expect(editorWidth).toBeLessThan(760)
    })

    test('merged-header cells render with colspan=2', async ({ page }) => {
        // The fixture's "Complex Tables" table has two header cells that
        // each span two physical columns in Word (<w:gridSpan w:val="2">):
        //   row 0: ['', 'May 2012' (gridSpan=2), 'September 2010' (gridSpan=2)]
        //   row 1: ['Screen Reader', 'Responses', 'Share', 'Responses', 'Share']
        //
        // The visual cue a Word user expects is "May 2012" and "September 2010"
        // stretching across both of the data columns they govern. If colspan
        // doesn't survive the import → Y.Doc → y-tiptap → ProseMirror schema
        // round-trip, those headers split into individual single-column
        // cells and the table reads like every header label has been
        // duplicated. That's the bug this test guards against.
        await openFixture(page)
        const { tables } = await domSnapshot(page)
        const complex = tables.find(t => t.firstHeaderTexts.includes('May 2012'))
        expect(complex, 'expected the merged-header complex table').toBeTruthy()
        const row0 = complex?.cells[0] ?? []
        const may = row0.find(c => c.text === 'May 2012')
        const sept = row0.find(c => c.text.includes('September 2010'))
        expect(may, 'expected a "May 2012" cell in row 0').toBeTruthy()
        expect(sept, 'expected a "September 2010" cell in row 0').toBeTruthy()
        expect(may?.colspan, 'May 2012 header should span 2 columns').toBe(2)
        expect(sept?.colspan, 'September 2010 header should span 2 columns').toBe(2)
        // Row 1 should have 5 single-column cells — the unmerged header
        // row. Catches a regression where colspan leaks onto row 1 too.
        const row1 = complex?.cells[1] ?? []
        expect(row1.length, 'row 1 should have 5 cells').toBe(5)
        for (const c of row1) {
            expect(c.colspan, `row 1 cell "${c.text}" should be colspan=1`).toBe(1)
        }
    })

    test('Heading 1 renders with the .docx red color', async ({ page }) => {
        // The fixture's H1 run has <w:color w:val="C00000">. After
        // import the heading text should be painted #C00000 — whether
        // that color lands on an inline <span> from TextStyle+Color or
        // directly on the <h1> doesn't matter to the user, only the
        // computed color does.
        await openFixture(page)
        const { sampleDocColors } = await domSnapshot(page)
        expect(sampleDocColors.length, 'expected a colored Sample Document run').toBeGreaterThan(0)
        for (const c of sampleDocColors) {
            expect(c, 'Sample Document should paint as imported red').toBe(HEADING1_RED_RGB)
        }
    })

    test('left-wrapped image floats with text flowing to its right', async ({ page }) => {
        // Regression: when the resize NodeView landed, it wrapped the
        // <img> in two non-floating spans. The float-left CSS was still
        // on the inner <img>, but floats only push siblings of their
        // direct parent — so text dropped *below* the image instead of
        // wrapping. This test guards two invariants:
        //   1. The floated wrapper's box matches the rendered <img>'s
        //      box (no skew / no oversized outline).
        //   2. At least one text-run in the paragraph that contains the
        //      image sits to the right of it (i.e. text actually wraps).
        // Both invariants together fail under the regression even when
        // the underlying width/height attrs are correct.
        await openFixture(page)
        const layout = await page.evaluate(() => {
            const pmDom = document.querySelector<HTMLElement>('.ProseMirror')
            if (!pmDom) throw new Error('no ProseMirror DOM')
            const wrapper = pmDom.querySelector<HTMLElement>(
                '[data-node-view-wrapper][data-wrap="left"]'
            )
            if (!wrapper) return { found: false as const }
            const img = wrapper.querySelector<HTMLImageElement>('img')
            if (!img) throw new Error('wrapped image has no <img>')
            const wRect = wrapper.getBoundingClientRect()
            const iRect = img.getBoundingClientRect()
            const para = wrapper.closest('p')
            // Find a non-empty text node in the same paragraph and read
            // its first client rect. If text wrapping works, that rect's
            // left edge sits to the right of the image's right edge.
            let firstTextRectLeft: number | null = null
            if (para) {
                const walker = document.createTreeWalker(para, NodeFilter.SHOW_TEXT, null)
                let node = walker.nextNode()
                while (node) {
                    const text = (node.nodeValue ?? '').trim()
                    if (text.length > 0) {
                        const range = document.createRange()
                        range.selectNodeContents(node)
                        const r = range.getClientRects()[0]
                        if (r) {
                            firstTextRectLeft = r.left
                            break
                        }
                    }
                    node = walker.nextNode()
                }
            }
            return {
                found: true as const,
                wrapper: { width: wRect.width, height: wRect.height, right: wRect.right },
                img: { width: iRect.width, height: iRect.height, right: iRect.right },
                firstTextRectLeft,
            }
        })

        expect(layout.found, 'fixture should contain at least one left-wrapped image').toBe(true)
        if (!layout.found) return
        // The wrapper's box must match the rendered <img>'s box within a
        // sub-pixel rounding tolerance. Under the regression the wrapper
        // is sized to the committed attrs while the img is clamped by
        // a CSS max-width — width/height diverge by tens of pixels.
        expect(
            Math.abs(layout.wrapper.width - layout.img.width),
            'wrapper width should match img width (no max-width skew)'
        ).toBeLessThanOrEqual(1)
        expect(
            Math.abs(layout.wrapper.height - layout.img.height),
            'wrapper height should match img height (aspect ratio preserved)'
        ).toBeLessThanOrEqual(1)
        // Text wrap: a text run in the same paragraph must sit to the
        // right of the floated image. Under the regression the float
        // does not push the run, so its left edge would be at or near
        // the paragraph's left edge.
        expect(
            layout.firstTextRectLeft,
            'expected to find a text run in the image paragraph'
        ).not.toBeNull()
        if (layout.firstTextRectLeft !== null) {
            expect(
                layout.firstTextRectLeft,
                'text should flow to the right of the floated image'
            ).toBeGreaterThan(layout.img.right - 1)
        }
    })

    test('flipping the fixture image to wrap=right pushes text to its left', async ({ page }) => {
        // The fixture ships with wrap=left images; we re-use one by
        // flipping it via the wrap toolbar to verify the right-side
        // float renders correctly without needing a new docx fixture.
        // The fixture's `wrap` attr round-trips through Yjs the same
        // way a user click would, so this also incidentally exercises
        // the schema update path.
        await openFixture(page)
        // Anchor the wrapper as "the first node-view wrapper that contains
        // an <img>", NOT as `[data-wrap="left"]`. The fixture has two
        // left-floated images; a `[data-wrap="left"]` locator would
        // re-resolve to the *other* (still-left) image the instant we flip
        // this one, so the data-wrap assertion could never pass. This
        // wrapper locator stays pinned to the same node across the change.
        const wrapper = page
            .locator('.ProseMirror [data-node-view-wrapper]')
            .filter({ has: page.locator('img') })
            .first()
        await expect(wrapper).toBeVisible({ timeout: 30_000 })
        await expect(wrapper).toHaveAttribute('data-wrap', 'left')

        // Click the image inside the wrapper to surface the toolbar.
        await wrapper.locator('img').click()
        const toolbar = page.locator('.ProseMirror [data-image-wrap-toolbar]').first()
        await expect(toolbar).toBeVisible({ timeout: EDITOR_REACTION_TIMEOUT })
        await toolbar.locator('[data-image-wrap-mode="right"]').click()
        await expect(wrapper).toHaveAttribute('data-wrap', 'right', {
            timeout: EDITOR_REACTION_TIMEOUT,
        })

        const layout = await page.evaluate(() => {
            const w = document.querySelector<HTMLElement>(
                '.ProseMirror [data-node-view-wrapper][data-wrap="right"]'
            )
            if (!w) return { found: false as const }
            const img = w.querySelector<HTMLImageElement>('img')
            if (!img) throw new Error('wrapper has no img')
            const para = w.closest('p')
            const iRect = img.getBoundingClientRect()
            let firstTextRectLeft: number | null = null
            if (para) {
                const walker = document.createTreeWalker(para, NodeFilter.SHOW_TEXT, null)
                let node = walker.nextNode()
                while (node) {
                    const text = (node.nodeValue ?? '').trim()
                    if (text.length > 0) {
                        const range = document.createRange()
                        range.selectNodeContents(node)
                        const r = range.getClientRects()[0]
                        if (r) {
                            firstTextRectLeft = r.left
                            break
                        }
                    }
                    node = walker.nextNode()
                }
            }
            return { found: true as const, img: { left: iRect.left }, firstTextRectLeft }
        })

        expect(layout.found, 'wrapper should have flipped to data-wrap=right').toBe(true)
        if (!layout.found) return
        expect(
            layout.firstTextRectLeft,
            'expected a text run in the image paragraph'
        ).not.toBeNull()
        if (layout.firstTextRectLeft !== null) {
            // Under wrap=right the image sits at the paragraph's right
            // edge and text starts at the left. A run from that
            // paragraph should have its left rect at or near the
            // paragraph's left margin — well to the LEFT of the image.
            expect(
                layout.firstTextRectLeft,
                'text should flow to the left of the right-floated image'
            ).toBeLessThan(layout.img.left + 1)
        }
    })

    test('flipping the fixture image to wrap=break clears text to top + bottom', async ({
        page,
    }) => {
        // Word's "Top and Bottom" wrap: text never sits beside the
        // image — it only flows above and below. The wrapper renders
        // display:block + clear:both, which means every other text run
        // in the same paragraph (if any survives the layout) must be
        // either fully above or fully below the image's bounding box.
        await openFixture(page)
        // Anchor on the first wrapper that contains an <img>, not on
        // `[data-wrap="left"]` — see the wrap=right test for why a
        // data-wrap-bound locator can't survive its own attribute flip
        // when the fixture has more than one left-floated image.
        const wrapper = page
            .locator('.ProseMirror [data-node-view-wrapper]')
            .filter({ has: page.locator('img') })
            .first()
        await expect(wrapper).toBeVisible({ timeout: 30_000 })
        await expect(wrapper).toHaveAttribute('data-wrap', 'left')
        await wrapper.locator('img').click()
        const toolbar = page.locator('.ProseMirror [data-image-wrap-toolbar]').first()
        await expect(toolbar).toBeVisible({ timeout: EDITOR_REACTION_TIMEOUT })
        await toolbar.locator('[data-image-wrap-mode="break"]').click()
        await expect(wrapper).toHaveAttribute('data-wrap', 'break', {
            timeout: EDITOR_REACTION_TIMEOUT,
        })

        const layout = await page.evaluate(() => {
            const w = document.querySelector<HTMLElement>(
                '.ProseMirror [data-node-view-wrapper][data-wrap="break"]'
            )
            if (!w) return { found: false as const }
            const img = w.querySelector<HTMLImageElement>('img')
            if (!img) throw new Error('wrapper has no img')
            const iRect = img.getBoundingClientRect()
            // Walk every text node in the document and collect its
            // client rects. For each rect, classify it as "above"
            // (bottom <= img.top) or "below" (top >= img.bottom). Any
            // rect that overlaps the image's vertical band is a wrap
            // violation — under break mode no text should ride beside
            // the image.
            const overlaps: { left: number; top: number; right: number; bottom: number }[] = []
            const para = w.closest('p')
            if (para) {
                const walker = document.createTreeWalker(para, NodeFilter.SHOW_TEXT, null)
                let node = walker.nextNode()
                while (node) {
                    const text = (node.nodeValue ?? '').trim()
                    if (text.length > 0) {
                        const range = document.createRange()
                        range.selectNodeContents(node)
                        for (const r of Array.from(range.getClientRects())) {
                            if (r.width === 0 || r.height === 0) continue
                            const liesAbove = r.bottom <= iRect.top + 1
                            const liesBelow = r.top >= iRect.bottom - 1
                            if (!liesAbove && !liesBelow) {
                                overlaps.push({
                                    left: r.left,
                                    top: r.top,
                                    right: r.right,
                                    bottom: r.bottom,
                                })
                            }
                        }
                    }
                    node = walker.nextNode()
                }
            }
            return {
                found: true as const,
                img: { top: iRect.top, bottom: iRect.bottom },
                overlaps,
            }
        })

        expect(layout.found, 'wrapper should have flipped to data-wrap=break').toBe(true)
        if (!layout.found) return
        expect(
            layout.overlaps,
            `expected no text rects beside the break-mode image (got ${layout.overlaps.length}: ${JSON.stringify(layout.overlaps)})`
        ).toHaveLength(0)
    })
})
