import { expect, test } from '@playwright/test'
import { editorRoot, openFreshTextDocument, TEXT_TEST_TIMEOUT } from './_menubar-helpers'

// Font size + family v1: the toolbar exposes two dropdowns at the
// left edge — a family picker and a size picker. Selecting an option
// applies a textStyle mark (fontFamily / fontSize) to the current
// selection, which Tiptap renders as an inline-styled <span>. The
// DOCX round-trip is covered by Go unit tests in
// server/translate/font_size_family_test.go.
//
// NOT EXECUTED IN CI for this PR — listed for future runs once the
// realtime / Playwright harness covers font controls.

test.describe('Text — Font size & family', () => {
    test.setTimeout(TEXT_TEST_TIMEOUT)

    test('picking 24 from the font-size dropdown applies font-size:24px inline', async ({
        page,
    }) => {
        await openFreshTextDocument(page, 'font-size')
        await editorRoot(page).click()
        await page.keyboard.press('End')
        await page.keyboard.press('Enter')
        const marker = `fs-${Date.now()}`
        await page.keyboard.type(marker)
        // Select the word we just typed so the textStyle mark lands
        // on a non-empty range.
        await page.keyboard.press('Shift+Home')

        await page.getByRole('button', { name: 'Font size', exact: true }).click()
        await page.getByRole('button', { name: 'Font size 24', exact: true }).click()

        // Tiptap's FontSize extension wraps the run in a <span
        // style="font-size: 24px">.
        const styledSpan = editorRoot(page).locator(`span:has-text("${marker}")`).first()
        await expect(styledSpan).toHaveAttribute('style', /font-size:\s*24px/)
    })

    test('picking Georgia from the font-family dropdown applies font-family inline', async ({
        page,
    }) => {
        await openFreshTextDocument(page, 'font-family')
        await editorRoot(page).click()
        await page.keyboard.press('End')
        await page.keyboard.press('Enter')
        const marker = `ff-${Date.now()}`
        await page.keyboard.type(marker)
        await page.keyboard.press('Shift+Home')

        await page.getByRole('button', { name: 'Font family', exact: true }).click()
        await page.getByRole('button', { name: 'Font Georgia', exact: true }).click()

        // The picker stores bare family names ("Georgia") on the textStyle
        // mark — fallback chains are a render-time concern, not stored data,
        // so the inline style on the span is just "font-family: Georgia".
        const styledSpan = editorRoot(page).locator(`span:has-text("${marker}")`).first()
        await expect(styledSpan).toHaveAttribute('style', /font-family:\s*Georgia/)
    })
})
