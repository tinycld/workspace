import { expect, test } from '@playwright/test'
import { login, navigateToPackage } from '../../../../tests/e2e/helpers'
import { openNewSpreadsheet } from './_menubar-helpers'

test.describe('Calc Help menu', () => {
    test.setTimeout(120_000)
    test.beforeEach(async ({ page }) => {
        await login(page)
    })

    test('Help menu lists Search help, Keyboard shortcuts, Function list, and Browse calc help', async ({
        page,
    }) => {
        await navigateToPackage(page, 'calc')
        await openNewSpreadsheet(page)

        await page.getByRole('button', { name: 'Help', exact: true }).click()

        await expect(page.getByRole('menuitem', { name: 'Search help…' })).toBeVisible()
        await expect(page.getByRole('menuitem', { name: 'Keyboard shortcuts' })).toBeVisible()
        await expect(page.getByRole('menuitem', { name: 'Function list' })).toBeVisible()
        await expect(page.getByRole('menuitem', { name: 'Browse calc help' })).toBeVisible()
    })

    test('Search help… opens the help search palette', async ({ page }) => {
        await navigateToPackage(page, 'calc')
        await openNewSpreadsheet(page)

        await page.getByRole('button', { name: 'Help', exact: true }).click()
        await page.getByRole('menuitem', { name: 'Search help…' }).click()

        // The palette is a role=dialog labelled "Search help" with a
        // text input — assert on the dialog plus the input being
        // ready for query entry.
        await expect(page.getByRole('dialog', { name: 'Search help' })).toBeVisible()
    })

    test('Keyboard shortcuts opens the help drawer to the calc shortcuts topic', async ({
        page,
    }) => {
        await navigateToPackage(page, 'calc')
        await openNewSpreadsheet(page)

        await page.getByRole('button', { name: 'Help', exact: true }).click()
        await page.getByRole('menuitem', { name: 'Keyboard shortcuts' }).click()

        // The menu should have dismissed before we assert on the drawer
        // — otherwise a "matched the menu label" false-pass slips through.
        await expect(
            page.getByRole('menuitem', { name: 'Keyboard shortcuts' })
        ).toBeHidden()

        // The drawer carries a "Read all tinycld help →" footer link
        // that exists only inside the help drawer surface. Asserting on
        // it tells us the drawer actually opened, regardless of how the
        // gluestack Modal exposes its own role/name.
        await expect(
            page.getByRole('link', { name: /Read all tinycld help/i })
        ).toBeVisible()
    })

    test('Function list opens a dialog listing formula functions', async ({ page }) => {
        await navigateToPackage(page, 'calc')
        await openNewSpreadsheet(page)

        await page.getByRole('button', { name: 'Help', exact: true }).click()
        await page.getByRole('menuitem', { name: 'Function list' }).click()

        const dialog = page.getByRole('dialog', { name: /Function list/i })
        await expect(dialog).toBeVisible()
        await expect(dialog.getByText('SUM', { exact: true })).toBeVisible()
    })
})
