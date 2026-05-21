import { expect, type Page, test } from '@playwright/test'
import { login, navigateToPackage } from '../../../../tests/e2e/helpers'

// End-to-end coverage for the pivot UI surface. Each test owns its
// own workbook so a destructive action (rename, delete, undo) can't
// poison sibling tests that run in the same DB.
//
// Selector conventions (audited against the actual built components):
//   - Toolbar entry: accessibilityLabel="Insert pivot table"
//     (PivotInsertButton wraps a ToolbarButton with that label).
//   - Dialog field labels: "Source range" + "New sheet name". The
//     submit button is "Create pivot table". From NewPivotDialog.tsx.
//   - Source cells: accessibilityLabel="Cell A1" etc. (the
//     calc.spec.ts convention). We type via the formula bar, not via
//     a per-cell role textbox.
//   - Sheet tabs: accessibilityLabel="Sheet <name>". getByLabel
//     instead of getByRole('tab') so we don't depend on RN-Web's
//     role compilation.
//   - FieldList shortcut buttons: "Add <field> to R/C/V/F".
//   - PivotSidePanel option toggles: "Toggle row grand totals" etc.
//   - PivotSidePanel filter chips: "Toggle <value>" inside the
//     filter row.
//   - PivotSidePanel aggregation chips: "Use sum", "Use count", etc.
//     (PIVOT_AGGREGATIONS in field-row-helpers.ts).
//   - PivotSidePanel close: accessibilityLabel="Close pivot panel".
//   - PivotEmptyState CTA: button "Open pivot editor".
//   - PivotBanner: container accessibilityLabel="Pivot error",
//     CTA button accessibilityLabel="Edit pivot".

test.describe('Calc pivot tables', () => {
    test.setTimeout(180_000)

    test.beforeEach(async ({ page }) => {
        await login(page)
    })

    test('insert pivot, build fields, recompute on source change', async ({ page }) => {
        await navigateToPackage(page, 'calc')
        await openNewSpreadsheet(page)

        const formulaBar = page.getByRole('textbox', { name: 'Formula bar' })

        // Small dataset on Sheet1: a 2-column / 3-row table. Header
        // row (Region, Sales) plus two data rows so the pivot has
        // something to group and aggregate.
        await typeIntoCell(page, formulaBar, 'A1', 'Region')
        await typeIntoCell(page, formulaBar, 'B1', 'Sales')
        await typeIntoCell(page, formulaBar, 'A2', 'East')
        await typeIntoCell(page, formulaBar, 'B2', '10')
        await typeIntoCell(page, formulaBar, 'A3', 'West')
        await typeIntoCell(page, formulaBar, 'B3', '20')

        await createPivot(page, { sourceRange: 'Sheet1!A1:B3', targetSheetName: 'Summary' })

        await expect(page.getByText('Configure your pivot')).toBeVisible({ timeout: 30_000 })

        // Drag fields in via the FieldList click shortcuts on the
        // side panel. Labels mirror the plan: "Add <field> to R/C/V/F".
        await page.getByLabel('Add Region to R').click()
        await page.getByLabel('Add Sales to V').click()

        // Pivot output renders. Region values plus the grand-total row
        // (rowGrandTotals defaults to true on a freshly-built pivot).
        await expect(page.getByText('East', { exact: true })).toBeVisible()
        await expect(page.getByText('West', { exact: true })).toBeVisible()
        await expect(page.getByText('Grand Total').first()).toBeVisible()

        // Sum aggregation: East=10, West=20, Grand Total=30.
        // 30 appears twice (column-total row + row-totals column intersect),
        // so just confirm at least one appears.
        await expect(page.getByText('30', { exact: true }).first()).toBeVisible()

        // Mutate the source: switch back to Sheet1, set B2 to 99. The
        // pivot engine subscribes to the source range via the Y.Doc
        // bindings, so the recompute propagates when we come back to
        // the Summary tab.
        await page.getByLabel('Sheet Sheet1').first().click()
        await typeIntoCell(page, formulaBar, 'B2', '99')

        // Switch back to the pivot sheet — recompute should have run.
        // East=99, West=20, Grand Total=119. (119 appears twice — at the
        // row-totals column intersect and the column-total row.)
        await page.getByLabel('Sheet Summary').first().click()
        await expect(page.getByText('119', { exact: true }).first()).toBeVisible({
            timeout: 15_000,
        })
    })

    test('swap value aggregation from sum to count', async ({ page }) => {
        // Verifies the aggregation chips in ValueFieldRow flip the
        // computed pivot output. Full path exercised:
        //   chip press → setValueAggregation mutate → y-binding write
        //   → use-rendered-pivot snapshot → engine recompute → render.
        // Catches regressions in: the chip-to-PivotAggregation mapping,
        // y-binding's VALID_AGGS set, and engine code paths.
        //
        // Witness values: with East=10, West=20 source rows,
        //   sum     → West row total = "20", Grand Total = "30"
        //   count   → West row total = "1",  Grand Total = "2"
        // The "20" string only appears in the rendered pivot when
        // aggregation is sum (since West has one row with value 20),
        // so its disappearance is a clean signal that count took over.
        await navigateToPackage(page, 'calc')
        await openNewSpreadsheet(page)
        const formulaBar = page.getByRole('textbox', { name: 'Formula bar' })
        await seedTwoRegionsTwoRows(page, formulaBar)

        await createPivot(page, {
            sourceRange: 'Sheet1!A1:B3',
            targetSheetName: 'AggSwap',
        })
        await page.getByLabel('Add Region to R').click()
        await page.getByLabel('Add Sales to V').click()

        // Default sum aggregation renders the West row's 20 and the
        // grand total 30.
        await expect(page.getByText('20', { exact: true }).first()).toBeVisible({
            timeout: 15_000,
        })
        await expect(page.getByText('30', { exact: true }).first()).toBeVisible()

        // Switch the aggregation to 'count'. The chip's
        // accessibilityLabel is "Use count" (AggregationChip in
        // ValueFieldRow.tsx).
        await page.getByRole('button', { name: 'Use count', exact: true }).click()

        // Each region has 1 row → count is 1 per region, total 2.
        // The 20 and 30 totals from sum should be gone from the output.
        await expect(page.getByText('2', { exact: true }).first()).toBeVisible({
            timeout: 15_000,
        })
        await expect(page.getByText('20', { exact: true })).toHaveCount(0)
        await expect(page.getByText('30', { exact: true })).toHaveCount(0)
    })

    test('option toggles flip checked state on click', async ({ page }) => {
        // Verifies the option-toggle Switches in PivotSidePanel are
        // interactive in Playwright (regression from the prior RN-Web
        // Switch, which rendered overlapping input/track/thumb layers
        // that swallowed synthesized clicks). The new Switch is a
        // Pressable with role="switch" + aria-checked, so .click()
        // fires onValueChange normally. The setBoolean → engine path
        // is covered by the pivot-mutate unit tests.
        await navigateToPackage(page, 'calc')
        await openNewSpreadsheet(page)
        const formulaBar = page.getByRole('textbox', { name: 'Formula bar' })
        await seedTwoRegionsTwoRows(page, formulaBar)

        await createPivot(page, {
            sourceRange: 'Sheet1!A1:B3',
            targetSheetName: 'Totals',
        })
        await page.getByLabel('Add Region to R').click()
        await page.getByLabel('Add Sales to V').click()

        const rowGrand = page.getByLabel('Toggle row grand totals')
        const colGrand = page.getByLabel('Toggle column grand totals')
        const rowSub = page.getByLabel('Toggle row subtotals')
        const colSub = page.getByLabel('Toggle column subtotals')

        // Defaults: grand-totals on, subtotals off
        // (buildInitialPivotDefinition mirrors Sheets).
        await expect(rowGrand).toBeChecked({ timeout: 15_000 })
        await expect(colGrand).toBeChecked()
        await expect(rowSub).not.toBeChecked()
        await expect(colSub).not.toBeChecked()

        // Click each switch and confirm checked state flips. This
        // proves the click landed and onValueChange fired (which is
        // what the previous test could not assert).
        await rowGrand.click()
        await expect(rowGrand).not.toBeChecked()
        await colGrand.click()
        await expect(colGrand).not.toBeChecked()
        await rowSub.click()
        await expect(rowSub).toBeChecked()
        await colSub.click()
        await expect(colSub).toBeChecked()
    })

    test('filter selection trims rows from the pivot output', async ({ page }) => {
        // Three regions in the source; configure Region as a Filter
        // and Sales as a Value. Default selection is empty (= "all"),
        // so all three regions appear. Click a single value chip — the
        // row set narrows to that one region.
        //
        // We can't use the region names as the "did this row drop"
        // signal because FilterFieldRow renders a chip per distinct
        // value, so "West" and "North" remain in the DOM as filter
        // chips after the trim. We watch the Sales numbers instead:
        // 20 and 30 only appear inside the pivot grid, so their
        // disappearance is a clean signal.
        await navigateToPackage(page, 'calc')
        await openNewSpreadsheet(page)
        const formulaBar = page.getByRole('textbox', { name: 'Formula bar' })

        await typeIntoCell(page, formulaBar, 'A1', 'Region')
        await typeIntoCell(page, formulaBar, 'B1', 'Sales')
        await typeIntoCell(page, formulaBar, 'A2', 'East')
        await typeIntoCell(page, formulaBar, 'B2', '10')
        await typeIntoCell(page, formulaBar, 'A3', 'West')
        await typeIntoCell(page, formulaBar, 'B3', '20')
        await typeIntoCell(page, formulaBar, 'A4', 'North')
        await typeIntoCell(page, formulaBar, 'B4', '30')

        await createPivot(page, {
            sourceRange: 'Sheet1!A1:B4',
            targetSheetName: 'Filtered',
        })
        await page.getByLabel('Add Region to R').click()
        await page.getByLabel('Add Sales to V').click()
        await page.getByLabel('Add Region to F').click()

        // Pre-filter: all three region totals are present in the
        // rendered output.
        await expect(page.getByText('10', { exact: true }).first()).toBeVisible({
            timeout: 15_000,
        })
        await expect(page.getByText('20', { exact: true }).first()).toBeVisible()
        await expect(page.getByText('30', { exact: true }).first()).toBeVisible()
        // Grand total = 10 + 20 + 30 = 60.
        await expect(page.getByText('60', { exact: true }).first()).toBeVisible()

        // Pick "East" only. The chip's accessibility label is
        // "Toggle East" (FilterValueChip in FilterFieldRow.tsx).
        await page.getByRole('button', { name: 'Toggle East', exact: true }).click()

        // The summary label flips to "1 selected".
        await expect(page.getByText('1 selected', { exact: true })).toBeVisible()

        // West=20 and North=30 are out of the rendered pivot; East=10
        // is the only data row, so the grand total drops from 60 to 10.
        await expect(page.getByText('20', { exact: true })).toHaveCount(0)
        await expect(page.getByText('30', { exact: true })).toHaveCount(0)
        await expect(page.getByText('60', { exact: true })).toHaveCount(0)
    })

    test('empty-state CTA opens the side panel; close button closes it', async ({ page }) => {
        // Side panel doesn't open automatically when navigating to an
        // already-existing pivot output sheet — usePivotPanelStore is
        // session-local. Verify the empty-state CTA "Open pivot editor"
        // mounts the panel, and the panel header's close button
        // unmounts it. PivotSidePanel renders "Pivot editor" as its
        // title — that's the load-bearing visibility signal.
        await navigateToPackage(page, 'calc')
        await openNewSpreadsheet(page)
        const formulaBar = page.getByRole('textbox', { name: 'Formula bar' })
        await seedTwoRegionsTwoRows(page, formulaBar)

        await createPivot(page, {
            sourceRange: 'Sheet1!A1:B3',
            targetSheetName: 'PanelToggle',
        })

        // After createPivot the panel opens automatically (the insert
        // button calls usePivotPanelStore.open). Close it first so we
        // can test re-opening via the empty-state CTA.
        await expect(page.getByText('Pivot editor', { exact: true })).toBeVisible({
            timeout: 15_000,
        })
        await page.getByRole('button', { name: 'Close pivot panel' }).click()
        await expect(page.getByText('Pivot editor', { exact: true })).toHaveCount(0)

        // Empty-state CTA brings the panel back.
        await page.getByRole('button', { name: 'Open pivot editor' }).click()
        await expect(page.getByText('Pivot editor', { exact: true })).toBeVisible()
    })

    test('NewPivotDialog disables Create on a malformed source range', async ({ page }) => {
        // newPivotSchema (in new-pivot-dialog-helpers.ts) refines
        // sourceRange via parseA1Range — anything that doesn't parse
        // as "Sheet!A1:Z9" should leave the Create button disabled.
        // Cancel should close the dialog without creating a sheet.
        await navigateToPackage(page, 'calc')
        await openNewSpreadsheet(page)

        await page.getByRole('button', { name: 'Insert pivot table' }).click()
        const sourceInput = page.getByLabel('Source range', { exact: true })
        await expect(sourceInput).toBeVisible()
        await sourceInput.fill('not a range')

        const createBtn = page.getByRole('button', { name: 'Create pivot table' })
        await expect(createBtn).toBeDisabled()

        // Fixing the range re-enables Create.
        await sourceInput.fill('Sheet1!A1:B3')
        await expect(createBtn).toBeEnabled()

        // Cancel closes the modal without adding a new sheet — the
        // bottom tab strip should still only show Sheet1.
        await page.getByRole('button', { name: 'Cancel', exact: true }).click()
        await expect(page.getByLabel('Source range', { exact: true })).toHaveCount(0)
        // The only sheet tab is Sheet1; no "Pivot of Sheet1" was created.
        await expect(page.getByLabel(/^Sheet /)).toHaveCount(1)
    })

    test('pivot with row but no value field shows the error banner', async ({ page }) => {
        // Triggers PivotErrorCode='no-values' in lib/pivot/index.ts.
        // selectPivotGridViewState routes that to PivotBanner, which
        // exposes an "Edit pivot" CTA. Clicking it should open the
        // side panel.
        await navigateToPackage(page, 'calc')
        await openNewSpreadsheet(page)
        const formulaBar = page.getByRole('textbox', { name: 'Formula bar' })
        await seedTwoRegionsTwoRows(page, formulaBar)

        await createPivot(page, {
            sourceRange: 'Sheet1!A1:B3',
            targetSheetName: 'Errored',
        })
        // Add only a row field; values stays empty → engine returns
        // pivotError('no-values', ...). selectPivotGridViewState's
        // isPivotDefinitionEmpty returns false here (rows is non-
        // empty), so the view kind flips from 'empty' to 'error'.
        await page.getByLabel('Add Region to R').click()

        // Close the panel so the banner is the only visible affordance —
        // the "Edit pivot" CTA we want to test is otherwise crowded.
        await page.getByRole('button', { name: 'Close pivot panel' }).click()

        // Banner shows; click "Edit pivot" → panel re-opens.
        await expect(page.getByLabel('Pivot error')).toBeVisible({ timeout: 15_000 })
        await expect(page.getByText(/no value fields/i)).toBeVisible()
        await page.getByRole('button', { name: 'Edit pivot' }).click()
        await expect(page.getByText('Pivot editor', { exact: true })).toBeVisible()
    })

    test('renaming the pivot output sheet keeps the pivot resolved', async ({ page }) => {
        // use-pivot-for-sheet has a two-track resolver: explicit
        // PIVOT_SHEET_KEY meta + a targetSheetName fallback. Both
        // should survive a tab rename. Driving the rename via the
        // context-menu "Rename" item exercises the SheetTabsContextMenu
        // + RenameSheetInput integration the way a user would.
        await navigateToPackage(page, 'calc')
        await openNewSpreadsheet(page)
        const formulaBar = page.getByRole('textbox', { name: 'Formula bar' })
        await seedTwoRegionsTwoRows(page, formulaBar)

        await createPivot(page, {
            sourceRange: 'Sheet1!A1:B3',
            targetSheetName: 'BeforeRename',
        })
        await page.getByLabel('Add Region to R').click()
        await page.getByLabel('Add Sales to V').click()
        await expect(page.getByText('East', { exact: true })).toBeVisible({ timeout: 15_000 })

        // Right-click the tab to open SheetTabContextMenu, click
        // Rename — that swaps the tab label for an inline TextInput
        // (accessibilityLabel="Rename sheet").
        await page.getByLabel('Sheet BeforeRename').first().click({ button: 'right' })
        await page.getByRole('menuitem', { name: 'Rename', exact: true }).click()
        const renameInput = page.getByLabel('Rename sheet')
        await renameInput.fill('AfterRename')
        await renameInput.press('Enter')

        // New tab label appears, pivot output still renders because
        // findOwningPivot keeps resolving (either via PIVOT_SHEET_KEY
        // or the new name matching def.targetSheetName).
        await expect(page.getByLabel('Sheet AfterRename')).toBeVisible({ timeout: 15_000 })
        await expect(page.getByLabel('Sheet BeforeRename')).toHaveCount(0)
        await expect(page.getByText('East', { exact: true })).toBeVisible()
    })

    test('deleting the pivot output sheet removes the pivot from the workbook', async ({
        page,
    }) => {
        // Delete the pivot's dedicated output sheet via the tab
        // context menu. After confirmation, the tab is gone and the
        // workbook falls back to Sheet1. The pivot definition still
        // lives in PIVOTS_MAP, but there's no remaining sheet whose
        // PIVOT_SHEET_KEY or name matches it, so usePivotForSheet
        // returns null and the normal cell-grid renders for Sheet1.
        await navigateToPackage(page, 'calc')
        await openNewSpreadsheet(page)
        const formulaBar = page.getByRole('textbox', { name: 'Formula bar' })
        await seedTwoRegionsTwoRows(page, formulaBar)

        await createPivot(page, {
            sourceRange: 'Sheet1!A1:B3',
            targetSheetName: 'ToDelete',
        })
        await page.getByLabel('Add Region to R').click()
        await page.getByLabel('Add Sales to V').click()
        // Make sure the pivot fully rendered before we destroy its sheet.
        await expect(page.getByText('East', { exact: true })).toBeVisible({ timeout: 15_000 })

        // Right-click → Delete. The DeleteConfirm dialog only opens
        // when the sheet has stored cells; pivot output sheets are
        // rendered from the engine and store no cells themselves, so
        // SheetTabContextMenu.onDeleteRequest skips the confirm and
        // deletes immediately.
        await page.getByLabel('Sheet ToDelete').first().click({ button: 'right' })
        await page.getByRole('menuitem', { name: 'Delete', exact: true }).click()

        // The tab is gone; Sheet1 is the active sheet and shows the
        // original source data (Region/Sales headers).
        await expect(page.getByLabel('Sheet ToDelete')).toHaveCount(0)
        await expect(page.getByLabel('Cell A1', { exact: true })).toBeVisible({
            timeout: 15_000,
        })
        await expect(page.getByLabel('Cell A1', { exact: true })).toHaveText('Region')
    })

    test('undo a pivot creation removes the output sheet', async ({ page }) => {
        // PivotInsertButton wraps the sheet-create + writePivot in a
        // single LOCAL_ORIGIN transact, so the realtime undo manager
        // captures it as one step. After Cmd+Z (driven via the toolbar
        // Undo button — the keyboard shortcut races formula-bar focus
        // in calc, see the Find&Replace test for the same workaround),
        // the new sheet tab is gone and the workbook is back on
        // Sheet1.
        await navigateToPackage(page, 'calc')
        await openNewSpreadsheet(page)
        const formulaBar = page.getByRole('textbox', { name: 'Formula bar' })
        await seedTwoRegionsTwoRows(page, formulaBar)

        // Wait past the undo manager's 500ms capture-merge window so
        // the seed typing and the pivot creation land in distinct
        // undo steps. Without this, one Undo press would also revert
        // the typing.
        await page.waitForTimeout(600)

        await createPivot(page, {
            sourceRange: 'Sheet1!A1:B3',
            targetSheetName: 'WillUndo',
        })
        await expect(page.getByLabel('Sheet WillUndo')).toBeVisible({ timeout: 15_000 })

        // Grid branches: pivot sheets render PivotGrid without the
        // toolbar above them. Switch back to Sheet1 so the toolbar
        // Undo button is on screen.
        await page.getByLabel('Sheet Sheet1').first().click()
        await page.getByRole('button', { name: 'Undo' }).click()

        // Sheet tab is gone, Sheet1 is the active sheet, and the
        // source data is still intact.
        await expect(page.getByLabel('Sheet WillUndo')).toHaveCount(0)
        await expect(page.getByLabel('Sheet Sheet1')).toBeVisible()
        await expect(page.getByLabel('Cell A1', { exact: true })).toHaveText('Region')
    })
})

// Shared setup helpers — kept inline so each spec file is self-
// contained (e.g. running this file alone from a sibling repo's
// project layout doesn't pull in calc.spec.ts).

async function typeIntoCell(
    page: Page,
    formulaBar: import('@playwright/test').Locator,
    cellLabel: string,
    value: string
): Promise<void> {
    await page.getByLabel(`Cell ${cellLabel}`, { exact: true }).click()
    await formulaBar.fill(value)
    await formulaBar.press('Enter')
}

// Common 2-region seed used by several specs. Header row plus
// East=10, West=20. The pivot built off this exercises a row +
// value field with a non-trivial sum/avg/count split.
async function seedTwoRegionsTwoRows(
    page: Page,
    formulaBar: import('@playwright/test').Locator
): Promise<void> {
    await typeIntoCell(page, formulaBar, 'A1', 'Region')
    await typeIntoCell(page, formulaBar, 'B1', 'Sales')
    await typeIntoCell(page, formulaBar, 'A2', 'East')
    await typeIntoCell(page, formulaBar, 'B2', '10')
    await typeIntoCell(page, formulaBar, 'A3', 'West')
    await typeIntoCell(page, formulaBar, 'B3', '20')
}

// Click "New spreadsheet" on the calc index and wait for the workbook
// detail screen to mount. Mirrors the helper in calc.spec.ts — kept
// inline so this spec is self-contained.
async function openNewSpreadsheet(page: Page): Promise<void> {
    await expect(page.getByRole('heading', { level: 2, name: 'Calc' }).first()).toBeVisible({
        timeout: 30_000,
    })
    await page.getByRole('button', { name: 'New spreadsheet' }).click()
    await page.waitForURL(/\/calc\/[^/]+$/, { timeout: 75_000 })
    await expect(page.getByLabel('Cell A1', { exact: true })).toBeVisible({ timeout: 75_000 })
}

// Open the insert dialog, fill source range + target sheet name, and
// submit. After the dialog closes, the new sheet tab is visible and
// the side panel mounts (PivotInsertButton calls usePivotPanelStore
// .open after writing the def).
async function createPivot(
    page: Page,
    { sourceRange, targetSheetName }: { sourceRange: string; targetSheetName: string }
): Promise<void> {
    await page.getByRole('button', { name: 'Insert pivot table' }).click()
    const sourceInput = page.getByLabel('Source range', { exact: true })
    await expect(sourceInput).toBeVisible()
    await sourceInput.fill(sourceRange)
    const targetInput = page.getByLabel('New sheet name', { exact: true })
    await targetInput.fill(targetSheetName)
    await page.getByRole('button', { name: 'Create pivot table' }).click()
    await expect(page.getByLabel(`Sheet ${targetSheetName}`)).toBeVisible({ timeout: 15_000 })
}

