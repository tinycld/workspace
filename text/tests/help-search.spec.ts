import { expect, test } from '@playwright/test'
import { editorRoot, openFreshTextDocument, TEXT_TEST_TIMEOUT } from './_menubar-helpers'

// Help search palette: Cmd+/ opens a global topic-search overlay.
// Typing filters by title + summary across every linked package's
// help topics; Enter routes through openHelp() which surfaces the
// topic in the existing help drawer; Esc dismisses.
//
// NOT EXECUTED IN CI for this PR — the main session validates after
// merging into the text package's main branch.

test.describe('Text — Help search palette', () => {
    test.setTimeout(TEXT_TEST_TIMEOUT)

    test('Cmd+/ opens the palette and Esc dismisses it', async ({ page }) => {
        await openFreshTextDocument(page, 'help-search-open')
        await editorRoot(page).click()

        await page.keyboard.press('Meta+/')

        const palette = page.locator('[data-tinycld-help-palette]')
        await expect(palette).toBeVisible()
        await expect(palette.getByPlaceholder('Search help topics…')).toBeFocused()

        await page.keyboard.press('Escape')
        await expect(palette).not.toBeVisible()
    })

    test('typing "shading" surfaces the cell-shading topic at the top', async ({ page }) => {
        await openFreshTextDocument(page, 'help-search-shading')
        await editorRoot(page).click()
        await page.keyboard.press('Meta+/')

        const palette = page.locator('[data-tinycld-help-palette]')
        await expect(palette).toBeVisible()

        await page.keyboard.type('shading')

        // The first row (selected by default) should be the cell-shading
        // topic — title contains "shading" at a word boundary.
        const firstRow = palette.getByRole('option').first()
        await expect(firstRow).toContainText(/shading/i)
    })

    test('pressing Enter opens the selected topic in the help drawer', async ({ page }) => {
        await openFreshTextDocument(page, 'help-search-enter')
        await editorRoot(page).click()
        await page.keyboard.press('Meta+/')

        await page.keyboard.type('shading')
        await page.keyboard.press('Enter')

        // The palette dismisses and the help drawer surfaces with the
        // matched topic. The drawer renders the topic title in a Text
        // (not a semantic heading), so locate by text — "Shading table
        // cells" is the title of the text:table-shading topic.
        const palette = page.locator('[data-tinycld-help-palette]')
        await expect(palette).not.toBeVisible()
        await expect(page.getByText(/Shading table cells/i).first()).toBeVisible()
    })
})
