import { expect, test } from '@playwright/test'
import { login, navigateToPackage } from '../../../../tests/e2e/helpers'
import { openNewSpreadsheet } from './_menubar-helpers'

test.describe('Calc toolbar (slimmed)', () => {
    test.setTimeout(120_000)
    test.beforeEach(async ({ page }) => {
        await login(page)
    })

    test('Toolbar no longer renders Sort/Filter/Merge/Freeze/Download/Print', async ({ page }) => {
        await navigateToPackage(page, 'calc')
        await openNewSpreadsheet(page)

        const toolbar = page.locator('[data-test-id="calc-toolbar"]')
        await expect(toolbar).toBeVisible()

        await expect(toolbar.getByLabel('Sort range')).toHaveCount(0)
        await expect(toolbar.getByLabel('Create filter')).toHaveCount(0)
        await expect(toolbar.getByLabel('Remove filter')).toHaveCount(0)
        await expect(toolbar.getByLabel('Merge cells')).toHaveCount(0)
        await expect(toolbar.getByLabel('Freeze')).toHaveCount(0)
        await expect(toolbar.getByLabel('Download')).toHaveCount(0)
        await expect(toolbar.getByLabel('Print')).toHaveCount(0)
    })

    test('Toolbar still shows Bold / Italic / Find and replace', async ({ page }) => {
        await navigateToPackage(page, 'calc')
        await openNewSpreadsheet(page)

        const toolbar = page.locator('[data-test-id="calc-toolbar"]')
        await expect(toolbar).toBeVisible()

        await expect(toolbar.getByLabel('Bold')).toBeVisible()
        await expect(toolbar.getByLabel('Italic')).toBeVisible()
        await expect(toolbar.getByLabel('Find and replace')).toBeVisible()
    })
})
