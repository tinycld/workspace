import { expect, test } from '@playwright/test'
import {
    EDITOR_REACTION_TIMEOUT,
    editorRoot,
    openFreshTextDocument,
    openMenubarMenu,
    TEXT_TEST_TIMEOUT,
} from './_menubar-helpers'

// Markdown text put on the clipboard and then routed through
// Edit → Paste as Markdown should land in the editor as structured PM
// content (headings, lists, strong marks) — not as a literal string of
// `# Heading\n- item` characters.
test.describe('Text — Markdown paste', () => {
    test.setTimeout(TEXT_TEST_TIMEOUT)

    test('Paste as Markdown entry is visible in the Edit menu', async ({ page }) => {
        await openFreshTextDocument(page, 'md-paste-visible')
        await openMenubarMenu(page, 'Edit')
        const item = page.getByRole('menuitem', { name: 'Paste as Markdown', exact: true })
        await expect(item).toBeVisible()
        await expect(item).toBeEnabled()
    })

    test('Paste as Markdown inserts structured content from the clipboard', async ({ page }) => {
        await openFreshTextDocument(page, 'md-paste-insert')

        // Clipboard read/write needs explicit permission grants under
        // headless Chromium. Both directions are needed: writeText to
        // seed the clipboard, readText so the menu handler can drain it.
        await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])

        // Focus the editor first so the subsequent writeText runs in a
        // page with a user-gesture-equivalent context (Playwright's
        // click event satisfies Chromium's transient activation check).
        await editorRoot(page).click()
        await page.keyboard.press('End')
        await page.keyboard.press('Enter')

        const MD = '# Hello from MD\n\n- one\n- two\n\n**bold word**\n'
        await page.evaluate(async text => {
            await navigator.clipboard.writeText(text)
        }, MD)

        await openMenubarMenu(page, 'Edit')
        await page.getByRole('menuitem', { name: 'Paste as Markdown', exact: true }).click()

        // Assert the parsed Markdown landed as live PM nodes inside the
        // editor: heading → <h1>, list → <ul><li>, **bold word** → <strong>.
        const h1 = editorRoot(page).locator('h1', { hasText: 'Hello from MD' }).first()
        await expect(h1).toBeVisible({ timeout: 15_000 })

        const ul = editorRoot(page)
            .locator('ul')
            .filter({
                has: page.locator('li', { hasText: 'one' }),
            })
            .first()
        await expect(ul).toBeVisible({ timeout: 15_000 })
        await expect(ul.locator('li')).toHaveCount(2, { timeout: EDITOR_REACTION_TIMEOUT })

        const strong = editorRoot(page).locator('strong', { hasText: 'bold word' }).first()
        await expect(strong).toBeVisible({ timeout: EDITOR_REACTION_TIMEOUT })
    })
})
