import { expect, test } from '@playwright/test'
import { login, navigateToPackage } from '../../../../tests/e2e/helpers'
import { openNewSpreadsheet } from './_menubar-helpers'

test.describe('Calc Edit menu', () => {
    test.setTimeout(120_000)
    test.beforeEach(async ({ page }) => {
        await login(page)
    })

    test('Undo is disabled on a freshly-opened workbook', async ({ page }) => {
        await navigateToPackage(page, 'calc')
        await openNewSpreadsheet(page)

        await page.getByRole('button', { name: 'Edit', exact: true }).click()
        const undo = page.getByRole('menuitem', { name: /Undo/ })
        await expect(undo).toBeVisible()
        await expect(undo).toBeDisabled()
    })

    test('Find and replace opens the find overlay', async ({ page }) => {
        await navigateToPackage(page, 'calc')
        await openNewSpreadsheet(page)

        await page.getByRole('button', { name: 'Edit', exact: true }).click()
        await page.getByRole('menuitem', { name: 'Find and replace' }).click()
        await expect(page.getByPlaceholder('Find')).toBeVisible()
    })

    test('Paste special exposes Values only and Format only', async ({ page }) => {
        await navigateToPackage(page, 'calc')
        await openNewSpreadsheet(page)

        await page.getByRole('button', { name: 'Edit', exact: true }).click()
        await page.getByRole('menuitem', { name: 'Paste special' }).hover()
        await expect(page.getByRole('menuitem', { name: 'Values only' })).toBeVisible()
        await expect(page.getByRole('menuitem', { name: 'Format only' })).toBeVisible()
    })
})
