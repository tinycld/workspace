import { expect, type Page } from '@playwright/test'

// openNewSpreadsheet creates a fresh workbook and waits for the Grid
// to mount. The menubar specs each open their own workbook rather than
// sharing the seeded `Team Scorecard.xlsx` so a destructive test (e.g.
// Rename, Move to trash) can't poison sibling tests that run later in
// the same DB.
export async function openNewSpreadsheet(page: Page): Promise<void> {
    await expect(page.getByRole('heading', { level: 2, name: 'Calc' }).first()).toBeVisible({
        timeout: 30_000,
    })
    await page.getByRole('button', { name: 'New spreadsheet' }).click()
    await page.waitForURL(/\/calc\/[^/]+$/, { timeout: 75_000 })
    await expect(page.getByLabel('Cell A1', { exact: true })).toBeVisible({ timeout: 75_000 })
}
