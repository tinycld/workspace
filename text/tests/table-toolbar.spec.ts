import { expect, type Page, test } from '@playwright/test'
import { login, ORG_SLUG } from '../../../../tests/e2e/helpers'
import {
    EDITOR_READY_TIMEOUT,
    editorRoot,
    FEATURE_DOC_HEADING,
    TEXT_TEST_TIMEOUT,
    uniqueDocName,
    uploadDocxAsDriveItem,
    waitForEditor,
} from './_menubar-helpers'

const TEST_TIMEOUT = TEXT_TEST_TIMEOUT

// Locate the freshly-inserted table by its total cell count. We can't
// rely on document position — `editorRoot.click()` parks the caret
// near the start of the doc, so insertTable lands the new table
// somewhere upstream rather than at .last(). The fixture's existing
// tables have 18 and 33 cells, so any 4-cell (2×2) or 9-cell (3×3)
// table is unambiguously the one we just inserted.
async function findInsertedTable(page: Page, expectedCells: number) {
    // Wait for ProseMirror reconciliation by retrying the index lookup
    // through Playwright's auto-retry on expect.toHaveCount above.
    const tables = editorRoot(page).locator('table')
    const counts = await tables.evaluateAll(ts => ts.map(t => t.querySelectorAll('th,td').length))
    const idx = counts.indexOf(expectedCells)
    if (idx < 0) {
        throw new Error(
            `No inserted ${expectedCells}-cell table found; cell counts were ${JSON.stringify(counts)}`
        )
    }
    return tables.nth(idx)
}

// Open the table popover by clicking the "Table" toolbar button. The
// Menu.Trigger wraps the FormatButton with a measuring <div> that
// dispatches onClickCapture, so a normal click is enough.
async function openTablePopover(page: Page): Promise<void> {
    await page.getByRole('button', { name: 'Table', exact: true }).click()
}

test.describe('Text — Table toolbar', () => {
    test.setTimeout(TEST_TIMEOUT)

    test('not in a table: popover shows grid picker, no row/col options', async ({ page }) => {
        const itemId = await uploadDocxAsDriveItem(uniqueDocName('table-picker'))
        await login(page)
        await page.goto(`/a/${ORG_SLUG}/text/${itemId}`)
        await waitForEditor(page)
        await expect(page.getByText(FEATURE_DOC_HEADING).first()).toBeVisible({
            timeout: EDITOR_READY_TIMEOUT,
        })

        // Put the caret in a paragraph that is NOT inside a table — the
        // H1 at the top of the fixture is a safe anchor.
        await editorRoot(page).click()
        await page.keyboard.press('Home')

        await openTablePopover(page)

        // Grid picker visible.
        await expect(page.getByText('Insert table')).toBeVisible()
        // Hover-prompt only renders inside the grid picker.
        await expect(page.getByText('Hover to choose size')).toBeVisible()

        // Row/column actions are hidden when not in a table.
        await expect(page.getByRole('button', { name: 'Add row above' })).toHaveCount(0)
        await expect(page.getByRole('button', { name: 'Delete row' })).toHaveCount(0)
    })

    test('inserting a 2x2 grid produces a 2x2 table in the doc', async ({ page }) => {
        const itemId = await uploadDocxAsDriveItem(uniqueDocName('table-insert'))
        await login(page)
        await page.goto(`/a/${ORG_SLUG}/text/${itemId}`)
        await waitForEditor(page)
        await expect(page.getByText(FEATURE_DOC_HEADING).first()).toBeVisible({
            timeout: EDITOR_READY_TIMEOUT,
        })
        // The fixture's tables (Simple + Complex) render asynchronously
        // through the bootstrap → Y.Doc → Tiptap pipeline. Wait for the
        // "Complex Table" h3 to ensure both tables are present before
        // we snapshot the pre-insert count; otherwise the `before` count
        // races the second table and we can pick the wrong .nth() index
        // after our insert.
        await expect(page.getByText('Complex Tables').first()).toBeVisible({
            timeout: EDITOR_READY_TIMEOUT,
        })

        // The fixture already contains a few tables. Count them up
        // front so we can assert that the click adds exactly one new
        // table.
        const before = await editorRoot(page).locator('table').count()

        // Move to a fresh paragraph at the end of the doc.
        await editorRoot(page).click()
        await page.keyboard.press('End')
        await page.keyboard.press('Enter')

        await openTablePopover(page)
        // Each grid cell carries an accessibilityLabel like "2 by 2 table".
        await page.getByRole('button', { name: '2 by 2 table' }).click()

        // One new <table> appended. We can't rely on document order to
        // pick the new table — `editorRoot.click()` parks the caret near
        // the start of the doc rather than the end, and insertTable
        // inserts at the caret position. Instead, count tables that
        // have exactly four cells: the fixture's existing Simple and
        // Complex tables have 18 and 33 cells respectively, so any
        // 4-cell table can only be a freshly-inserted 2×2.
        await expect(editorRoot(page).locator('table')).toHaveCount(before + 1, { timeout: 10_000 })
        const cellCounts = await editorRoot(page)
            .locator('table')
            .evaluateAll(tables => tables.map(t => t.querySelectorAll('th,td').length))
        expect(cellCounts).toContain(4)
        expect(cellCounts.filter(c => c === 4).length).toBe(1)
    })

    test('in a table: popover shows row/col options, no grid picker', async ({ page }) => {
        const itemId = await uploadDocxAsDriveItem(uniqueDocName('table-ops'))
        await login(page)
        await page.goto(`/a/${ORG_SLUG}/text/${itemId}`)
        await waitForEditor(page)
        await expect(page.getByText(FEATURE_DOC_HEADING).first()).toBeVisible({
            timeout: EDITOR_READY_TIMEOUT,
        })

        // Fixture tables (Simple + Complex) render asynchronously; wait
        // for the second tables-section heading before snapshotting the
        // table count so we don't race the renderer.
        await expect(page.getByText('Complex Tables').first()).toBeVisible({
            timeout: EDITOR_READY_TIMEOUT,
        })
        const tablesBefore = await editorRoot(page).locator('table').count()

        // First: insert a table so we have one to land the caret in.
        await editorRoot(page).click()
        await page.keyboard.press('End')
        await page.keyboard.press('Enter')
        await openTablePopover(page)
        await page.getByRole('button', { name: '2 by 2 table' }).click()
        await expect(editorRoot(page).locator('table')).toHaveCount(tablesBefore + 1)

        // The insertTable command leaves the caret inside the new
        // table's first cell. Re-open the popover from that position.
        await openTablePopover(page)

        // Row/column actions now visible.
        await expect(page.getByRole('button', { name: 'Add row above' })).toBeVisible()
        await expect(page.getByRole('button', { name: 'Add row below' })).toBeVisible()
        await expect(page.getByRole('button', { name: 'Add column left' })).toBeVisible()
        await expect(page.getByRole('button', { name: 'Add column right' })).toBeVisible()
        await expect(page.getByRole('button', { name: 'Delete row' })).toBeVisible()
        await expect(page.getByRole('button', { name: 'Delete column' })).toBeVisible()
        await expect(page.getByRole('button', { name: 'Delete table' })).toBeVisible()

        // Grid picker hidden.
        await expect(page.getByText('Hover to choose size')).toHaveCount(0)
    })

    test('add row below grows the table by one row', async ({ page }) => {
        const itemId = await uploadDocxAsDriveItem(uniqueDocName('table-add-row'))
        await login(page)
        await page.goto(`/a/${ORG_SLUG}/text/${itemId}`)
        await waitForEditor(page)
        await expect(page.getByText(FEATURE_DOC_HEADING).first()).toBeVisible({
            timeout: EDITOR_READY_TIMEOUT,
        })

        // Fixture tables (Simple + Complex) render asynchronously; wait
        // for the second tables-section heading before snapshotting the
        // table count so we don't race the renderer.
        await expect(page.getByText('Complex Tables').first()).toBeVisible({
            timeout: EDITOR_READY_TIMEOUT,
        })
        const tablesBefore = await editorRoot(page).locator('table').count()

        await editorRoot(page).click()
        await page.keyboard.press('End')
        await page.keyboard.press('Enter')

        // Insert a 2x2 starter, then locate the new table by cell count
        // — the fixture's existing tables have 18 and 33 cells, so a
        // 4-cell table is unambiguously our insert.
        await openTablePopover(page)
        await page.getByRole('button', { name: '2 by 2 table' }).click()
        await expect(editorRoot(page).locator('table')).toHaveCount(tablesBefore + 1)
        const insertedTable = await findInsertedTable(page, 4)
        const initialRowCount = await insertedTable.locator('tr').count()

        // Caret is already inside a cell of the new table. Reopen the
        // popover and click "Add row below".
        await openTablePopover(page)
        await page.getByRole('button', { name: 'Add row below' }).click()

        // One more <tr> than we started with.
        await expect(insertedTable.locator('tr')).toHaveCount(initialRowCount + 1)
    })

    test('cell borders button is disabled outside a table and enabled inside', async ({ page }) => {
        const itemId = await uploadDocxAsDriveItem(uniqueDocName('borders-disabled'))
        await login(page)
        await page.goto(`/a/${ORG_SLUG}/text/${itemId}`)
        await waitForEditor(page)
        await expect(page.getByText(FEATURE_DOC_HEADING).first()).toBeVisible({
            timeout: EDITOR_READY_TIMEOUT,
        })

        // Outside any table — borders button should be disabled.
        await editorRoot(page).click()
        await page.keyboard.press('Home')
        const bordersBtn = page.getByRole('button', { name: 'Cell borders' })
        await expect(bordersBtn).toBeDisabled()

        // Insert a table; caret lands inside it.
        await page.keyboard.press('End')
        await page.keyboard.press('Enter')
        await openTablePopover(page)
        await page.getByRole('button', { name: '2 by 2 table' }).click()

        // Borders button is now enabled.
        await expect(bordersBtn).toBeEnabled()
    })

    test('apply "All" border preset writes data-borders to cells', async ({ page }) => {
        const itemId = await uploadDocxAsDriveItem(uniqueDocName('borders-apply'))
        await login(page)
        await page.goto(`/a/${ORG_SLUG}/text/${itemId}`)
        await waitForEditor(page)
        await expect(page.getByText(FEATURE_DOC_HEADING).first()).toBeVisible({
            timeout: EDITOR_READY_TIMEOUT,
        })

        // Fixture tables (Simple + Complex) render asynchronously; wait
        // for the second tables-section heading before snapshotting the
        // table count so we don't race the renderer.
        await expect(page.getByText('Complex Tables').first()).toBeVisible({
            timeout: EDITOR_READY_TIMEOUT,
        })
        const tablesBefore = await editorRoot(page).locator('table').count()

        await editorRoot(page).click()
        await page.keyboard.press('End')
        await page.keyboard.press('Enter')
        await openTablePopover(page)
        await page.getByRole('button', { name: '2 by 2 table' }).click()
        await expect(editorRoot(page).locator('table')).toHaveCount(tablesBefore + 1)
        const insertedTable = await findInsertedTable(page, 4)

        // Caret is in the table; open the borders menu and click All.
        await page.getByRole('button', { name: 'Cell borders' }).click()
        await page.getByRole('button', { name: 'Apply All borders' }).click()

        // The active cell carries data-borders=<JSON> after the command
        // runs. setCellBorders walks the current cell selection, which
        // for a plain caret defaults to the single enclosing cell — so
        // we expect at least one cell in the new table to be annotated.
        await expect(insertedTable.locator('[data-borders]').first()).toBeAttached({
            timeout: 10_000,
        })
    })
})
