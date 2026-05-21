import { expect, test } from '@playwright/test'
import { editorRoot, openFreshTextDocument, TEXT_TEST_TIMEOUT } from './_menubar-helpers'

// The toolbar's "Insert image" button used to embed picked images as
// base64 data: URIs into the Y.Doc, causing every collaborator's
// realtime update payload to balloon by the full image size. It now
// mirrors the paste/drop path — upload to drive, insert the resulting
// PocketBase file URL. This spec proves the button's inserted <img>
// carries a `/api/files/drive_items/...` src, not a `data:` URI.

// 1x1 transparent PNG. Small enough that the upload + Y.Doc round trip
// is dominated by network setup rather than payload size.
const PNG_1x1_BASE64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

function makePngBuffer(): Buffer {
    return Buffer.from(PNG_1x1_BASE64, 'base64')
}

test.describe('Text — Toolbar image insert', () => {
    test.setTimeout(TEXT_TEST_TIMEOUT)

    test('toolbar Insert image uploads to drive and inserts a /api/files URL', async ({ page }) => {
        await openFreshTextDocument(page, 'toolbar-image-insert')

        // Park the caret inside the editor so insertImage has a valid
        // insertion point. The Tiptap setImage command no-ops without
        // a live selection.
        await editorRoot(page).click()
        await page.keyboard.press('End')

        // The toolbar button uses RN Pressable + accessibilityLabel,
        // which translates to aria-label on web. The button triggers
        // a native file picker — Playwright intercepts that with
        // page.waitForEvent('filechooser').
        const fileChooserPromise = page.waitForEvent('filechooser')
        await page.getByRole('button', { name: 'Insert image', exact: true }).click()
        const chooser = await fileChooserPromise
        await chooser.setFiles({
            name: 'toolbar-image.png',
            mimeType: 'image/png',
            buffer: makePngBuffer(),
        })

        // The drive upload + insertImage round trip takes a beat. Wait
        // for an <img> whose src points at the PocketBase files API.
        // The pattern allows for any drive_items record id + the
        // deduplicated final name (the drive uploader may suffix the
        // name if a sibling already owns it).
        const inserted = editorRoot(page).locator('img[src*="/api/files/drive_items/"]')
        await expect(inserted.first()).toBeVisible({ timeout: 30_000 })

        // Explicit assertion that we did NOT regress to base64.
        const src = await inserted.first().getAttribute('src')
        expect(src).not.toBeNull()
        expect(src ?? '').not.toMatch(/^data:/)
        expect(src ?? '').toContain('/api/files/drive_items/')
    })
})
