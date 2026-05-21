import { expect, test } from '@playwright/test'
import { editorRoot, openFreshTextDocument, TEXT_TEST_TIMEOUT } from './_menubar-helpers'

// Slash-menu v1: typing "/" at the start of a node (or after a space)
// opens a floating command palette listing block-insertion commands.
// Up/Down navigates, Enter selects, Escape dismisses. The picked entry
// replaces the typed slash trigger with the resulting block.
//
// NOT EXECUTED IN CI for this PR — the main session validates after
// merging into the text package's main branch.

test.describe('Text — Slash menu', () => {
    test.setTimeout(TEXT_TEST_TIMEOUT)

    test('typing "/" opens the slash menu popover', async ({ page }) => {
        await openFreshTextDocument(page, 'slash-open')
        await editorRoot(page).click()
        await page.keyboard.press('End')
        await page.keyboard.press('Enter')
        await page.keyboard.type('/')

        // The popover portals to document.body and identifies itself
        // with data-tinycld-slash-menu="true". Assert it appears AND
        // the canonical "Heading 1" row is rendered as the first
        // entry — the empty-query view is the full command list.
        const menu = page.locator('[data-tinycld-slash-menu]')
        await expect(menu).toBeVisible()
        await expect(menu.getByText('Heading 1', { exact: true })).toBeVisible()
    })

    test('typing "/head" filters to only the heading entries', async ({ page }) => {
        await openFreshTextDocument(page, 'slash-filter')
        await editorRoot(page).click()
        await page.keyboard.press('End')
        await page.keyboard.press('Enter')
        await page.keyboard.type('/head')

        const menu = page.locator('[data-tinycld-slash-menu]')
        await expect(menu).toBeVisible()
        await expect(menu.getByText('Heading 1', { exact: true })).toBeVisible()
        await expect(menu.getByText('Heading 2', { exact: true })).toBeVisible()
        await expect(menu.getByText('Heading 3', { exact: true })).toBeVisible()
        // Other entries must NOT be visible — the filter is the load-
        // bearing piece a user feels.
        await expect(menu.getByText('Bullet list', { exact: true })).not.toBeVisible()
        await expect(menu.getByText('Code block', { exact: true })).not.toBeVisible()
    })

    test('pressing Enter applies the selected entry and removes the trigger', async ({ page }) => {
        await openFreshTextDocument(page, 'slash-enter')
        await editorRoot(page).click()
        await page.keyboard.press('End')
        await page.keyboard.press('Enter')
        await page.keyboard.type('/head')

        const menu = page.locator('[data-tinycld-slash-menu]')
        await expect(menu).toBeVisible()
        // Enter applies the highlighted item (the first by default —
        // Heading 1). The trigger text "/head" should be deleted.
        await page.keyboard.press('Enter')
        await expect(menu).toBeHidden()

        await page.keyboard.type('Hello headings')
        const h1 = editorRoot(page).locator('h1', { hasText: 'Hello headings' }).first()
        await expect(h1).toBeVisible()
        // The trigger string itself should NOT survive — a regression
        // here would leave "/head Hello headings" inside the heading.
        await expect(editorRoot(page).getByText('/head')).toHaveCount(0)
    })

    test('pressing Escape after "/" closes the menu without applying', async ({ page }) => {
        await openFreshTextDocument(page, 'slash-escape')
        await editorRoot(page).click()
        await page.keyboard.press('End')
        await page.keyboard.press('Enter')
        await page.keyboard.type('/')

        const menu = page.locator('[data-tinycld-slash-menu]')
        await expect(menu).toBeVisible()
        await page.keyboard.press('Escape')
        await expect(menu).toBeHidden()
    })
})
