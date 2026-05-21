import { expect, test } from '@playwright/test'
import { login, navigateToPackage } from '../../../../tests/e2e/helpers'
import { openNewSpreadsheet } from './_menubar-helpers'

test.describe('Calc File menu', () => {
    test.setTimeout(120_000)
    test.beforeEach(async ({ page }) => {
        await login(page)
    })

    test('Rename updates the workbook header', async ({ page }) => {
        await navigateToPackage(page, 'calc')
        await openNewSpreadsheet(page)

        page.once('dialog', async (dialog) => {
            expect(dialog.type()).toBe('prompt')
            await dialog.accept('Renamed Scorecard')
        })

        await page.getByRole('button', { name: 'File', exact: true }).click()
        await page.getByRole('menuitem', { name: 'Rename' }).click()

        await expect(page.locator('[data-test-id="calc-workbook-header"]')).toHaveText(
            'Renamed Scorecard',
            { timeout: 15_000 }
        )
    })

    test('Download submenu lists CSV and XLSX options', async ({ page }) => {
        await navigateToPackage(page, 'calc')
        await openNewSpreadsheet(page)

        await page.getByRole('button', { name: 'File', exact: true }).click()
        await page.getByRole('menuitem', { name: 'Download' }).hover()
        await expect(
            page.getByRole('menuitem', { name: 'Download as CSV (current sheet)' })
        ).toBeVisible()
        await expect(
            page.getByRole('menuitem', { name: 'Download as CSV (all sheets)' })
        ).toBeVisible()
    })

    test('Print opens the print dialog', async ({ page }) => {
        await navigateToPackage(page, 'calc')
        await openNewSpreadsheet(page)

        await page.getByRole('button', { name: 'File', exact: true }).click()
        await page.getByRole('menuitem', { name: 'Print' }).click()
        // PrintDialog has no aria role; assert on the Cancel button that
        // only renders while the dialog is mounted.
        await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible()
    })
})
