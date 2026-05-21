import { expect, test } from '@playwright/test'
import { ORG_SLUG } from '../../../../tests/e2e/helpers'
import {
    EDITOR_REACTION_TIMEOUT,
    editorRoot,
    openFreshTextDocument,
    openMenubarMenu,
    TEXT_TEST_TIMEOUT,
} from './_menubar-helpers'

// Each spec opens its own fresh document — destructive items
// (Rename, Move to trash, Make a copy) would poison siblings if they
// shared one. Per-doc upload adds ~3-5s of overhead; we eat that for
// isolation.
test.describe('Text — Menubar', () => {
    test.setTimeout(TEXT_TEST_TIMEOUT)

    test.describe('File menu', () => {
        test('New document navigates to the text index', async ({ page }) => {
            await openFreshTextDocument(page, 'menubar-new')
            await openMenubarMenu(page, 'File')
            await page.getByRole('menuitem', { name: 'New document' }).click()
            await page.waitForURL(new RegExp(`/a/${ORG_SLUG}/text/?$`), { timeout: 15_000 })
        })

        test('Open navigates to drive', async ({ page }) => {
            await openFreshTextDocument(page, 'menubar-open')
            await openMenubarMenu(page, 'File')
            await page.getByRole('menuitem', { name: 'Open' }).click()
            await page.waitForURL(new RegExp(`/a/${ORG_SLUG}/drive`), { timeout: 15_000 })
        })

        test('Rename updates the document header', async ({ page }) => {
            await openFreshTextDocument(page, 'menubar-rename')

            await openMenubarMenu(page, 'File')
            await page.getByRole('menuitem', { name: 'Rename' }).click()

            // Rename now uses the in-app PromptDialog (not window.prompt):
            // a modal whose input carries accessibilityLabel=title
            // ("Rename"), and a "Rename" confirm button. Scope to that
            // input by name — `getByRole('textbox')` alone would match
            // the ProseMirror editor body, not the dialog field.
            const input = page.getByRole('textbox', { name: 'Rename' })
            await expect(input).toBeVisible({ timeout: 15_000 })
            await input.fill('Renamed Document')
            await page.getByRole('button', { name: 'Rename', exact: true }).click()

            // The header text lives in the topmost row's <Text> with
            // the document name; it's the first match for "Renamed
            // Document" on the page since the doc body contains the
            // fixture content, not this string.
            await expect(page.getByText('Renamed Document').first()).toBeVisible({
                timeout: 15_000,
            })
        })

        test('Make a copy opens the Choose a folder dialog', async ({ page }) => {
            await openFreshTextDocument(page, 'menubar-copy')

            await openMenubarMenu(page, 'File')
            await page.getByRole('menuitem', { name: 'Make a copy' }).click()

            // Make-a-copy now uses the in-app PromptDialog (was
            // window.prompt). Scope to the dialog input by its
            // accessibilityLabel (title "Make a copy"), then confirm.
            const input = page.getByRole('textbox', { name: 'Make a copy' })
            await expect(input).toBeVisible({ timeout: 15_000 })
            await input.fill('Copied Document')
            await page.getByRole('button', { name: 'Create copy' }).click()

            // makeCopy stashes the name + opens the CopyToFolderDialog
            // (drive's ChooseFolderDialog) titled `Copy "<name>" to` —
            // confirms the prompt → store → folder-picker wiring all the
            // way through. The copy itself fires when the user picks a
            // folder, which is drive's concern, not text's.
            await expect(page.getByText(/Copy "Copied Document" to/).first()).toBeVisible({
                timeout: 15_000,
            })
        })
    })

    test.describe('Edit menu', () => {
        test('Undo is enabled after typing into the document', async ({ page }) => {
            await openFreshTextDocument(page, 'menubar-undo')
            await editorRoot(page).click()
            await page.keyboard.press('End')
            await page.keyboard.type('typed-content')

            await openMenubarMenu(page, 'Edit')
            const undo = page.getByRole('menuitem', { name: /^Undo/ })
            await expect(undo).toBeVisible()
            await expect(undo).toBeEnabled()
        })

        test('Select all selects the entire document body', async ({ page }) => {
            await openFreshTextDocument(page, 'menubar-selectall')
            await editorRoot(page).click()

            await openMenubarMenu(page, 'Edit')
            await page.getByRole('menuitem', { name: 'Select all' }).click()

            // After Select All the browser-level selection should cover
            // the full editor — assert via document.getSelection() in
            // the page. We check that the selection has more than a
            // trivial amount of text (the fixture has multiple
            // paragraphs); the exact length is brittle, so we use a
            // generous lower bound.
            const selectionLength = await page.evaluate(() => {
                const sel = document.getSelection()
                return sel ? sel.toString().length : 0
            })
            expect(selectionLength).toBeGreaterThan(50)
        })
    })

    test.describe('Insert menu', () => {
        test('Link opens the link popover', async ({ page }) => {
            await openFreshTextDocument(page, 'menubar-link')
            await editorRoot(page).click()
            await page.keyboard.press('End')

            await openMenubarMenu(page, 'Insert')
            await page.getByRole('menuitem', { name: 'Link' }).click()

            // LinkPopover renders an "https://" URL input plus an
            // Insert button. Either is unambiguous; the placeholder is
            // the cheaper match.
            await expect(page.getByPlaceholder(/https?:\/\//)).toBeVisible({
                timeout: 10_000,
            })
        })

        test('Table > 3 × 3 inserts a 9-cell table into the document', async ({ page }) => {
            await openFreshTextDocument(page, 'menubar-table-insert')
            // The fixture renders multiple tables; wait for the
            // "Complex Tables" h3 so the pre-insert table set is fully
            // present before we snapshot the count.
            await expect(page.getByText('Complex Tables').first()).toBeVisible({
                timeout: 30_000,
            })

            const before = await editorRoot(page).locator('table').count()

            // Park the caret outside any existing table so insertTable
            // doesn't refuse (Tiptap silently no-ops inside a table).
            await editorRoot(page).click()
            await page.keyboard.press('End')
            await page.keyboard.press('Enter')

            await openMenubarMenu(page, 'Insert')
            await page.getByRole('menuitem', { name: 'Table' }).hover()
            await page.getByRole('menuitem', { name: '3 × 3' }).click()

            await expect(editorRoot(page).locator('table')).toHaveCount(before + 1, {
                timeout: 10_000,
            })

            // The new table should have exactly 9 cells (3 rows × 3
            // cols). Identify it by cell count — the fixture's tables
            // are 18 and 33 cells, so 9 is unambiguous.
            const cellCounts = await editorRoot(page)
                .locator('table')
                .evaluateAll(ts => ts.map(t => t.querySelectorAll('th,td').length))
            expect(cellCounts).toContain(9)
        })
    })

    test.describe('Format menu', () => {
        test('Text > Bold wraps typed content in <strong>', async ({ page }) => {
            await openFreshTextDocument(page, 'menubar-bold')
            await editorRoot(page).click()
            await page.keyboard.press('End')
            await page.keyboard.press('Enter')

            await openMenubarMenu(page, 'Format')
            await page.getByRole('menuitem', { name: 'Text' }).hover()
            await page.getByRole('menuitem', { name: /^Bold/ }).click()

            const marker = `bold-${Date.now()}`
            await page.keyboard.type(marker)

            // Tiptap renders Bold as <strong>. Find the marker inside
            // a <strong> element to confirm the mark applied.
            const strongMarker = editorRoot(page).locator('strong', { hasText: marker })
            await expect(strongMarker).toBeVisible({ timeout: EDITOR_REACTION_TIMEOUT })
        })

        test('Paragraph styles > Heading 2 promotes the current line to h2', async ({ page }) => {
            await openFreshTextDocument(page, 'menubar-h2')
            await editorRoot(page).click()
            await page.keyboard.press('End')
            await page.keyboard.press('Enter')

            const marker = `h2-${Date.now()}`
            await page.keyboard.type(marker)

            await openMenubarMenu(page, 'Format')
            await page.getByRole('menuitem', { name: 'Paragraph styles' }).hover()
            await page.getByRole('menuitem', { name: 'Heading 2', exact: true }).click()

            // Marker should now sit inside an <h2>.
            const h2Marker = editorRoot(page).locator('h2', { hasText: marker })
            await expect(h2Marker).toBeVisible({ timeout: EDITOR_REACTION_TIMEOUT })
        })

        test('Bullets & numbering > Bulleted list wraps the line in <ul><li>', async ({ page }) => {
            await openFreshTextDocument(page, 'menubar-bullets')
            await editorRoot(page).click()
            await page.keyboard.press('End')
            await page.keyboard.press('Enter')

            const marker = `bullet-${Date.now()}`
            await page.keyboard.type(marker)

            await openMenubarMenu(page, 'Format')
            await page.getByRole('menuitem', { name: 'Bullets & numbering' }).hover()
            await page.getByRole('menuitem', { name: 'Bulleted list' }).click()

            const liMarker = editorRoot(page).locator('ul li', { hasText: marker })
            await expect(liMarker).toBeVisible({ timeout: EDITOR_REACTION_TIMEOUT })
        })

        test('Table > row ops are disabled outside a table, enabled inside', async ({ page }) => {
            await openFreshTextDocument(page, 'menubar-table-ops')

            // Caret in the H1 = not in a table. Format > Table > Insert
            // row above should be visible but disabled.
            await editorRoot(page).click()
            await page.keyboard.press('Home')

            await openMenubarMenu(page, 'Format')
            await page.getByRole('menuitem', { name: 'Table' }).hover()
            const outsideItem = page.getByRole('menuitem', { name: 'Insert row above' })
            await expect(outsideItem).toBeVisible()
            await expect(outsideItem).toBeDisabled()

            // Dismiss the menu before continuing — keystrokes otherwise
            // go to the open menu rather than the editor.
            await page.keyboard.press('Escape')

            // Drop a fresh table at the end of the doc; the editor
            // parks the caret inside the new table automatically. This
            // is the same trick the table-toolbar spec uses; clicking
            // a stray <td> doesn't reliably propagate
            // toolbarState.isInTable through the ProseMirror selection.
            await editorRoot(page).click()
            await page.keyboard.press('End')
            await page.keyboard.press('Enter')
            await openMenubarMenu(page, 'Insert')
            await page.getByRole('menuitem', { name: 'Table' }).hover()
            await page.getByRole('menuitem', { name: '2 × 2' }).click()

            await openMenubarMenu(page, 'Format')
            await page.getByRole('menuitem', { name: 'Table' }).hover()
            const insideItem = page.getByRole('menuitem', { name: 'Insert row above' })
            await expect(insideItem).toBeVisible()
            await expect(insideItem).toBeEnabled()
        })
    })

    test.describe('Help menu', () => {
        test('three-item launcher set is present', async ({ page }) => {
            await openFreshTextDocument(page, 'menubar-help')
            await openMenubarMenu(page, 'Help')
            // The Help menu was trimmed to three launchers: the search
            // palette, the keyboard-shortcuts reference, and the
            // package's own topic-index drawer. The cross-package hub
            // moved off the menu — it's reachable from inside the
            // drawer via the "Read all tinycld help" link.
            await expect(page.getByRole('menuitem', { name: /Search help/ })).toBeVisible()
            await expect(page.getByRole('menuitem', { name: 'Keyboard shortcuts' })).toBeVisible()
            await expect(page.getByRole('menuitem', { name: 'Browse text help' })).toBeVisible()
        })
    })
})
