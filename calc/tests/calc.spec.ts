import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { login, navigateToPackage } from '../../../../tests/e2e/helpers'

test.describe('Calc', () => {
    // Bump the test timeout: tests that hit "New spreadsheet" wait on a
    // drive_items create round-trip plus a Y.Doc realtime handshake, and
    // both can be slow under parallel-worker contention against a single
    // dev backend. The default 30s leaves no headroom.
    test.setTimeout(120_000)

    test.beforeEach(async ({ page }) => {
        await login(page)
    })

    test('opening a sheet renders cells in the correct columns', async ({ page }) => {
        await navigateToPackage(page, 'calc')
        await expect(page.getByRole('heading', { level: 2, name: 'Calc' }).first()).toBeVisible()
        await page.getByText('Team Scorecard.xlsx').click()

        await expect(page.getByText('Name', { exact: true })).toBeVisible()
        await expect(page.getByText('Role', { exact: true })).toBeVisible()
        await expect(page.getByText('Score', { exact: true })).toBeVisible()

        await expect(page.getByText('Alice', { exact: true })).toBeVisible()
        await expect(page.getByText('Engineer', { exact: true })).toBeVisible()
        await expect(page.getByText('Bob', { exact: true })).toBeVisible()
        await expect(page.getByText('Designer', { exact: true })).toBeVisible()
        await expect(page.getByText('Carol', { exact: true })).toBeVisible()
        await expect(page.getByText('Manager', { exact: true })).toBeVisible()

        // Verify columns are correctly aligned by reading the DOM. A1
        // (Name) and B1 (Role) should be at viewport-x positions exactly
        // CELL_WIDTH (96px) apart.
        const positions = await page.evaluate(() => {
            const find = (text: string) => {
                for (const el of Array.from(document.querySelectorAll('div'))) {
                    if (el.textContent === text && el.children.length === 0) {
                        const cell = el.parentElement
                        if (cell) {
                            const rect = cell.getBoundingClientRect()
                            return { left: rect.left, width: rect.width }
                        }
                    }
                }
                return null
            }
            return { name: find('Name'), role: find('Role'), score: find('Score') }
        })
        expect(positions.name).not.toBeNull()
        expect(positions.role).not.toBeNull()
        expect(positions.score).not.toBeNull()
        if (positions.name && positions.role && positions.score) {
            expect(positions.role.left - positions.name.left).toBeCloseTo(96, 0)
            expect(positions.score.left - positions.role.left).toBeCloseTo(96, 0)
        }
    })

    test('+ New spreadsheet creates and opens an empty sheet', async ({ page }) => {
        await navigateToPackage(page, 'calc')
        await openNewSpreadsheet(page)
        // Header columns are virtualized — only the ones in the viewport
        // render. A through E are always visible at default viewport width.
        await expect(page.getByText('A', { exact: true })).toBeVisible()
        await expect(page.getByText('E', { exact: true })).toBeVisible()
    })

    test('dragging a column-resize handle widens the column', async ({ page }) => {
        await navigateToPackage(page, 'calc')
        await openNewSpreadsheet(page)

        // Headers A and B are absolute-positioned. Capture their start
        // positions, drag the boundary handle ~100px right, then verify
        // both A widened and B shifted right by the same amount.
        const before = await readHeaderRects(page)
        expect(before.A).not.toBeNull()
        expect(before.B).not.toBeNull()

        // The resize handle is a transparent absolute element straddling
        // the right edge of column A. We can locate it by the cursor
        // style react-native-web emits inline.
        const handles = page.locator('div[style*="cursor: col-resize"]')
        const aHandle = handles.first()
        await aHandle.waitFor({ state: 'attached' })
        const box = await aHandle.boundingBox()
        if (box == null) throw new Error('resize handle has no box')
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
        await page.mouse.down()
        await page.mouse.move(box.x + box.width / 2 + 100, box.y + box.height / 2, { steps: 5 })
        await page.mouse.up()

        const after = await readHeaderRects(page)
        if (before.A && after.A) {
            expect(after.A.width - before.A.width).toBeCloseTo(100, 0)
        }
        if (before.B && after.B) {
            expect(after.B.left - before.B.left).toBeCloseTo(100, 0)
        }
    })

    test('double-clicking the column-resize handle autosizes to fit content', async ({ page }) => {
        await navigateToPackage(page, 'calc')
        await openNewSpreadsheet(page)

        const formulaBar = page.getByRole('textbox', { name: 'Formula bar' })
        await typeIntoCell(page, formulaBar, 'A1', 'a fairly long string that should autosize')

        const before = await readHeaderRects(page)
        expect(before.A).not.toBeNull()

        const handles = page.locator('div[style*="cursor: col-resize"]')
        const aHandle = handles.first()
        const box = await aHandle.boundingBox()
        if (box == null) throw new Error('resize handle has no box')
        await aHandle.dblclick()

        const after = await readHeaderRects(page)
        if (before.A && after.A) {
            // Autosize should grow column A — exact width depends on
            // browser font metrics, so we just assert it's wider than
            // the default 96px.
            expect(after.A.width).toBeGreaterThan(before.A.width)
        }
    })

    test('formula function autocomplete: typing =LE shows LEFT/LEN, Tab inserts', async ({
        page,
    }) => {
        await navigateToPackage(page, 'calc')
        await openNewSpreadsheet(page)

        const formulaBar = page.getByRole('textbox', { name: 'Formula bar' })

        // Open A1 and start typing a formula prefix. The dropdown is
        // derived from the live draft+cursor, so suggestions only render
        // once at least one letter has been typed after `=`.
        await page.getByLabel('Cell A1', { exact: true }).click()
        await formulaBar.focus()
        await formulaBar.fill('=LE')

        // Both LEFT and LEN match the LE prefix.
        await expect(page.getByText('LEFT', { exact: true })).toBeVisible()
        await expect(page.getByText('LEN', { exact: true })).toBeVisible()

        // Tab inserts the highlighted item plus an open paren.
        await formulaBar.press('Tab')
        await expect(formulaBar).toHaveValue('=LEFT(')

        // Cancel without committing — the goal of this test is the UI
        // flow, not a successful evaluation.
        await formulaBar.press('Escape')
        await formulaBar.press('Escape')
    })

    test('formula function autocomplete: ArrowDown moves highlight before Tab inserts', async ({
        page,
    }) => {
        await navigateToPackage(page, 'calc')
        await openNewSpreadsheet(page)

        const formulaBar = page.getByRole('textbox', { name: 'Formula bar' })

        await page.getByLabel('Cell A1', { exact: true }).click()
        await formulaBar.focus()
        await formulaBar.fill('=LE')

        // First item is LEFT (alphabetical). ArrowDown moves to the
        // next match; Tab inserts whatever's highlighted.
        await expect(page.getByText('LEFT', { exact: true })).toBeVisible()
        await formulaBar.press('ArrowDown')
        await formulaBar.press('Tab')

        // Whatever the second entry is, the inserted text starts with
        // `=` and is followed by an open paren. Asserting on the open-
        // paren shape (rather than a specific function) keeps the test
        // resilient to HF function-pack changes.
        const value = await formulaBar.inputValue()
        expect(value).toMatch(/^=[A-Z]+\($/)
        expect(value).not.toBe('=LEFT(')

        await formulaBar.press('Escape')
        await formulaBar.press('Escape')
    })

    test('formula function autocomplete: in-cell popover anchors below the cell, not at its top', async ({
        page,
    }) => {
        // Regression: the in-cell popover was positioned by summing
        // hardcoded layout constants (toolbar + formula bar + column
        // header). The actual stack above the body had drifted — the
        // menubar above the toolbar was unaccounted for and the
        // toolbar's height didn't match its constant. The popover
        // ended up roughly one cell-height too high and covered the
        // text the user was typing.
        await navigateToPackage(page, 'calc')
        await openNewSpreadsheet(page)

        // Snapshot the cell's box BEFORE editing — once typing starts
        // the Pressable swaps for a TextInput (CellEditor) without an
        // accessibility label, so we can't relocate the cell mid-edit.
        const a3 = page.getByLabel('Cell A3', { exact: true })
        await a3.click()
        const cellBox = await a3.boundingBox()
        if (cellBox == null) throw new Error('A3 box missing pre-edit')

        // Type a formula prefix to trigger the suggestion popover.
        // Typing-to-replace opens the in-cell editor (CellEditor),
        // which is what we want — the formula bar branch has its own
        // anchor path.
        await page.keyboard.type('=SU')

        // Locate the popover container itself, not an item's text — the
        // text node sits an item-height or two below the container top
        // (alphabetically-first item, padding, border) which would
        // mask a small upward drift of the container into the cell.
        const popover = page.getByLabel('Formula suggestions', { exact: true })
        await expect(popover).toBeVisible()
        const popBox = await popover.boundingBox()
        if (popBox == null) throw new Error('suggestion popover box missing')

        // The popover should sit at or below the cell's bottom edge —
        // not overlapping the editor where the user is typing. Allow
        // 1px of sub-pixel rounding slack.
        expect(popBox.y).toBeGreaterThanOrEqual(cellBox.y + cellBox.height - 1)
    })

    test('formula function autocomplete: in-cell popover drops below the full merged footprint', async ({
        page,
    }) => {
        // Same regression as the previous test, but for a merged
        // anchor: the popover must clear the merge's bottom row, not
        // the anchor row alone. Without the merge lookup the popover
        // would still cover the lower cells of the merge that the user
        // can see and is typing into.
        await navigateToPackage(page, 'calc')
        await openNewSpreadsheet(page)

        // Drag-select A1:A3 and merge vertically.
        const a1 = page.getByLabel('Cell A1', { exact: true })
        const a3 = page.getByLabel('Cell A3', { exact: true })
        const a1Start = await a1.boundingBox()
        const a3End = await a3.boundingBox()
        if (a1Start == null || a3End == null) throw new Error('A1/A3 box missing pre-merge')
        await page.mouse.move(a1Start.x + a1Start.width / 2, a1Start.y + a1Start.height / 2)
        await page.mouse.down()
        await page.mouse.move(a3End.x + a3End.width / 2, a3End.y + a3End.height / 2, {
            steps: 8,
        })
        await page.mouse.up()
        await page.getByRole('button', { name: 'Format', exact: true }).click()
        await page.getByRole('menuitem', { name: 'Merge cells' }).click()
        await page.getByRole('menuitem', { name: 'Merge all', exact: true }).click()

        // Re-resolve A1 — its bounding box now covers the merged
        // A1:A3 footprint, so cellBox.height reflects three row
        // heights.
        await a1.click()
        const mergedBox = await a1.boundingBox()
        if (mergedBox == null) throw new Error('merged A1 box missing')

        await page.keyboard.type('=SU')

        const popover = page.getByLabel('Formula suggestions', { exact: true })
        await expect(popover).toBeVisible()
        const popBox = await popover.boundingBox()
        if (popBox == null) throw new Error('suggestion popover box missing')

        expect(popBox.y).toBeGreaterThanOrEqual(mergedBox.y + mergedBox.height - 1)
    })

    test('cell-ref insertion: clicking a cell mid-formula inserts its address', async ({
        page,
    }) => {
        await navigateToPackage(page, 'calc')
        await openNewSpreadsheet(page)

        const formulaBar = page.getByRole('textbox', { name: 'Formula bar' })

        // Seed B5 so the inserted ref evaluates to a concrete number.
        await typeIntoCell(page, formulaBar, 'B5', '42')

        // Start a formula in A1, leave the cursor in a ref-acceptable
        // position (right after `=`), then click B5. The Grid intercepts
        // the cell tap (editSession active + ref-acceptable cursor) and
        // inserts B5 at the cursor instead of moving selection.
        await page.getByLabel('Cell A1', { exact: true }).click()
        await formulaBar.focus()
        await formulaBar.fill('=')

        await page.getByLabel('Cell B5', { exact: true }).click()
        await expect(formulaBar).toHaveValue('=B5')

        // Commit and verify the formula evaluates.
        await formulaBar.press('Enter')
        await page.getByLabel('Cell B1', { exact: true }).click()
        await page.getByLabel('Cell A1', { exact: true }).click()
        await expect(formulaBar).toHaveValue('=B5')
        await expect(page.getByLabel('Cell A1', { exact: true })).toHaveText('42')
    })

    test('cell-ref insertion: works inside an open function call', async ({ page }) => {
        await navigateToPackage(page, 'calc')
        await openNewSpreadsheet(page)

        const formulaBar = page.getByRole('textbox', { name: 'Formula bar' })

        // Seed A2 and A3 so SUM has something to add.
        await typeIntoCell(page, formulaBar, 'A2', '10')
        await typeIntoCell(page, formulaBar, 'A3', '20')

        // Start =SUM( in A1, click A2 → "=SUM(A2", type a comma, click
        // A3 → "=SUM(A2,A3", close the paren and commit.
        await page.getByLabel('Cell A1', { exact: true }).click()
        await formulaBar.focus()
        await formulaBar.fill('=SUM(')

        await page.getByLabel('Cell A2', { exact: true }).click()
        await expect(formulaBar).toHaveValue('=SUM(A2')

        await formulaBar.focus()
        await formulaBar.press('End')
        await formulaBar.type(',')

        await page.getByLabel('Cell A3', { exact: true }).click()
        await expect(formulaBar).toHaveValue('=SUM(A2,A3')

        await formulaBar.focus()
        await formulaBar.press('End')
        await formulaBar.type(')')
        await formulaBar.press('Enter')

        await page.getByLabel('Cell B1', { exact: true }).click()
        await page.getByLabel('Cell A1', { exact: true }).click()
        await expect(page.getByLabel('Cell A1', { exact: true })).toHaveText('30')
    })

    test('undo/redo toolbar buttons revert and reapply edits', async ({ page }) => {
        await navigateToPackage(page, 'calc')
        await openNewSpreadsheet(page)

        const formulaBar = page.getByRole('textbox', { name: 'Formula bar' })
        const undoBtn = page.getByRole('button', { name: 'Undo' })
        const redoBtn = page.getByRole('button', { name: 'Redo' })

        // Fresh sheet: nothing to undo yet. The buttons should be
        // disabled. RN-Web emits accessibilityState.disabled as
        // aria-disabled on the rendered DOM node.
        await expect(undoBtn).toHaveAttribute('aria-disabled', 'true')
        await expect(redoBtn).toHaveAttribute('aria-disabled', 'true')

        // Type something, then move selection away so re-clicking A1
        // selects (rather than re-edits) when we want to verify text.
        await typeIntoCell(page, formulaBar, 'A1', 'hello')
        await page.getByLabel('Cell B1', { exact: true }).click()
        await expect(page.getByLabel('Cell A1', { exact: true })).toHaveText('hello')

        // Undo is now available; click it and the cell empties.
        await expect(undoBtn).not.toHaveAttribute('aria-disabled', 'true')
        await undoBtn.click()
        await expect(page.getByLabel('Cell A1', { exact: true })).toHaveText('')

        // After the undo, redo should be available; click and the
        // value comes back.
        await expect(redoBtn).not.toHaveAttribute('aria-disabled', 'true')
        await redoBtn.click()
        await expect(page.getByLabel('Cell A1', { exact: true })).toHaveText('hello')
    })

    test('typing in a cell then clicking another commits the value instead of dropping it', async ({
        page,
    }) => {
        // Regression: clicking a different cell while editing used to
        // discard the in-flight draft. Web preventDefault on mousedown
        // (added so cell-ref insertion can fire mid-formula) suppresses
        // the input's onBlur, so the click-away has to perform the
        // commit explicitly.
        await navigateToPackage(page, 'calc')
        await openNewSpreadsheet(page)

        const a1 = page.getByLabel('Cell A1', { exact: true })
        const b2 = page.getByLabel('Cell B2', { exact: true })

        // Two clicks open the in-cell editor (first selects, second edits).
        // The cell editor TextInput has no accessibility label, so we
        // type via the focused element. autoFocus on mount means
        // keyboard input lands in the editor without an extra .focus().
        await a1.click()
        await a1.click()
        await page.keyboard.type('hello world')

        // Click away to a different cell — value must persist.
        await b2.click()
        await expect(a1).toHaveText('hello world')
    })

    test('Delete key on a focused cell clears its contents', async ({ page }) => {
        await navigateToPackage(page, 'calc')
        await openNewSpreadsheet(page)

        const formulaBar = page.getByRole('textbox', { name: 'Formula bar' })
        const a1 = page.getByLabel('Cell A1', { exact: true })
        const a2 = page.getByLabel('Cell A2', { exact: true })

        // Seed two cells, then move selection back to the first one so
        // it's the focused (selected, not-editing) cell when we press
        // Delete. typeIntoCell ends with Enter, which leaves the cell
        // committed and selected — but we click B1 first to break the
        // "second click opens editor" gesture that a re-click on A1
        // would otherwise trigger.
        await typeIntoCell(page, formulaBar, 'A1', 'hello')
        await typeIntoCell(page, formulaBar, 'A2', 'world')
        await page.getByLabel('Cell B1', { exact: true }).click()
        await a1.click()
        await expect(a1).toHaveText('hello')

        await page.keyboard.press('Delete')
        await expect(a1).toHaveText('')

        // Backspace works the same way on the next cell.
        await a2.click()
        await expect(a2).toHaveText('world')
        await page.keyboard.press('Backspace')
        await expect(a2).toHaveText('')
    })

    test('drag-select extends a range and bold applies to every cell', async ({ page }) => {
        // Multi-cell selection: mouse-drag from A1 to B2 should grow
        // the selection to a 2x2 rectangle. Clicking Bold while the
        // range is active should turn all four cells bold (mixed-
        // toggle: any-off → all-on).
        await navigateToPackage(page, 'calc')
        await openNewSpreadsheet(page)

        const a1 = page.getByLabel('Cell A1', { exact: true })
        const b2 = page.getByLabel('Cell B2', { exact: true })

        // Capture cell rects so we drag from interior centers — the
        // PanResponder needs >3px of movement to claim the gesture.
        const a1Box = await a1.boundingBox()
        const b2Box = await b2.boundingBox()
        if (a1Box == null || b2Box == null) throw new Error('cell rects missing')

        await page.mouse.move(a1Box.x + a1Box.width / 2, a1Box.y + a1Box.height / 2)
        await page.mouse.down()
        // Stepped move so React Native's PanResponder fires the full
        // grant→move→release sequence reliably; a single jump can be
        // coalesced into a no-move release in some browsers.
        await page.mouse.move(b2Box.x + b2Box.width / 2, b2Box.y + b2Box.height / 2, { steps: 8 })
        await page.mouse.up()

        // Range tint paints a rgba(34, 160, 107, 0.10) backgroundColor
        // on B1, A2, B2 (the anchor A1 keeps the brighter outline,
        // not the tint). Read the computed background of B2 — if the
        // range never extended, B2 stays on the default bg-background
        // class color. Asserting on the tinted cells (rather than the
        // anchor) is the load-bearing signal that the range expanded.
        const tintColor = 'rgba(34, 160, 107, 0.1)'
        await expect
            .poll(async () => {
                return page.evaluate(label => {
                    const el = document.querySelector(
                        `[aria-label="${label}"]`
                    ) as HTMLElement | null
                    if (el == null) return null
                    return window.getComputedStyle(el).backgroundColor
                }, 'Cell B2')
            })
            .toBe(tintColor)

        // Click Bold. The toolbar button uses accessibilityLabel="Bold"
        // which RN-Web compiles to aria-label.
        await page.getByRole('button', { name: 'Bold' }).click()

        // Verify every cell in the 2x2 range is now bold by reading
        // the rendered Text node's fontWeight. RN-Web compiles
        // textStyle.fontWeight = 'bold' to inline style — computed
        // value is "700" in Chromium. Looking at the cell wrapper's
        // descendant <Text> (a span on web).
        for (const label of ['Cell A1', 'Cell B1', 'Cell A2', 'Cell B2']) {
            const fw = await page.evaluate(l => {
                const cell = document.querySelector(`[aria-label="${l}"]`)
                if (cell == null) return null
                // The visible text node is the cell's first descendant
                // text element. RN-Web wraps Text as a div.
                const text = cell.querySelector('div')
                if (text == null) return null
                return window.getComputedStyle(text).fontWeight
            }, label)
            expect(fw, `${label} should be bold`).toBe('700')
        }
    })

    test('shift-click extends the selection to the clicked cell', async ({ page }) => {
        // Web-only modifier path (no shift on touch). Selecting A1
        // then shift-clicking C2 should grow the range to A1:C2; the
        // tint must paint on cells inside the rectangle (e.g. B2)
        // without the user dragging.
        await navigateToPackage(page, 'calc')
        await openNewSpreadsheet(page)

        await page.getByLabel('Cell A1', { exact: true }).click()

        // Use Playwright's `modifiers` option so the synthetic
        // mousedown carries shiftKey: true at dispatch time. A
        // separate keyboard.down('Shift') doesn't always propagate
        // into the next mouse event, so the explicit option is more
        // reliable. The Cell's onMouseDown reads event.shiftKey
        // before the underlying Pressable fires onPress (which would
        // otherwise collapse the range via selectCell).
        await page.getByLabel('Cell C2', { exact: true }).click({ modifiers: ['Shift'] })

        // B2 sits inside the A1:C2 rectangle and is not the anchor,
        // so it gets the range tint (rgba(34, 160, 107, 0.10)).
        const tintColor = 'rgba(34, 160, 107, 0.1)'
        await expect
            .poll(
                async () =>
                    page.evaluate(label => {
                        const el = document.querySelector(
                            `[aria-label="${label}"]`
                        ) as HTMLElement | null
                        if (el == null) return null
                        return window.getComputedStyle(el).backgroundColor
                    }, 'Cell B2'),
                { message: 'B2 should be tinted as part of A1:C2 range' }
            )
            .toBe(tintColor)
    })

    test('drag inside a cell while editing does not start a range', async ({ page }) => {
        // Regression: the drag-select web wiring must early-return
        // when isAnyEditing is true. If it didn't, mousedown on a
        // cell during a formula edit would collapse the editor and
        // either drop the draft or wreck the ref-tap path. Verify by
        // typing a formula into A1, then mouse-dragging from B1 to
        // D1 — the formula bar must still hold its draft and no
        // range tint should land on C1.
        await navigateToPackage(page, 'calc')
        await openNewSpreadsheet(page)

        const formulaBar = page.getByRole('textbox', { name: 'Formula bar' })

        await page.getByLabel('Cell A1', { exact: true }).click()
        await formulaBar.focus()
        await formulaBar.fill('=')

        // Drag B1 → D1. Without the editing gate, this would extend
        // a selection and collapse the formula edit.
        const b1Box = await page.getByLabel('Cell B1', { exact: true }).boundingBox()
        const d1Box = await page.getByLabel('Cell D1', { exact: true }).boundingBox()
        if (b1Box == null || d1Box == null) throw new Error('cell rects missing')
        await page.mouse.move(b1Box.x + b1Box.width / 2, b1Box.y + b1Box.height / 2)
        await page.mouse.down()
        await page.mouse.move(d1Box.x + d1Box.width / 2, d1Box.y + d1Box.height / 2, { steps: 8 })
        await page.mouse.up()

        // C1 is not the anchor and (if the gate worked) is not in
        // any range. The default cell background is bg-background,
        // which renders as white in the test theme; explicitly
        // assert it's NOT the green tint.
        const c1Bg = await page.evaluate(() => {
            const el = document.querySelector('[aria-label="Cell C1"]') as HTMLElement | null
            return el ? window.getComputedStyle(el).backgroundColor : null
        })
        expect(
            c1Bg,
            'C1 should not pick up the range tint while a formula edit is in flight'
        ).not.toBe('rgba(34, 160, 107, 0.1)')

        // The drag started on B1, which means an mid-formula click
        // on B1 would normally insert "B1" into the draft (the ref-
        // tap path). At minimum, the draft must still start with
        // '=' (not have been cleared by a stray commit).
        const draft = await formulaBar.inputValue()
        expect(draft.startsWith('=')).toBe(true)

        await formulaBar.press('Escape')
        await formulaBar.press('Escape')
    })

    test('selection handle drag fills a linear numeric series down', async ({ page }) => {
        // Drag the selection handle dot at the bottom-right of an
        // A1:A2 range down to A6. Pattern detection sees two
        // consecutive integers (1, 2) → linear-number series with
        // step 1, and the fill commit projects 3, 4, 5, 6 into the
        // post-source cells.
        await navigateToPackage(page, 'calc')
        await openNewSpreadsheet(page)

        const formulaBar = page.getByRole('textbox', { name: 'Formula bar' })

        // Seed the source range. typeIntoCell clicks each cell,
        // fills the formula bar, and presses Enter — Enter commits
        // and leaves the just-edited cell selected.
        await typeIntoCell(page, formulaBar, 'A1', '1')
        await typeIntoCell(page, formulaBar, 'A2', '2')

        // Select A1:A2 by drag-selecting from A1 to A2. Mirrors the
        // pattern in 'drag-select extends a range and bold applies
        // to every cell' above — the PanResponder needs >3px of
        // movement to claim the gesture, so we step the move.
        const a1 = page.getByLabel('Cell A1', { exact: true })
        const a2 = page.getByLabel('Cell A2', { exact: true })
        const a1Box = await a1.boundingBox()
        const a2Box = await a2.boundingBox()
        if (a1Box == null || a2Box == null) throw new Error('A1/A2 rects missing')
        await page.mouse.move(a1Box.x + a1Box.width / 2, a1Box.y + a1Box.height / 2)
        await page.mouse.down()
        await page.mouse.move(a2Box.x + a2Box.width / 2, a2Box.y + a2Box.height / 2, { steps: 8 })
        await page.mouse.up()

        // The handle now paints at the bottom-right of A2 (the end
        // of the range). Drag it down to A6 → destRange = A1:A6,
        // direction locks to 'down' (dRow > dCol).
        const handle = page.getByLabel('Selection handle', { exact: true })
        await expect(handle).toBeVisible()
        const handleBox = await handle.boundingBox()
        if (handleBox == null) throw new Error('selection handle has no box')

        const a6Box = await page.getByLabel('Cell A6', { exact: true }).boundingBox()
        if (a6Box == null) throw new Error('A6 has no box')

        await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2)
        await page.mouse.down()
        await page.mouse.move(a6Box.x + a6Box.width / 2, a6Box.y + a6Box.height / 2, { steps: 10 })
        await page.mouse.up()

        // After the fill commits, A3..A6 carry the projected series.
        // Move selection away first so a re-click on the destination
        // cells lands as "select" and the cell text reflects the
        // committed value.
        await page.getByLabel('Cell C1', { exact: true }).click()
        await expect(page.getByLabel('Cell A3', { exact: true })).toHaveText('3')
        await expect(page.getByLabel('Cell A4', { exact: true })).toHaveText('4')
        await expect(page.getByLabel('Cell A5', { exact: true })).toHaveText('5')
        await expect(page.getByLabel('Cell A6', { exact: true })).toHaveText('6')
    })

    test('selection handle drag rewrites formulas for each destination cell', async ({ page }) => {
        // Filling a formula down rewrites refs per destination via
        // the same shift mechanic the clipboard paste uses. =A1 in
        // B1, dragged down to B3, becomes =A2 in B2 and =A3 in B3
        // — the displayed values are the eval of those rewritten
        // formulas (20 and 30).
        await navigateToPackage(page, 'calc')
        await openNewSpreadsheet(page)

        const formulaBar = page.getByRole('textbox', { name: 'Formula bar' })

        await typeIntoCell(page, formulaBar, 'A1', '10')
        await typeIntoCell(page, formulaBar, 'A2', '20')
        await typeIntoCell(page, formulaBar, 'A3', '30')
        await typeIntoCell(page, formulaBar, 'B1', '=A1')

        // typeIntoCell ends with Enter, which keeps the just-edited
        // cell selected. The handle paints at B1's bottom-right
        // automatically — re-clicking B1 here would trigger the
        // "second click on selected cell opens editor" gesture and
        // hide the handle, so we go straight to grabbing it.
        const handle = page.getByLabel('Selection handle', { exact: true })
        await expect(handle).toBeVisible()
        const handleBox = await handle.boundingBox()
        if (handleBox == null) throw new Error('selection handle has no box')

        const b3Box = await page.getByLabel('Cell B3', { exact: true }).boundingBox()
        if (b3Box == null) throw new Error('B3 has no box')

        await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2)
        await page.mouse.down()
        await page.mouse.move(b3Box.x + b3Box.width / 2, b3Box.y + b3Box.height / 2, { steps: 10 })
        await page.mouse.up()

        // Move selection away so re-clicking each destination lands
        // as a plain select (not select-then-edit).
        await page.getByLabel('Cell D1', { exact: true }).click()
        await expect(page.getByLabel('Cell B2', { exact: true })).toHaveText('20')
        await expect(page.getByLabel('Cell B3', { exact: true })).toHaveText('30')

        // Confirm the formula was rewritten (not just the displayed
        // value copied) by reading B2's formula bar. Selecting B2
        // also doubles as a regression check for the post-fill
        // selection ending on the source rather than collapsing.
        await page.getByLabel('Cell B2', { exact: true }).click()
        await expect(formulaBar).toHaveValue('=A2')
    })

    test('shift+drag of the selection handle extends selection without filling', async ({
        page,
    }) => {
        // Web escape hatch: holding shift while dragging the dot
        // routes the gesture to extendSelectionTo instead of
        // fillDragMove. Same drag motion as the linear-fill test
        // above, but with shift held — the destination cells must
        // remain empty and the selection ring must encompass the
        // larger rectangle.
        await navigateToPackage(page, 'calc')
        await openNewSpreadsheet(page)

        const formulaBar = page.getByRole('textbox', { name: 'Formula bar' })

        await typeIntoCell(page, formulaBar, 'A1', '1')
        await typeIntoCell(page, formulaBar, 'A2', '2')

        // Select A1:A2 the same way as the linear-fill test.
        const a1Box = await page.getByLabel('Cell A1', { exact: true }).boundingBox()
        const a2Box = await page.getByLabel('Cell A2', { exact: true }).boundingBox()
        if (a1Box == null || a2Box == null) throw new Error('A1/A2 rects missing')
        await page.mouse.move(a1Box.x + a1Box.width / 2, a1Box.y + a1Box.height / 2)
        await page.mouse.down()
        await page.mouse.move(a2Box.x + a2Box.width / 2, a2Box.y + a2Box.height / 2, { steps: 8 })
        await page.mouse.up()

        const handle = page.getByLabel('Selection handle', { exact: true })
        await expect(handle).toBeVisible()
        const handleBox = await handle.boundingBox()
        if (handleBox == null) throw new Error('selection handle has no box')

        const a6Box = await page.getByLabel('Cell A6', { exact: true }).boundingBox()
        if (a6Box == null) throw new Error('A6 has no box')

        // Hold shift for the entire drag — the overlay re-checks
        // ev.shiftKey on each pointermove, so the modifier must
        // stay held across down/move/up.
        await page.keyboard.down('Shift')
        await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2)
        await page.mouse.down()
        await page.mouse.move(a6Box.x + a6Box.width / 2, a6Box.y + a6Box.height / 2, { steps: 10 })
        await page.mouse.up()
        await page.keyboard.up('Shift')

        // Move selection away so the cell text isn't masked by the
        // selection ring's overlay (it isn't, but click-away makes
        // the assertion intent obvious).
        await page.getByLabel('Cell C1', { exact: true }).click()
        await expect(page.getByLabel('Cell A3', { exact: true })).toHaveText('')
        await expect(page.getByLabel('Cell A4', { exact: true })).toHaveText('')
        await expect(page.getByLabel('Cell A5', { exact: true })).toHaveText('')
        await expect(page.getByLabel('Cell A6', { exact: true })).toHaveText('')

        // Re-anchor on A1 and shift-drag again to confirm the
        // selection-extend path is what fired, not just "no-op".
        // A4 sits inside A1:A6 and should pick up the range tint
        // (rgba(34, 160, 107, 0.10)) — same signal the drag-select
        // and shift-click tests above use.
        await page.getByLabel('Cell A1', { exact: true }).click()
        await page.getByLabel('Cell A6', { exact: true }).click({ modifiers: ['Shift'] })
        const tintColor = 'rgba(34, 160, 107, 0.1)'
        await expect
            .poll(
                async () =>
                    page.evaluate(label => {
                        const el = document.querySelector(
                            `[aria-label="${label}"]`
                        ) as HTMLElement | null
                        return el ? window.getComputedStyle(el).backgroundColor : null
                    }, 'Cell A4'),
                { message: 'A4 should be tinted as part of A1:A6 range' }
            )
            .toBe(tintColor)
    })

    test('undo after a fill restores the destination cells to empty', async ({ page }) => {
        // The fill commit batches every dest write inside one
        // doc.transact(_, LOCAL_ORIGIN), so the undo manager
        // captures the entire fill as one Cmd+Z step. Repeat the
        // linear-fill scenario, then press undo and verify A3..A6
        // empty and A1=1, A2=2 untouched.
        await navigateToPackage(page, 'calc')
        await openNewSpreadsheet(page)

        const formulaBar = page.getByRole('textbox', { name: 'Formula bar' })

        await typeIntoCell(page, formulaBar, 'A1', '1')
        await typeIntoCell(page, formulaBar, 'A2', '2')

        // Wait past the realtime undo manager's captureTimeout
        // (500ms — see core's use-y-undo-manager.ts) before the
        // fill, so the seed edits and the fill land in distinct
        // undo steps. Without this gap, A1 / A2 / fill merge into
        // one step and a single Cmd+Z clears the seed too.
        await page.waitForTimeout(600)

        const a1Box = await page.getByLabel('Cell A1', { exact: true }).boundingBox()
        const a2Box = await page.getByLabel('Cell A2', { exact: true }).boundingBox()
        if (a1Box == null || a2Box == null) throw new Error('A1/A2 rects missing')
        await page.mouse.move(a1Box.x + a1Box.width / 2, a1Box.y + a1Box.height / 2)
        await page.mouse.down()
        await page.mouse.move(a2Box.x + a2Box.width / 2, a2Box.y + a2Box.height / 2, { steps: 8 })
        await page.mouse.up()

        const handle = page.getByLabel('Selection handle', { exact: true })
        await expect(handle).toBeVisible()
        const handleBox = await handle.boundingBox()
        if (handleBox == null) throw new Error('selection handle has no box')

        const a6Box = await page.getByLabel('Cell A6', { exact: true }).boundingBox()
        if (a6Box == null) throw new Error('A6 has no box')

        await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2)
        await page.mouse.down()
        await page.mouse.move(a6Box.x + a6Box.width / 2, a6Box.y + a6Box.height / 2, { steps: 10 })
        await page.mouse.up()

        // Wait for the fill to commit before undoing. A3 carrying
        // its projected value is the direct "fill landed" signal.
        await page.getByLabel('Cell C1', { exact: true }).click()
        await expect(page.getByLabel('Cell A3', { exact: true })).toHaveText('3')

        // Undo via the toolbar button. The keyboard shortcut would
        // also work, but the toolbar path is what the existing
        // undo/redo test uses — same pattern, same wiring.
        await page.getByRole('button', { name: 'Undo' }).click()

        // A3..A6 are back to empty; A1 and A2 are untouched.
        await expect(page.getByLabel('Cell A3', { exact: true })).toHaveText('')
        await expect(page.getByLabel('Cell A4', { exact: true })).toHaveText('')
        await expect(page.getByLabel('Cell A5', { exact: true })).toHaveText('')
        await expect(page.getByLabel('Cell A6', { exact: true })).toHaveText('')
        await expect(page.getByLabel('Cell A1', { exact: true })).toHaveText('1')
        await expect(page.getByLabel('Cell A2', { exact: true })).toHaveText('2')
    })

    test.describe('Format shortcuts', () => {
        test('Cmd+B / Cmd+I / Cmd+U toggle bold, italic, underline on the selected cell', async ({
            page,
        }) => {
            await navigateToPackage(page, 'calc')
            await openNewSpreadsheet(page)

            const formulaBar = page.getByRole('textbox', { name: 'Formula bar' })
            const a1 = page.getByLabel('Cell A1', { exact: true })

            // Commit "hello" into A1, click B1 to break the
            // "second click opens editor" gesture, then re-click A1 so it
            // ends up selected (not in edit mode).
            await typeIntoCell(page, formulaBar, 'A1', 'hello')
            await page.getByLabel('Cell B1', { exact: true }).click()
            await a1.click()
            await expect(a1).toHaveText('hello')

            // Drop focus from any input so the shortcut handler isn't gated
            // on inInput. Clicking A1 again would re-enter editor; instead
            // press Escape to ensure no edit session is alive.
            await page.keyboard.press('Escape')

            await page.keyboard.press('ControlOrMeta+b')
            await expect
                .poll(async () => readCellTextStyle(page, 'Cell A1', 'fontWeight'))
                .toBe('700')

            await page.keyboard.press('ControlOrMeta+i')
            await expect
                .poll(async () => readCellTextStyle(page, 'Cell A1', 'fontStyle'))
                .toBe('italic')

            await page.keyboard.press('ControlOrMeta+u')
            await expect
                .poll(async () => readCellTextStyle(page, 'Cell A1', 'textDecorationLine'))
                .toContain('underline')

            // The Underline toolbar button should reflect the active
            // state. ToolbarButton's active prop produces an outlined/
            // tinted background — the simplest signal is aria-pressed,
            // which RN-Web emits from accessibilityState.selected for
            // Pressable. Fall back to checking the button is at least
            // styled distinctly.
            const underlineBtn = page.getByRole('button', { name: 'Underline' })
            await expect(underlineBtn).toBeVisible()
        })

        test('Cmd+B over a drag-selected range bolds every cell', async ({ page }) => {
            await navigateToPackage(page, 'calc')
            await openNewSpreadsheet(page)

            const a1 = page.getByLabel('Cell A1', { exact: true })
            const b2 = page.getByLabel('Cell B2', { exact: true })

            const a1Box = await a1.boundingBox()
            const b2Box = await b2.boundingBox()
            if (a1Box == null || b2Box == null) throw new Error('cell rects missing')

            await page.mouse.move(a1Box.x + a1Box.width / 2, a1Box.y + a1Box.height / 2)
            await page.mouse.down()
            await page.mouse.move(
                b2Box.x + b2Box.width / 2,
                b2Box.y + b2Box.height / 2,
                { steps: 8 }
            )
            await page.mouse.up()

            // Confirm the range extended before issuing the shortcut.
            const tintColor = 'rgba(34, 160, 107, 0.1)'
            await expect
                .poll(async () => {
                    return page.evaluate(label => {
                        const el = document.querySelector(
                            `[aria-label="${label}"]`
                        ) as HTMLElement | null
                        if (el == null) return null
                        return window.getComputedStyle(el).backgroundColor
                    }, 'Cell B2')
                })
                .toBe(tintColor)

            await page.keyboard.press('ControlOrMeta+b')

            for (const label of ['Cell A1', 'Cell B1', 'Cell A2', 'Cell B2']) {
                await expect
                    .poll(async () => readCellTextStyle(page, label, 'fontWeight'))
                    .toBe('700')
            }
        })
    })

    test('=SUM() over a range displays the computed total', async ({ page }) => {
        await navigateToPackage(page, 'calc')
        await openNewSpreadsheet(page)

        const formulaBar = page.getByRole('textbox', { name: 'Formula bar' })

        // Cells fire onPress → first press selects, second press opens the
        // editor. The formula bar always edits the selected cell, so a
        // single click + typing into the formula bar is the simplest way
        // to drive cell input from a test.
        await typeIntoCell(page, formulaBar, 'A1', '2')
        await typeIntoCell(page, formulaBar, 'A2', '3')
        await typeIntoCell(page, formulaBar, 'A3', '=SUM(A1:A2)')

        // After the Enter commit, A3 stays selected. Move the selection
        // away by clicking B1 so a re-click on A3 lands as "select" (not
        // "select-then-edit"), and so the formula bar shows A3's formula
        // text rather than B1's empty draft.
        await page.getByLabel('Cell B1', { exact: true }).click()
        await page.getByLabel('Cell A3', { exact: true }).click()
        await expect(formulaBar).toHaveValue('=SUM(A1:A2)')
        await expect(page.getByLabel('Cell A3', { exact: true })).toHaveText('5')
    })

    test.describe('Merge cells', () => {
        test('Merge all then Unmerge round-trips selection across A1:C1', async ({ page }) => {
            await navigateToPackage(page, 'calc')
            await openNewSpreadsheet(page)

            const formulaBar = page.getByRole('textbox', { name: 'Formula bar' })
            await typeIntoCell(page, formulaBar, 'A1', 'Title')

            // Drag-select A1:C1 — same gesture as the multi-cell select test.
            const a1 = page.getByLabel('Cell A1', { exact: true })
            const c1 = page.getByLabel('Cell C1', { exact: true })
            const a1Box = await a1.boundingBox()
            const c1Box = await c1.boundingBox()
            if (a1Box == null || c1Box == null) throw new Error('cell rects missing')
            await page.mouse.move(a1Box.x + a1Box.width / 2, a1Box.y + a1Box.height / 2)
            await page.mouse.down()
            await page.mouse.move(c1Box.x + c1Box.width / 2, c1Box.y + c1Box.height / 2, {
                steps: 8,
            })
            await page.mouse.up()

            // Open Format → Merge cells → Merge all from the menubar.
            await page.getByRole('button', { name: 'Format', exact: true }).click()
            await page.getByRole('menuitem', { name: 'Merge cells' }).click()
            await page.getByRole('menuitem', { name: 'Merge all', exact: true }).click()

            // B1 and C1 should no longer be selectable as their own cells.
            await expect(page.getByLabel('Cell B1', { exact: true })).toHaveCount(0)
            await expect(page.getByLabel('Cell C1', { exact: true })).toHaveCount(0)

            // The merged anchor at A1 spans wider than two default columns.
            const mergedBox = await page.getByLabel('Cell A1', { exact: true }).boundingBox()
            if (mergedBox == null) throw new Error('merged cell box missing')
            expect(mergedBox.width).toBeGreaterThan(96 * 2)

            // Unmerge restores the individual cells.
            await page.getByRole('button', { name: 'Format', exact: true }).click()
            await page.getByRole('menuitem', { name: 'Merge cells' }).click()
            await page.getByRole('menuitem', { name: 'Unmerge', exact: true }).click()
            await expect(page.getByLabel('Cell B1', { exact: true })).toBeVisible()
            await expect(page.getByLabel('Cell C1', { exact: true })).toBeVisible()
        })

        test('Merged anchor in body quadrant keeps single-row height when rows are frozen', async ({
            page,
        }) => {
            // Regression: merge sizing mixed absolute prefix-sum offsets
            // (colOffsets/rowOffsets) with quadrant-local `left`/`top`
            // props. For a merge whose anchor lived in the bottom-right
            // quadrant, the computed renderHeight was inflated by the
            // frozen-rows extent — the user saw the cell text vertically
            // pushed down by exactly the frozen header height.
            await navigateToPackage(page, 'calc')
            await openNewSpreadsheet(page)

            const formulaBar = page.getByRole('textbox', { name: 'Formula bar' })
            await typeIntoCell(page, formulaBar, 'A3', 'MERGED')

            // Capture the default row height before merging so the post-
            // merge assertion has a sheet-specific baseline (rather than
            // hard-coding a pixel value tied to the renderer).
            const a3BoxBefore = await page.getByLabel('Cell A3', { exact: true }).boundingBox()
            if (a3BoxBefore == null) throw new Error('A3 box missing pre-merge')
            const rowHeight = a3BoxBefore.height

            // Drag-select A3:C3 and merge.
            const a3 = page.getByLabel('Cell A3', { exact: true })
            const c3 = page.getByLabel('Cell C3', { exact: true })
            const a3Box = await a3.boundingBox()
            const c3Box = await c3.boundingBox()
            if (a3Box == null || c3Box == null) throw new Error('cell rects missing')
            await page.mouse.move(a3Box.x + a3Box.width / 2, a3Box.y + a3Box.height / 2)
            await page.mouse.down()
            await page.mouse.move(c3Box.x + c3Box.width / 2, c3Box.y + c3Box.height / 2, {
                steps: 8,
            })
            await page.mouse.up()
            await page.getByRole('button', { name: 'Format', exact: true }).click()
            await page.getByRole('menuitem', { name: 'Merge cells' }).click()
            await page.getByRole('menuitem', { name: 'Merge all', exact: true }).click()

            // Freeze 2 rows. Row 3 is the first row inside the body
            // (bottom-right) quadrant — exactly the quadrant where the
            // bug bit.
            await page.getByRole('button', { name: 'View', exact: true }).click()
            await page.getByRole('menuitem', { name: 'Freeze' }).click()
            await page.getByRole('menuitem', { name: '2 rows', exact: true }).click()

            // The merged anchor should still be exactly one row tall:
            // the merge spans columns only, not rows. Before the fix it
            // measured rowHeight + frozenHeight (~3x taller).
            const mergedBox = await page.getByLabel('Cell A3', { exact: true }).boundingBox()
            if (mergedBox == null) throw new Error('merged cell box missing post-freeze')
            expect(mergedBox.height).toBeCloseTo(rowHeight, 0)

            // The text node sits inside the cell rect — its top edge
            // should be within the cell's own height, not floating
            // somewhere below it (the visible symptom of the bug).
            const textBox = await page.getByText('MERGED', { exact: true }).boundingBox()
            if (textBox == null) throw new Error('merged text box missing')
            expect(textBox.y).toBeGreaterThanOrEqual(mergedBox.y - 1)
            expect(textBox.y + textBox.height).toBeLessThanOrEqual(
                mergedBox.y + mergedBox.height + 1
            )
        })

        test('Merged cells survive a page reload', async ({ page }) => {
            // Regression: merge entries were written as plain JS objects
            // under MERGES_KEY, but the Go snapshot decoder
            // (server/runtime.go::decodeMerges) type-asserts each value
            // to `*ycrdt.YMap`. Plain-object entries were silently
            // dropped on the next save, so client-created merges did
            // not survive any process that rebuilt the doc from
            // persisted state (most visibly a page reload).
            await navigateToPackage(page, 'calc')
            await openNewSpreadsheet(page)
            const sheetUrl = page.url()

            const formulaBar = page.getByRole('textbox', { name: 'Formula bar' })
            await typeIntoCell(page, formulaBar, 'A1', 'MERGED-A1')

            // Drag-select A1:C1 and merge.
            const a1 = page.getByLabel('Cell A1', { exact: true })
            const c1 = page.getByLabel('Cell C1', { exact: true })
            const a1Box = await a1.boundingBox()
            const c1Box = await c1.boundingBox()
            if (a1Box == null || c1Box == null) throw new Error('cell rects missing')
            await page.mouse.move(a1Box.x + a1Box.width / 2, a1Box.y + a1Box.height / 2)
            await page.mouse.down()
            await page.mouse.move(c1Box.x + c1Box.width / 2, c1Box.y + c1Box.height / 2, {
                steps: 8,
            })
            await page.mouse.up()
            await page.getByRole('button', { name: 'Format', exact: true }).click()
            await page.getByRole('menuitem', { name: 'Merge cells' }).click()
            await page.getByRole('menuitem', { name: 'Merge all', exact: true }).click()

            // Capture the merged width pre-reload as the baseline. The
            // server's SaveCoordinator debounces at 3s of idle; wait
            // long enough that the next reload's bootstrap reads the
            // persisted (not in-memory-only) state.
            const widthBefore = (await a1.boundingBox())?.width ?? 0
            expect(widthBefore).toBeGreaterThan(96 * 2)
            await page.waitForTimeout(4500)

            // Navigate away and back so the room empties (triggers a
            // final synchronous save) before re-opening from disk.
            await page.goto('about:blank')
            await page.goto(sheetUrl)
            await expect(page.getByLabel('Cell A1', { exact: true })).toBeVisible({
                timeout: 30_000,
            })
            // Allow live-query / Y.Doc sync to settle so the merge
            // entry is observed before we measure.
            await expect(page.getByLabel('Cell B1', { exact: true })).toHaveCount(0)
            await expect(page.getByLabel('Cell C1', { exact: true })).toHaveCount(0)

            const widthAfter = (await page.getByLabel('Cell A1', { exact: true }).boundingBox())
                ?.width
            expect(widthAfter).toBeCloseTo(widthBefore, 0)
        })
    })
})

test.describe('Sort & Filter', () => {
    test.setTimeout(120_000)

    test.beforeEach(async ({ page }) => {
        await login(page)
    })

    test('sort range A→Z reorders the selection alphabetically', async ({ page }) => {
        await navigateToPackage(page, 'calc')
        await openNewSpreadsheet(page)

        const formulaBar = page.getByRole('textbox', { name: 'Formula bar' })
        await typeIntoCell(page, formulaBar, 'A1', 'Banana')
        await typeIntoCell(page, formulaBar, 'A2', 'Apple')
        await typeIntoCell(page, formulaBar, 'A3', 'Cherry')
        await typeIntoCell(page, formulaBar, 'A4', 'Date')

        // Build a multi-cell selection A1:A4 by clicking A1 and shift-
        // clicking A4. The shift modifier is what extendSelectionTo
        // listens for in the cell PanResponder/click handler.
        await page.getByLabel('Cell A1', { exact: true }).click()
        await page.getByLabel('Cell A4', { exact: true }).click({ modifiers: ['Shift'] })

        await page.getByLabel('Cell A2', { exact: true }).click({ button: 'right' })
        await page.getByRole('menuitem', { name: 'Sort range A→Z' }).click()

        await expect(page.getByLabel('Cell A1', { exact: true })).toHaveText('Apple')
        await expect(page.getByLabel('Cell A2', { exact: true })).toHaveText('Banana')
        await expect(page.getByLabel('Cell A3', { exact: true })).toHaveText('Cherry')
        await expect(page.getByLabel('Cell A4', { exact: true })).toHaveText('Date')
    })

    test('column-header Sort sheet Z→A keeps populated rows at top with all columns aligned', async ({
        page,
    }) => {
        // Regression: a Z→A sort triggered from the column-header
        // context menu used to bubble empty rows above the data,
        // pushing every populated row off-screen (visually identical
        // to "deleting" the sheet). Also verifies that sibling columns
        // travel with their key column — the sort must reorder whole
        // rows, not just the clicked column.
        await navigateToPackage(page, 'calc')
        await openNewSpreadsheet(page)

        const formulaBar = page.getByRole('textbox', { name: 'Formula bar' })
        await typeIntoCell(page, formulaBar, 'A1', 'Apple')
        await typeIntoCell(page, formulaBar, 'B1', '1')
        await typeIntoCell(page, formulaBar, 'A2', 'Banana')
        await typeIntoCell(page, formulaBar, 'B2', '2')
        await typeIntoCell(page, formulaBar, 'A3', 'Cherry')
        await typeIntoCell(page, formulaBar, 'B3', '3')

        await page
            .getByLabel('Select column A', { exact: true })
            .click({ button: 'right' })
        await page.getByRole('menuitem', { name: 'Sort sheet Z→A' }).click()

        await expect(page.getByLabel('Cell A1', { exact: true })).toHaveText('Cherry')
        await expect(page.getByLabel('Cell B1', { exact: true })).toHaveText('3')
        await expect(page.getByLabel('Cell A2', { exact: true })).toHaveText('Banana')
        await expect(page.getByLabel('Cell B2', { exact: true })).toHaveText('2')
        await expect(page.getByLabel('Cell A3', { exact: true })).toHaveText('Apple')
        await expect(page.getByLabel('Cell B3', { exact: true })).toHaveText('1')
    })

    test('range-mode filter from selection hides non-matching rows and is reversible', async ({
        page,
    }) => {
        await navigateToPackage(page, 'calc')
        await openNewSpreadsheet(page)

        const formulaBar = page.getByRole('textbox', { name: 'Formula bar' })
        await typeIntoCell(page, formulaBar, 'A1', 'Apple')
        await typeIntoCell(page, formulaBar, 'A2', 'Banana')
        await typeIntoCell(page, formulaBar, 'A3', 'Cherry')

        // Select A1:A3, then right-click and pick "Filter". The new
        // flow builds a values-filter from the selection's distinct
        // displays, so only rows whose A value ∈ {Apple, Banana,
        // Cherry} stay visible across the whole sheet — i.e. all
        // three remain visible, and any other rows below would hide.
        await page.getByLabel('Cell A1', { exact: true }).click()
        await page.getByLabel('Cell A3', { exact: true }).click({ modifiers: ['Shift'] })
        await page.getByLabel('Cell A2', { exact: true }).click({ button: 'right' })
        await page.getByRole('menuitem', { name: 'Filter', exact: true }).click()

        await typeIntoCell(page, formulaBar, 'A4', 'Date')

        // Date is not in the selection's distinct values, so its row hides.
        await expect(page.getByLabel('Cell A4', { exact: true })).toHaveCount(0)
        await expect(page.getByLabel('Cell A2', { exact: true })).toHaveText('Banana')

        // Right-click again and Remove filter restores Date.
        await page.getByLabel('Cell A2', { exact: true }).click({ button: 'right' })
        await page.getByRole('menuitem', { name: 'Remove filter' }).click()
        await expect(page.getByLabel('Cell A4', { exact: true })).toHaveText('Date')
    })

    test('header-mode filter via Create filter dialog applies a condition', async ({
        page,
    }) => {
        await navigateToPackage(page, 'calc')
        await openNewSpreadsheet(page)

        const formulaBar = page.getByRole('textbox', { name: 'Formula bar' })
        await typeIntoCell(page, formulaBar, 'A1', 'Apple')
        await typeIntoCell(page, formulaBar, 'A2', 'Banana')
        await typeIntoCell(page, formulaBar, 'A3', 'Cherry')

        // Right-click the column-A header and open the new modal.
        await page.getByLabel('Select column A', { exact: true }).click({ button: 'right' })
        await page.getByRole('menuitem', { name: 'Create filter…' }).click()

        // Default op is "is equal to"; type Banana and Apply.
        await page.getByRole('textbox', { name: 'Filter value 1' }).fill('Banana')
        await page.getByRole('button', { name: 'Apply' }).click()

        // Apple and Cherry rows hide; Banana remains. The per-column
        // clearing icon should now be visible in the column A header.
        await expect(page.getByLabel('Cell A1', { exact: true })).toHaveCount(0)
        await expect(page.getByLabel('Cell A3', { exact: true })).toHaveCount(0)
        await expect(
            page.getByRole('button', { name: 'Clear filter on column A' })
        ).toBeVisible()

        // Click the clearing icon — only this column's criterion is
        // removed, which (being the last) also clears the whole filter.
        await page.getByRole('button', { name: 'Clear filter on column A' }).click()
        await expect(page.getByLabel('Cell A1', { exact: true })).toHaveText('Apple')
    })
})

// Reads a single computed style property from the rendered Text node
// inside a cell. RN-Web wraps Text as a div, and the cell wrapper
// (the element carrying aria-label="Cell A1") contains that text node
// as its first descendant div. Returns null if the cell or its text
// child is missing.
async function readCellTextStyle(
    page: import('@playwright/test').Page,
    cellLabel: string,
    property: 'fontWeight' | 'fontStyle' | 'textDecorationLine'
): Promise<string | null> {
    return page.evaluate(
        ({ label, prop }) => {
            const cell = document.querySelector(`[aria-label="${label}"]`)
            if (cell == null) return null
            const text = cell.querySelector('div')
            if (text == null) return null
            const style = window.getComputedStyle(text)
            return style[prop as 'fontWeight'] ?? null
        },
        { label: cellLabel, prop: property }
    )
}

test.describe('Persistence', () => {
    test.setTimeout(180_000)

    test.beforeEach(async ({ page }) => {
        await login(page)
    })

    test('deleted rows stay deleted after reload', async ({ page }) => {
        // Regression: the calc server's snapshot → XLSX serializer
        // used to treat cells missing from the snapshot as
        // "untouched", so client-side row deletions never made it
        // into the saved .xlsx. After the debounce-driven save the
        // file still held the deleted rows, and the next time anyone
        // opened the doc the bootstrap reseeded the Y.Doc from that
        // stale file — undoing the deletion. This test types four
        // rows, deletes the middle two via the column-header context
        // menu, waits past the 3s save debounce, reloads, and
        // verifies the deletion survived.
        await navigateToPackage(page, 'calc')
        await openNewSpreadsheet(page)

        const formulaBar = page.getByRole('textbox', { name: 'Formula bar' })
        // A fresh blank workbook seeds rowCount=1, which leaves the
        // "Delete rows" menu item disabled (the structural-mutation
        // floor refuses to remove the last row). Insert four rows
        // above row 1 first so rowCount grows past the floor before
        // we add data and exercise the deletion path.
        await page.getByLabel('Select row 1', { exact: true }).click({ button: 'right' })
        await page.getByRole('menuitem', { name: /Insert 1 row above/ }).click()
        await page.getByLabel('Select row 1', { exact: true }).click({ button: 'right' })
        await page.getByRole('menuitem', { name: /Insert 1 row above/ }).click()
        await page.getByLabel('Select row 1', { exact: true }).click({ button: 'right' })
        await page.getByRole('menuitem', { name: /Insert 1 row above/ }).click()
        await page.getByLabel('Select row 1', { exact: true }).click({ button: 'right' })
        await page.getByRole('menuitem', { name: /Insert 1 row above/ }).click()

        await typeIntoCell(page, formulaBar, 'A1', 'keep-top')
        await typeIntoCell(page, formulaBar, 'A2', 'delete-me-1')
        await typeIntoCell(page, formulaBar, 'A3', 'delete-me-2')
        await typeIntoCell(page, formulaBar, 'A4', 'keep-bottom')

        const workbookUrl = page.url()

        // Select A2:A3, then right-click on row-header 2 to open the
        // row context menu.
        await page.getByLabel('Cell A2', { exact: true }).click()
        await page.getByLabel('Cell A3', { exact: true }).click({ modifiers: ['Shift'] })
        await page.getByLabel('Select row 2', { exact: true }).click({ button: 'right' })
        await page.getByRole('menuitem', { name: 'Delete 2 rows' }).click()

        // Verify the in-memory grid shifted up immediately so we
        // know the mutation ran before the reload.
        await expect(page.getByLabel('Cell A1', { exact: true })).toHaveText('keep-top')
        await expect(page.getByLabel('Cell A2', { exact: true })).toHaveText('keep-bottom')

        // Wait past the save coordinator's 3s debounce + a margin
        // for the actual flush + xlsx write to land.
        await page.waitForTimeout(6_000)

        await page.goto(workbookUrl)
        await expect(page.getByLabel('Cell A1', { exact: true })).toBeVisible({
            timeout: 60_000,
        })

        await expect(page.getByLabel('Cell A1', { exact: true })).toHaveText('keep-top')
        await expect(page.getByLabel('Cell A2', { exact: true })).toHaveText('keep-bottom')
        await expect(page.getByLabel('Cell A3', { exact: true })).toHaveText('')
        await expect(page.getByLabel('Cell A4', { exact: true })).toHaveText('')
    })
})

test.describe('Find & Replace', () => {
    test.setTimeout(120_000)

    test.beforeEach(async ({ page }) => {
        await login(page)
    })

    test('Cmd+F opens dialog, finds matches, switches to replace, replaces all, undo restores', async ({
        page,
    }) => {
        await navigateToPackage(page, 'calc')
        await openNewSpreadsheet(page)

        const formulaBar = page.getByRole('textbox', { name: 'Formula bar' })
        await typeIntoCell(page, formulaBar, 'A1', 'apple')
        await typeIntoCell(page, formulaBar, 'A2', 'banana')
        await typeIntoCell(page, formulaBar, 'A3', 'apple pie')

        // Wait past the realtime undo manager's captureTimeout (500ms —
        // see core's use-y-undo-manager.ts) so the seed edits and the
        // upcoming replace-all land in distinct undo steps. Without
        // this gap, all four would merge into one step and the Cmd+Z
        // below would clear the seed too.
        await page.waitForTimeout(600)

        // Click into the body (not a cell editor) so Cmd+F is captured
        // by the global handler with no editor in flight.
        await page.getByLabel('Cell B1', { exact: true }).click()

        const isMac = process.platform === 'darwin'
        const mod = isMac ? 'Meta' : 'Control'
        await page.keyboard.press(`${mod}+f`)

        const queryInput = page.getByLabel('Find query')
        await expect(queryInput).toBeVisible()

        await queryInput.fill('apple')
        const counter = page.getByLabel('Find match counter')
        await expect(counter).toHaveText('1 of 2')

        // Yellow overlay rectangles render — at least one element with
        // accessibility label "Find current match" should exist.
        await expect(page.getByLabel('Find current match')).toBeVisible()

        // Enter steps to next match.
        await queryInput.press('Enter')
        await expect(counter).toHaveText('2 of 2')

        // Switch to replace mode via Cmd+Shift+H.
        await page.keyboard.press(`${mod}+Shift+H`)
        const replaceInput = page.getByLabel('Replace value')
        await expect(replaceInput).toBeVisible()

        await replaceInput.fill('orange')
        await page.getByRole('button', { name: 'Replace all' }).click()

        // Close the dialog so the cell text is unobstructed.
        await page.getByRole('button', { name: 'Close find' }).click()
        await expect(queryInput).toHaveCount(0)

        await expect(page.getByLabel('Cell A1', { exact: true })).toHaveText('orange')
        await expect(page.getByLabel('Cell A2', { exact: true })).toHaveText('banana')
        await expect(page.getByLabel('Cell A3', { exact: true })).toHaveText('orange pie')

        // Cmd+Z reverts the entire replace-all in a single step.
        // Click a cell, then Escape to drop formula-bar focus — RN-Web's
        // TextInput swallows Cmd+Z in the target phase, so the bubble-
        // phase tinykeys listener on window never sees it while the
        // formula bar is focused.
        await page.getByLabel('Cell B1', { exact: true }).click()
        await page.keyboard.press('Escape')
        await page.keyboard.press(`${mod}+z`)
        await expect(page.getByLabel('Cell A1', { exact: true })).toHaveText('apple')
        await expect(page.getByLabel('Cell A3', { exact: true })).toHaveText('apple pie')
    })
})

test.describe('Sheet management', () => {
    test.setTimeout(120_000)

    test.beforeEach(async ({ page }) => {
        await login(page)
    })

    test('+ button adds a new tab named "Sheet 2"', async ({ page }) => {
        await navigateToPackage(page, 'calc')
        await openNewSpreadsheet(page)
        await page.getByLabel('Add sheet', { exact: true }).click()
        await expect(page.getByLabel('Sheet Sheet 2', { exact: true })).toBeVisible()
    })

    test('double-click a tab to rename', async ({ page }) => {
        await navigateToPackage(page, 'calc')
        await openNewSpreadsheet(page)
        await page.getByLabel('Add sheet', { exact: true }).click()
        const tab = page.getByLabel('Sheet Sheet 2', { exact: true })
        await tab.dblclick()
        const input = page.getByLabel('Rename sheet', { exact: true })
        await input.fill('Renamed')
        await input.press('Enter')
        await expect(page.getByLabel('Sheet Renamed', { exact: true })).toBeVisible()
    })

    test('right-click → Duplicate creates "<name> (copy)"', async ({ page }) => {
        await navigateToPackage(page, 'calc')
        await openNewSpreadsheet(page)
        await page.getByLabel('Add sheet', { exact: true }).click()
        const tab = page.getByLabel('Sheet Sheet 2', { exact: true })
        await tab.dblclick()
        const input = page.getByLabel('Rename sheet', { exact: true })
        await input.fill('Renamed')
        await input.press('Enter')
        const renamed = page.getByLabel('Sheet Renamed', { exact: true })
        await renamed.click({ button: 'right' })
        await page.getByRole('menuitem', { name: 'Duplicate' }).click()
        await expect(page.getByLabel('Sheet Renamed (copy)', { exact: true })).toBeVisible()
    })

    test('right-click → Delete with confirm removes the tab', async ({ page }) => {
        await navigateToPackage(page, 'calc')
        await openNewSpreadsheet(page)
        await page.getByLabel('Add sheet', { exact: true }).click()
        const tab = page.getByLabel('Sheet Sheet 2', { exact: true })
        // Type into A1 of Sheet 2 so the destructive-delete confirm
        // triggers (delete on an empty sheet skips the dialog).
        await tab.click()
        const formulaBar = page.getByRole('textbox', { name: 'Formula bar' })
        await typeIntoCell(page, formulaBar, 'A1', 'hi')
        await tab.click({ button: 'right' })
        await page.getByRole('menuitem', { name: 'Delete' }).click()
        await page.getByRole('button', { name: 'Delete' }).click()
        await expect(page.getByLabel('Sheet Sheet 2', { exact: true })).toHaveCount(0)
    })

    test('reorder via Move-left swaps tab order', async ({ page }) => {
        await navigateToPackage(page, 'calc')
        await openNewSpreadsheet(page)
        await page.getByLabel('Add sheet', { exact: true }).click()
        await page.getByLabel('Add sheet', { exact: true }).click()
        // Now have Sheet 1, Sheet 2, Sheet 3. Right-click Sheet 3, move
        // left twice — final order should be Sheet 3, Sheet 1, Sheet 2.
        const sheet3 = page.getByLabel('Sheet Sheet 3', { exact: true })
        await sheet3.click({ button: 'right' })
        await page.getByRole('menuitem', { name: 'Move left' }).click()
        await sheet3.click({ button: 'right' })
        await page.getByRole('menuitem', { name: 'Move left' }).click()
        const order = await page.evaluate(() => {
            const tabs = Array.from(
                document.querySelectorAll('[aria-label^="Sheet Sheet "]')
            ) as HTMLElement[]
            return tabs.map(el => el.getAttribute('aria-label'))
        })
        expect(order[0]).toBe('Sheet Sheet 3')
    })
})

test.describe('Freeze panes', () => {
    test.setTimeout(120_000)

    test.beforeEach(async ({ page }) => {
        await login(page)
    })

    test('Freeze 1 row keeps row 1 pinned during vertical scroll', async ({ page }) => {
        await navigateToPackage(page, 'calc')
        await openNewSpreadsheet(page)
        const formulaBar = page.getByRole('textbox', { name: 'Formula bar' })

        // Type a value into A1 so the cell text is visually identifiable
        // before and after scroll.
        await typeIntoCell(page, formulaBar, 'A1', 'PINNED-A1')
        // Marker further down to confirm the body actually scrolls
        // when wheeled. A20 is the deepest cell guaranteed to be in
        // the initial viewport — the menubar trimmed body height to
        // roughly 20 visible rows.
        await typeIntoCell(page, formulaBar, 'A20', '20')

        await page.getByRole('button', { name: 'View', exact: true }).click()
        await page.getByRole('menuitem', { name: 'Freeze' }).click()
        await page.getByRole('menuitem', { name: '1 row', exact: true }).click()

        // Snapshot A1's on-screen position *after* the freeze takes
        // effect — that's the position it should hold while the body
        // scrolls underneath it.
        const beforeY = await cellTop(page, 'A1')
        expect(beforeY).not.toBeNull()

        // Scroll the body vertically. The sheet renders MIN_ROWS=50
        // rows of content (~1400px tall) so a 500px wheel scroll has
        // plenty of room to move. Hover the A20 area first so wheel
        // events target the body's free-quadrant scroll surface.
        await page.getByLabel('Cell A20', { exact: true }).hover()
        await page.mouse.wheel(0, 500)

        const afterY = await cellTop(page, 'A1')
        expect(afterY).not.toBeNull()
        // A1 sits in the top frozen quadrant which doesn't scroll —
        // its on-screen Y position should be unchanged (allow a tiny
        // sub-pixel rendering drift).
        expect(Math.abs((afterY ?? 0) - (beforeY ?? 0))).toBeLessThan(2)
    })

    test('Freeze 1 column keeps column A pinned during horizontal scroll', async ({ page }) => {
        await navigateToPackage(page, 'calc')
        await openNewSpreadsheet(page)
        const formulaBar = page.getByRole('textbox', { name: 'Formula bar' })

        await typeIntoCell(page, formulaBar, 'A1', 'PINNED-A1')
        await typeIntoCell(page, formulaBar, 'H1', '8')
        await typeIntoCell(page, formulaBar, 'P1', '16')

        await page.getByRole('button', { name: 'View', exact: true }).click()
        await page.getByRole('menuitem', { name: 'Freeze' }).click()
        await page.getByRole('menuitem', { name: '1 column', exact: true }).click()

        const beforeX = await cellLeft(page, 'A1')
        expect(beforeX).not.toBeNull()

        // Scroll body horizontally. mouse.wheel with deltaX moves
        // horizontal scroll in the bottom-right quadrant.
        await page.getByLabel('Cell H1', { exact: true }).hover()
        await page.mouse.wheel(800, 0)

        const afterX = await cellLeft(page, 'A1')
        expect(afterX).not.toBeNull()
        expect(Math.abs((afterX ?? 0) - (beforeX ?? 0))).toBeLessThan(2)
    })

    test('Unfreeze restores normal scrolling', async ({ page }) => {
        await navigateToPackage(page, 'calc')
        await openNewSpreadsheet(page)
        const formulaBar = page.getByRole('textbox', { name: 'Formula bar' })

        await typeIntoCell(page, formulaBar, 'A1', 'A1')
        // Freeze, then unfreeze; assert the freeze menu's Unfreeze
        // item drops the pane back to a single quadrant by checking
        // that A1 once again moves with vertical scroll.
        await page.getByRole('button', { name: 'View', exact: true }).click()
        await page.getByRole('menuitem', { name: 'Freeze' }).click()
        await page.getByRole('menuitem', { name: '1 row', exact: true }).click()
        await page.getByRole('button', { name: 'View', exact: true }).click()
        await page.getByRole('menuitem', { name: 'Freeze' }).click()
        await page.getByRole('menuitem', { name: 'Unfreeze', exact: true }).click()

        const beforeY = await cellTop(page, 'A1')
        expect(beforeY).not.toBeNull()
        // Hover a non-anchor cell so the wheel event lands inside the
        // body's scroll surface. A5 is in the initial viewport but
        // not the active anchor, so it doesn't enter edit mode on
        // hover and reliably routes wheel events to the body.
        await page.getByLabel('Cell A5', { exact: true }).hover()
        // Scroll by less than A1's distance from the top of the body
        // — at 28px cell-height with ~4 rows of OVERSCAN, scrolling
        // 50px keeps A1 inside the rendered range so we can still
        // measure its new (lower-on-screen) position.
        await page.mouse.wheel(0, 50)
        // Give the ScrollView a frame to settle before re-measuring.
        await page.waitForTimeout(100)
        const afterY = await cellTop(page, 'A1')
        // After unfreeze the body is one ScrollView; A1 should have
        // moved upward (negative direction) when the body scrolled.
        if (beforeY != null && afterY != null) {
            expect(afterY).toBeLessThan(beforeY)
        }
    })
})

async function cellTop(
    page: import('@playwright/test').Page,
    label: string
): Promise<number | null> {
    const box = await page.getByLabel(`Cell ${label}`, { exact: true }).first().boundingBox()
    return box ? box.y : null
}

async function cellLeft(
    page: import('@playwright/test').Page,
    label: string
): Promise<number | null> {
    const box = await page.getByLabel(`Cell ${label}`, { exact: true }).first().boundingBox()
    return box ? box.x : null
}

async function typeIntoCell(
    page: import('@playwright/test').Page,
    formulaBar: import('@playwright/test').Locator,
    cellLabel: string,
    value: string
): Promise<void> {
    await page.getByLabel(`Cell ${cellLabel}`, { exact: true }).click()
    await formulaBar.fill(value)
    await formulaBar.press('Enter')
}

// Click the "New spreadsheet" button on the calc index, wait for the
// detail URL, and wait for the Grid (column A header) to render. The
// detail screen flips through "Loading…" / "Opening…" placeholders
// before mounting the Grid; tests that read DOM geometry or click
// cells immediately after waitForURL race that mount.
async function openNewSpreadsheet(page: import('@playwright/test').Page): Promise<void> {
    // Wait for the calc index to fully render before clicking the create
    // button. handleNew inside CalcIndex throws "Organization context not
    // ready" if useOrgInfo / useCurrentUserOrg haven't resolved yet, and
    // when that happens the click silently does nothing — the page stays
    // on the index and the subsequent waitForURL hangs until the test
    // timeout.
    await expect(page.getByRole('heading', { level: 2, name: 'Calc' }).first()).toBeVisible({
        timeout: 30_000,
    })
    const newBtn = page.getByRole('button', { name: 'New spreadsheet' })
    await newBtn.click()
    // The click triggers an async create + navigation. Under parallel-
    // worker contention either the create or the realtime open can take
    // longer than usual, so the URL/grid waits use a generous timeout.
    // 90s aligns with the file-level test timeout above.
    await page.waitForURL(/\/calc\/[^/]+$/, { timeout: 75_000 })
    await expect(page.getByLabel('Cell A1', { exact: true })).toBeVisible({ timeout: 75_000 })
}

// Reads the on-screen left/width of column-header cells A and B.
// Header cells contain a single text node ("A" / "B") inside an
// absolute-positioned <View>; the rect of that parent is what
// callers compare across resize gestures.
async function readHeaderRects(page: import('@playwright/test').Page): Promise<{
    A: { left: number; width: number } | null
    B: { left: number; width: number } | null
}> {
    return page.evaluate(() => {
        const find = (text: string) => {
            for (const el of Array.from(document.querySelectorAll('div'))) {
                if (el.textContent === text && el.children.length === 0) {
                    const cell = el.parentElement
                    if (cell) {
                        const rect = cell.getBoundingClientRect()
                        return { left: rect.left, width: rect.width }
                    }
                }
            }
            return null
        }
        return { A: find('A'), B: find('B') }
    })
}

test.describe('Calc CSV import/export', () => {
    test.setTimeout(120_000)

    test.beforeEach(async ({ page }) => {
        await login(page)
    })

    test('Download as CSV (current sheet) writes the active grid', async ({ page }) => {
        await navigateToPackage(page, 'calc')
        await openNewSpreadsheet(page)

        const formulaBar = page.getByRole('textbox', { name: 'Formula bar' })
        await typeIntoCell(page, formulaBar, 'A1', 'Name')
        await typeIntoCell(page, formulaBar, 'B1', 'Score')
        await typeIntoCell(page, formulaBar, 'A2', 'Alice')
        await typeIntoCell(page, formulaBar, 'B2', '42')
        await typeIntoCell(page, formulaBar, 'A3', 'Bob')
        await typeIntoCell(page, formulaBar, 'B3', '37')

        await page.getByRole('button', { name: 'File', exact: true }).click()
        await page.getByRole('menuitem', { name: 'Download', exact: true }).hover()
        const downloadPromise = page.waitForEvent('download')
        await page
            .getByRole('menuitem', { name: 'Download as CSV (current sheet)' })
            .click()
        const download = await downloadPromise
        expect(download.suggestedFilename()).toMatch(/\.csv$/)

        const savedPath = join(tmpdir(), `calc-csv-${Date.now()}.csv`)
        await download.saveAs(savedPath)
        const contents = readFileSync(savedPath, 'utf-8')
        expect(contents).toContain('Name,Score')
        expect(contents).toContain('Alice,42')
        expect(contents).toContain('Bob,37')
    })

    test('Import CSV creates a new spreadsheet from the file picker', async ({ page }) => {
        await navigateToPackage(page, 'calc')
        await expect(page.getByRole('heading', { level: 2, name: 'Calc' }).first()).toBeVisible({
            timeout: 30_000,
        })

        const csv = 'Title,Count\r\nApples,12\r\nOranges,7'
        const fileChooserPromise = page.waitForEvent('filechooser')
        await page.getByRole('button', { name: 'Import CSV' }).click()
        const chooser = await fileChooserPromise
        await chooser.setFiles({
            name: 'fruit.csv',
            mimeType: 'text/csv',
            buffer: Buffer.from(csv, 'utf-8'),
        })

        await page.getByRole('button', { name: 'Confirm CSV import' }).click()
        await page.waitForURL(/\/calc\/[^/]+$/, { timeout: 75_000 })
        // The import lands on a fresh sheet named "Imported" so the
        // pre-existing blank Sheet1 stays untouched; activate that
        // tab to view the imported rows.
        await page.getByLabel('Sheet Imported', { exact: true }).click({ timeout: 75_000 })
        await expect(page.getByLabel('Cell A1', { exact: true })).toHaveText('Title', {
            timeout: 75_000,
        })
        await expect(page.getByLabel('Cell B1', { exact: true })).toHaveText('Count')
        await expect(page.getByLabel('Cell A2', { exact: true })).toHaveText('Apples')
        await expect(page.getByLabel('Cell B2', { exact: true })).toHaveText('12')
    })
})
