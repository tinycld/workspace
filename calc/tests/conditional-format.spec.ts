import { expect, test } from '@playwright/test'
import { login, navigateToPackage } from '../../../../tests/e2e/helpers'
import { openNewSpreadsheet } from './_menubar-helpers'

test.describe('Calc conditional formatting', () => {
    test.setTimeout(120_000)
    test.beforeEach(async ({ page }) => {
        await login(page)
    })

    test('opens the panel from the Format menu and shows the empty state', async ({ page }) => {
        await navigateToPackage(page, 'calc')
        await openNewSpreadsheet(page)

        await page.getByRole('button', { name: 'Format', exact: true }).click()
        await page
            .getByRole('menuitem', { name: /Conditional formatting/ })
            .click()

        // The empty state text appears in the drawer.
        await expect(
            page.getByText(/No rules yet/)
        ).toBeVisible()
    })

    test('greater-than rule colors matching cells', async ({ page }) => {
        await navigateToPackage(page, 'calc')
        await openNewSpreadsheet(page)

        // Seed A1 with a value above the upcoming threshold.
        await page.getByLabel('Cell A1', { exact: true }).click()
        await page.keyboard.type('100')
        await page.keyboard.press('Enter')
        await page.getByLabel('Cell B1', { exact: true }).click()
        await page.getByLabel('Cell A1', { exact: true }).click()

        await page.getByRole('button', { name: 'Format', exact: true }).click()
        await page
            .getByRole('menuitem', { name: /Conditional formatting/ })
            .click()
        await page.getByLabel('Add rule', { exact: true }).click()

        // Open the condition picker and pick Greater than.
        await page.getByLabel('Choose condition', { exact: true }).click()
        await page
            .getByRole('menuitem', { name: 'Greater than', exact: true })
            .click()

        // Operand input now appears for the chosen condition.
        await page.locator('input[placeholder="0"]').fill('50')
        await page.getByLabel('Done', { exact: true }).click()

        const readBg = (label: string) =>
            page.evaluate((l) => {
                const cell = document.querySelector(`[aria-label="${l}"]`)
                return cell == null ? null : getComputedStyle(cell as Element).backgroundColor
            }, label)

        // A1 = 100 > 50, should pick up the rule's fill.
        await expect.poll(() => readBg('Cell A1')).not.toBe('rgba(0, 0, 0, 0)')
    })

    test('isNotEmpty rule fills non-empty cells', async ({ page }) => {
        await navigateToPackage(page, 'calc')
        await openNewSpreadsheet(page)

        // Type a value into A1 so the rule has something to bind to.
        await page.getByLabel('Cell A1', { exact: true }).click()
        await page.keyboard.type('100')
        await page.keyboard.press('Enter')
        // Click away to a known cell so the editor commits and we're
        // back in cell-select mode (not editor mode).
        await page.getByLabel('Cell B1', { exact: true }).click()

        // Re-select A1 so the panel opens with that as the default
        // range.
        await page.getByLabel('Cell A1', { exact: true }).click()

        await page.getByRole('button', { name: 'Format', exact: true }).click()
        await page
            .getByRole('menuitem', { name: /Conditional formatting/ })
            .click()

        // The drawer's empty state has an "Add another rule" trigger.
        // RN-Web Pressable renders as a generic with aria-label rather
        // than role=button, so locate via the accessibility label.
        await page.getByLabel('Add rule', { exact: true }).click()

        // Draft default condition is "Cell is not empty" — the
        // fill applies as soon as we click Done, no operand needed.
        await page.getByLabel('Done', { exact: true }).click()

        // A1 contains "100", so it should pick up the rule's
        // non-transparent fill. RN-Web spreads `backgroundColor` onto
        // the cell wrapper.
        const readBg = (label: string) =>
            page.evaluate((l) => {
                const cell = document.querySelector(`[aria-label="${l}"]`)
                return cell == null ? null : getComputedStyle(cell as Element).backgroundColor
            }, label)

        await expect.poll(() => readBg('Cell A1')).not.toBe('rgba(0, 0, 0, 0)')
    })
})
