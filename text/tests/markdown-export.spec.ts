import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import {
    editorRoot,
    FEATURE_DOC_HEADING,
    openFreshTextDocument,
    openMenubarMenu,
    TEXT_TEST_TIMEOUT,
} from './_menubar-helpers'

// Each scenario opens its own fresh document — the download path reads
// live Tiptap state, so isolating per-spec keeps the asserted file
// contents predictable across parallel runners.
test.describe('Text — Markdown export', () => {
    test.setTimeout(TEXT_TEST_TIMEOUT)

    test('Download (.md) entry is visible in the File menu', async ({ page }) => {
        await openFreshTextDocument(page, 'md-export-visible')
        await openMenubarMenu(page, 'File')
        const item = page.getByRole('menuitem', { name: 'Download (.md)', exact: true })
        await expect(item).toBeVisible()
        await expect(item).toBeEnabled()
    })

    test('Download (.md) triggers a .md file download with markdown content', async ({ page }) => {
        await openFreshTextDocument(page, 'md-export-trigger')

        const downloadPromise = page.waitForEvent('download')
        await openMenubarMenu(page, 'File')
        await page.getByRole('menuitem', { name: 'Download (.md)', exact: true }).click()
        const download = await downloadPromise

        expect(download.suggestedFilename()).toMatch(/\.md$/)

        const path = await download.path()
        expect(path).not.toBeNull()
        const content = path ? await readFile(path, 'utf8') : ''
        expect(content.length).toBeGreaterThan(0)
        // The seed doc heading "Sample Document" should appear as an
        // ATX heading at any level the importer chose (h1..h6). The
        // exporter emits one `#` per heading level then a space then
        // the text on its own line.
        const headingRegex = new RegExp(`^#{1,6} ${FEATURE_DOC_HEADING}$`, 'm')
        expect(content).toMatch(headingRegex)
    })

    test('Download (.md) includes content typed into the editor', async ({ page }) => {
        await openFreshTextDocument(page, 'md-export-typed')

        // Park the caret at the end of the document body and add a new
        // paragraph carrying a unique marker. We then download and
        // assert the marker survives the PM → Markdown serialisation.
        await editorRoot(page).click()
        await page.keyboard.press('End')
        await page.keyboard.press('Enter')
        const marker = `mdtyped-${Date.now()}`
        await page.keyboard.type(marker)

        const downloadPromise = page.waitForEvent('download')
        await openMenubarMenu(page, 'File')
        await page.getByRole('menuitem', { name: 'Download (.md)', exact: true }).click()
        const download = await downloadPromise

        expect(download.suggestedFilename()).toMatch(/\.md$/)
        const path = await download.path()
        const content = path ? await readFile(path, 'utf8') : ''
        const headingRegex = new RegExp(`^#{1,6} ${FEATURE_DOC_HEADING}$`, 'm')
        expect(content).toMatch(headingRegex)
        expect(content).toContain(marker)
    })
})
