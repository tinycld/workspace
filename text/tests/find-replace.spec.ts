import { expect, test } from '@playwright/test'
import { editorRoot, openFreshTextDocument, TEXT_TEST_TIMEOUT } from './_menubar-helpers'

// E2E for the Cmd+F find/replace bar. Each scenario opens its own
// document so the replace-all spec doesn't poison the others.
test.describe('Text — Find/Replace', () => {
    test.setTimeout(TEXT_TEST_TIMEOUT)

    test('Cmd+F opens the find bar focused on the find input', async ({ page }) => {
        await openFreshTextDocument(page, 'findreplace-open')
        await editorRoot(page).click()

        const meta = process.platform === 'darwin' ? 'Meta' : 'Control'
        await page.keyboard.down(meta)
        await page.keyboard.press('f')
        await page.keyboard.up(meta)

        const findInput = page.getByRole('textbox', { name: 'Find' })
        await expect(findInput).toBeVisible()
        await expect(findInput).toBeFocused()
    })

    test('Escape closes the bar', async ({ page }) => {
        await openFreshTextDocument(page, 'findreplace-escape')
        await editorRoot(page).click()
        const meta = process.platform === 'darwin' ? 'Meta' : 'Control'
        await page.keyboard.down(meta)
        await page.keyboard.press('f')
        await page.keyboard.up(meta)

        await expect(page.getByRole('textbox', { name: 'Find' })).toBeVisible()
        await page.keyboard.press('Escape')
        await expect(page.getByRole('textbox', { name: 'Find' })).not.toBeVisible()
    })

    test('Enter cycles to the next match', async ({ page }) => {
        await openFreshTextDocument(page, 'findreplace-cycle')
        await editorRoot(page).click()
        const meta = process.platform === 'darwin' ? 'Meta' : 'Control'
        await page.keyboard.down(meta)
        await page.keyboard.press('f')
        await page.keyboard.up(meta)

        const findInput = page.getByRole('textbox', { name: 'Find' })
        // The feature-test fixture contains the heading "Sample Document"
        // plus a body run that repeats "the". Either of those gives us
        // multiple hits to cycle through.
        await findInput.fill('the')
        // The .text-find-match-active decoration is painted on the
        // currently focused match.
        await expect(page.locator('.text-find-match-active').first()).toBeVisible()
        await findInput.press('Enter')
        await expect(page.locator('.text-find-match-active').first()).toBeVisible()
    })

    test('Replace all swaps every match with the replacement', async ({ page }) => {
        await openFreshTextDocument(page, 'findreplace-replaceall')
        await editorRoot(page).click()
        const meta = process.platform === 'darwin' ? 'Meta' : 'Control'
        await page.keyboard.down(meta)
        await page.keyboard.press('f')
        await page.keyboard.up(meta)

        await page.getByRole('textbox', { name: 'Find' }).fill('Sample')
        await page.getByRole('textbox', { name: 'Replace' }).fill('Replaced')
        await page.getByRole('button', { name: 'Replace all' }).click()

        await expect(page.getByText('Replaced Document').first()).toBeVisible({ timeout: 10_000 })
    })
})
