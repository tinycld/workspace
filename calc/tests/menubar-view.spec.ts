import { expect, test } from '@playwright/test'
import { login, navigateToPackage } from '../../../../tests/e2e/helpers'
import { openNewSpreadsheet } from './_menubar-helpers'

test.describe('Calc View menu', () => {
    test.setTimeout(120_000)
    test.beforeEach(async ({ page }) => {
        await login(page)
    })

    test('Freeze submenu lists row and column options', async ({ page }) => {
        await navigateToPackage(page, 'calc')
        await openNewSpreadsheet(page)

        await page.getByRole('button', { name: 'View', exact: true }).click()
        await page.getByRole('menuitem', { name: 'Freeze' }).hover()
        await expect(page.getByRole('menuitem', { name: '1 row' })).toBeVisible()
        await expect(page.getByRole('menuitem', { name: '1 column' })).toBeVisible()
        await expect(page.getByRole('menuitem', { name: 'Unfreeze' })).toBeVisible()
    })

    test('Hidden sheets submenu reads "(no hidden sheets)" when none', async ({ page }) => {
        await navigateToPackage(page, 'calc')
        await openNewSpreadsheet(page)

        await page.getByRole('button', { name: 'View', exact: true }).click()
        await page.getByRole('menuitem', { name: 'Hidden sheets' }).hover()
        await expect(page.getByRole('menuitem', { name: /no hidden sheets/i })).toBeVisible()
    })

    test('Show comments opens the comments drawer with empty state', async ({ page }) => {
        await navigateToPackage(page, 'calc')
        await openNewSpreadsheet(page)

        await page.getByRole('button', { name: 'View', exact: true }).click()
        await page.getByRole('menuitem', { name: 'Show comments' }).click()

        // Drawer header + the filter chips and empty-state copy. Filter
        // chips render their label+count inside a Pressable that doesn't
        // surface accessibilityLabel as an accessible name on web, so
        // text selectors are the most stable here.
        await expect(page.getByText('Comments', { exact: true })).toBeVisible()
        await expect(page.getByText('Open (0)')).toBeVisible()
        await expect(page.getByText(/No open comments/i)).toBeVisible()
    })
})
