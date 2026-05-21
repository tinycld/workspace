import { expect, test } from '@playwright/test'
import { editorRoot, openFreshTextDocument, TEXT_TEST_TIMEOUT } from './_menubar-helpers'

// Code blocks + inline code v1: the toolbar gains an "Inline code"
// toggle (wraps a selection in <code>) and a "Code block" toggle
// (wraps the active paragraph in <pre><code>). DOCX round-trip is
// covered by Go unit tests in server/translate/code_block_test.go;
// this spec exercises only the editor-side UI wiring.
//
// NOT EXECUTED IN CI for this PR — listed for future runs once we
// stabilise the realtime / Playwright harness for the new affordances.

test.describe('Text — Code blocks & inline code', () => {
    test.setTimeout(TEXT_TEST_TIMEOUT)

    test('clicking Inline code wraps the selection in <code>', async ({ page }) => {
        await openFreshTextDocument(page, 'inline-code')
        await editorRoot(page).click()
        await page.keyboard.press('End')
        await page.keyboard.press('Enter')
        const marker = `verbatim-${Date.now()}`
        await page.keyboard.type(marker)

        // Select the just-typed text. ProseMirror's select-by-keypress
        // covers the typed range without needing mouse coordinates.
        for (let i = 0; i < marker.length; i++) {
            await page.keyboard.press('Shift+ArrowLeft')
        }

        await page.getByRole('button', { name: 'Inline code', exact: true }).click()

        const codeRun = editorRoot(page).locator('code', { hasText: marker }).first()
        await expect(codeRun).toBeVisible()
    })

    test('clicking Code block wraps the paragraph in <pre><code>', async ({ page }) => {
        await openFreshTextDocument(page, 'code-block')
        await editorRoot(page).click()
        await page.keyboard.press('End')
        await page.keyboard.press('Enter')
        const marker = `block-${Date.now()}`
        await page.keyboard.type(marker)

        await page.getByRole('button', { name: 'Code block', exact: true }).click()

        // Tiptap's CodeBlock renders <pre><code>…</code></pre>. We
        // anchor on the <pre> > <code> tree so a stray inline-code
        // mark on the same line can't satisfy the assertion.
        const block = editorRoot(page).locator('pre > code', { hasText: marker }).first()
        await expect(block).toBeVisible()
    })

    test('typing "```" + Enter creates a code block via the StarterKit input rule', async ({
        page,
    }) => {
        // Tiptap's CodeBlock extension ships an input rule that turns
        // ``` at the start of a paragraph (followed by Enter) into a
        // codeBlock node. The rule fires synchronously on key press,
        // so we just type the marker and press Enter.
        await openFreshTextDocument(page, 'code-block-shortcut')
        await editorRoot(page).click()
        await page.keyboard.press('End')
        await page.keyboard.press('Enter')
        await page.keyboard.type('```')
        await page.keyboard.press('Enter')
        const marker = `triple-${Date.now()}`
        await page.keyboard.type(marker)

        const block = editorRoot(page).locator('pre > code', { hasText: marker }).first()
        await expect(block).toBeVisible()
    })
})
