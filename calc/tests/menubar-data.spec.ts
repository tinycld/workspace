import { expect, test } from '@playwright/test'
import { login, navigateToPackage } from '../../../../tests/e2e/helpers'
import { openNewSpreadsheet } from './_menubar-helpers'

test.describe('Calc Data menu', () => {
    test.setTimeout(120_000)
    test.beforeEach(async ({ page }) => {
        await login(page)
    })

    test('Sort range opens the sort dialog', async ({ page }) => {
        await navigateToPackage(page, 'calc')
        await openNewSpreadsheet(page)

        await page.getByLabel('Cell A1', { exact: true }).click()
        await page.getByRole('button', { name: 'Data', exact: true }).click()
        await page.getByRole('menuitem', { name: 'Sort range' }).click()
        await expect(page.getByLabel('Sort range dialog')).toBeVisible()
    })

    test('Create a filter flips to Remove filter once active', async ({ page }) => {
        await navigateToPackage(page, 'calc')
        await openNewSpreadsheet(page)

        await page.getByLabel('Cell A1', { exact: true }).click()
        await page.getByRole('button', { name: 'Data', exact: true }).click()
        await page.getByRole('menuitem', { name: 'Create a filter' }).click()

        await page.getByRole('button', { name: 'Data', exact: true }).click()
        await expect(page.getByRole('menuitem', { name: 'Remove filter' })).toBeVisible()
    })
})
