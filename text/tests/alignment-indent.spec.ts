import { expect, test } from '@playwright/test'
import {
    EDITOR_REACTION_TIMEOUT,
    editorRoot,
    openFreshTextDocument,
    TEXT_TEST_TIMEOUT,
} from './_menubar-helpers'

// Alignment + indent v1: paragraphs (and headings) can be aligned
// left / center / right / justify and their left-indent level can
// be nudged up / down by one. This spec exercises the editor-side
// commands; the DOCX round-trip is covered by Go unit tests in
// server/translate/alignment_indent_test.go.

test.describe('Text — Alignment & indent', () => {
    test.setTimeout(TEXT_TEST_TIMEOUT)

    test('clicking Center alignment applies text-align:center to the paragraph', async ({
        page,
    }) => {
        await openFreshTextDocument(page, 'alignment')
        await editorRoot(page).click()
        // openFreshTextDocument lands the caret somewhere in the fixture
        // body; press End + Enter to start a new paragraph after the
        // existing content so our typed text lands in a fresh <p>.
        await page.keyboard.press('End')
        await page.keyboard.press('Enter')
        const marker = `align-center-${Date.now()}`
        await page.keyboard.type(marker)

        await page.getByRole('button', { name: 'Align center', exact: true }).click()

        // The TextAlign extension renders inline style="text-align: center"
        // onto the surrounding <p>. The marker isolates our paragraph
        // from the fixture's existing content.
        const paragraph = editorRoot(page).locator('p', { hasText: marker }).first()
        await expect(paragraph).toHaveAttribute('style', /text-align:\s*center/)
    })

    test('clicking Increase indent twice indents the paragraph by two levels', async ({ page }) => {
        await openFreshTextDocument(page, 'indent')
        await editorRoot(page).click()
        await page.keyboard.press('End')
        await page.keyboard.press('Enter')
        const marker = `indent-${Date.now()}`
        await page.keyboard.type(marker)

        const indentBtn = page.getByRole('button', { name: 'Increase indent', exact: true })
        await indentBtn.click()
        await indentBtn.click()

        // BlockIndent renders data-indent + padding-inline-start as
        // inline style. data-indent is the easier assertion target
        // because the style attribute may include other declarations.
        const paragraph = editorRoot(page).locator('p', { hasText: marker }).first()
        await expect(paragraph).toHaveAttribute('data-indent', '2')
    })

    test('Cmd+Shift+R applies right alignment via keyboard shortcut', async ({ page }) => {
        await openFreshTextDocument(page, 'right-shortcut')
        await editorRoot(page).click()
        await page.keyboard.press('End')
        await page.keyboard.press('Enter')
        const marker = `right-shortcut-${Date.now()}`
        await page.keyboard.type(marker)

        // Mod-Shift-R is bound by @tiptap/extension-text-align directly;
        // we don't need to dispatch through the toolbar. ProseMirror maps
        // `Mod` to Cmd on macOS and Ctrl elsewhere — so the keystroke must
        // use the platform modifier. Hardcoding Meta passed locally (macOS)
        // but never fired on Linux CI, leaving the paragraph unaligned.
        const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
        await page.keyboard.press(`${mod}+Shift+R`)

        const paragraph = editorRoot(page).locator('p', { hasText: marker }).first()
        await expect(paragraph).toHaveAttribute('style', /text-align:\s*right/, {
            timeout: EDITOR_REACTION_TIMEOUT,
        })
    })
})
