import { expect, test } from '@playwright/test'
import { login, navigateToPackage } from '../../../../tests/e2e/helpers'
import { openNewSpreadsheet } from './_menubar-helpers'

test.describe('Calc Format menu', () => {
    test.setTimeout(120_000)
    test.beforeEach(async ({ page }) => {
        await login(page)
    })

    test('Clear formatting wipes a styled cell', async ({ page }) => {
        await navigateToPackage(page, 'calc')
        await openNewSpreadsheet(page)

        const a1 = page.getByLabel('Cell A1', { exact: true })
        await a1.click()
        await page.keyboard.press('Meta+B')

        // RN-Web compiles textStyle.fontWeight = 'bold' to inline style on
        // the inner text node (a div), not the cell wrapper. Match the
        // canonical bold-verification pattern from calc.spec.ts.
        const readInnerFontWeight = async () =>
            page.evaluate(() => {
                const cell = document.querySelector('[aria-label="Cell A1"]')
                const text = cell?.querySelector('div')
                return text == null ? null : getComputedStyle(text).fontWeight
            })

        await expect.poll(readInnerFontWeight).toBe('700')

        await page.getByRole('button', { name: 'Format', exact: true }).click()
        await page.getByRole('menuitem', { name: 'Clear formatting' }).click()

        await expect.poll(readInnerFontWeight).not.toBe('700')
    })

    test('Text submenu lists Bold, Italic, Underline, Strikethrough', async ({ page }) => {
        await navigateToPackage(page, 'calc')
        await openNewSpreadsheet(page)

        await page.getByLabel('Cell A1', { exact: true }).click()
        await page.getByRole('button', { name: 'Format', exact: true }).click()
        await page.getByRole('menuitem', { name: 'Text' }).hover()
        await expect(page.getByRole('menuitem', { name: /Bold/ })).toBeVisible()
        await expect(page.getByRole('menuitem', { name: /Italic/ })).toBeVisible()
        await expect(page.getByRole('menuitem', { name: /Underline/ })).toBeVisible()
        await expect(page.getByRole('menuitem', { name: /Strikethrough/ })).toBeVisible()
    })
})
