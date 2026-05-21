import { expect, test } from '@playwright/test'
import {
    EDITOR_REACTION_TIMEOUT,
    editorRoot,
    openFreshTextDocument,
    TEXT_TEST_TIMEOUT,
} from './_menubar-helpers'

// Image wrap toolbar v1: clicking a selected image surfaces a row of
// four mode buttons (inline / left / right / break) above the image.
// Clicking a button writes the corresponding `wrap` attribute via
// updateAttributes; the wrapper span carries that as `data-wrap`,
// which the CSS in editor-content-styles.ts uses to apply float and
// margin behavior. Inline mode is the absence-of-attribute case.
//
// This spec covers the editor-side interaction. The DOCX round-trip
// for each mode (including byte-stable absence-of-attr for inline) is
// covered by the Go test TestPMJSONToDocx_ImageWrapRoundTrip in
// server/translate/image_wrap_test.go — the Go layer exercises both
// directions of the parser/emitter pair more thoroughly than a single
// Playwright run can reach.

// 64×48 PNG so the wrapper has a real, clickable box for the toolbar
// to anchor above and for the image to be selectable without the resize
// handles (anchored at the edges) intercepting the center click. RGBA
// (color-type 6) so Chromium decodes it — the persist test reloads and
// re-asserts the image renders, which needs decodable bytes.
const PNG_64x48_BASE64 =
    'iVBORw0KGgoAAAANSUhEUgAAAEAAAAAwCAYAAAChS3wfAAAAeklEQVR4nO3QMREAIBDAsJeIHCTiCmRkoEP2Xmftc382OkBrgA7QGqADtAboAK0BOkBrgA7QGqADtAboAK0BOkBrgA7QGqADtAboAK0BOkBrgA7QGqADtAboAK0BOkBrgA7QGqADtAboAK0BOkBrgA7QGqADtAboAO0BPDK1w3stbUwAAAAASUVORK5CYII='

function makePngBuffer(): Buffer {
    return Buffer.from(PNG_64x48_BASE64, 'base64')
}

test.describe('Text — Image wrap toolbar', () => {
    test.setTimeout(TEXT_TEST_TIMEOUT)

    test('each toolbar button writes the matching data-wrap attribute', async ({ page }) => {
        await openFreshTextDocument(page, 'image-wrap')

        await editorRoot(page).click()
        await page.keyboard.press('End')

        // Insert an image via the toolbar — mirrors image-resize.spec.ts.
        const fileChooserPromise = page.waitForEvent('filechooser')
        await page.getByRole('button', { name: 'Insert image', exact: true }).click()
        const chooser = await fileChooserPromise
        await chooser.setFiles({
            name: 'image-wrap.png',
            mimeType: 'image/png',
            buffer: makePngBuffer(),
        })

        const inserted = editorRoot(page).locator('img[src*="/api/files/drive_items/"]').first()
        await expect(inserted).toBeVisible({ timeout: 30_000 })

        // The image renders inside the React NodeView's wrapper span. The
        // NodeView mounts a beat after the raw <img> first paints, so wait
        // for the wrapper itself before interacting — it's the only stable
        // host for both the data-wrap attribute and the toolbar. There's a
        // single image in this doc, so the first wrapper is ours.
        const wrapper = editorRoot(page).locator('[data-node-view-wrapper]').first()
        await expect(wrapper).toBeVisible({ timeout: 30_000 })

        // Selecting the image flips the NodeView's `selected` prop and
        // mounts the toolbar + resize handles.
        await inserted.click()
        const toolbar = editorRoot(page).locator('[data-image-wrap-toolbar]').first()
        await expect(toolbar).toBeVisible({ timeout: EDITOR_REACTION_TIMEOUT })

        // All four mode buttons render in order.
        await expect(toolbar.locator('[data-image-wrap-mode]')).toHaveCount(4)
        for (const mode of ['inline', 'left', 'right', 'break']) {
            await expect(toolbar.locator(`[data-image-wrap-mode="${mode}"]`)).toBeVisible()
        }

        // Applying a wrap mode calls updateAttributes, which replaces the
        // image node and so clears the NodeSelection — the toolbar (gated
        // on `selected`) unmounts after each click. Re-select the image
        // before each button press so the toolbar is present to click,
        // exactly as a user would re-click to keep adjusting the image.
        async function clickWrapMode(mode: string) {
            await inserted.click()
            const btn = toolbar.locator(`[data-image-wrap-mode="${mode}"]`)
            await expect(btn).toBeVisible({ timeout: EDITOR_REACTION_TIMEOUT })
            await btn.click()
        }

        // Click each non-inline button and assert the attribute lands.
        for (const mode of ['left', 'right', 'break'] as const) {
            await clickWrapMode(mode)
            // The PM transaction is synchronous, but the React NodeView
            // re-render that paints `data-wrap` is not — and under
            // parallel-worker contention that microtask can be starved
            // for several seconds. Wait the shared reaction budget rather
            // than assuming same-tick paint.
            await expect(wrapper).toHaveAttribute('data-wrap', mode, {
                timeout: EDITOR_REACTION_TIMEOUT,
            })
        }

        // Click inline — the wrapper should LOSE the data-wrap attribute
        // entirely (inline mode = absence-of-attribute).
        await clickWrapMode('inline')
        await expect(wrapper).not.toHaveAttribute('data-wrap', /.*/, {
            timeout: EDITOR_REACTION_TIMEOUT,
        })
    })

    test('wrap mode persists through reload (Yjs round-trip)', async ({ page }) => {
        // Upload an image, set a wrap, then reload and re-bootstrap the
        // whole editor from the server Y.Doc — two full editor boots in
        // one test. Give it headroom over the default budget.
        test.setTimeout(180_000)

        await openFreshTextDocument(page, 'image-wrap-persist')
        await editorRoot(page).click()
        await page.keyboard.press('End')

        const fileChooserPromise = page.waitForEvent('filechooser')
        await page.getByRole('button', { name: 'Insert image', exact: true }).click()
        const chooser = await fileChooserPromise
        await chooser.setFiles({
            name: 'image-wrap-persist.png',
            mimeType: 'image/png',
            buffer: makePngBuffer(),
        })

        const inserted = editorRoot(page).locator('img[src*="/api/files/drive_items/"]').first()
        await expect(inserted).toBeVisible({ timeout: 30_000 })
        // Wait for the NodeView wrapper (single image → first wrapper) so
        // the toolbar is mountable, then select + apply break.
        const wrapper = editorRoot(page).locator('[data-node-view-wrapper]').first()
        await expect(wrapper).toBeVisible({ timeout: 30_000 })
        await inserted.click()
        const breakBtn = editorRoot(page).locator('[data-image-wrap-mode="break"]')
        await expect(breakBtn).toBeVisible({ timeout: EDITOR_REACTION_TIMEOUT })
        await breakBtn.click()
        await expect(wrapper).toHaveAttribute('data-wrap', 'break', {
            timeout: EDITOR_REACTION_TIMEOUT,
        })

        // Wait past the broker's flush debounce before reloading. The
        // image insert AND the wrap attr both need to reach the server's
        // Y.Doc, or the reload rehydrates a doc with no image at all.
        // This matches the persist tests in text-document.spec.ts; without
        // it the reload races the flush and the image is simply absent.
        await page.waitForTimeout(6_000)

        // Force a reload — the doc must hydrate from the server's persisted
        // state and end up back at wrap=break. On flush the server embeds
        // the inserted drive-file image's bytes into the .docx, so on
        // reload it round-trips back as a data: URI (the canonical stored
        // form for every image, same as the fixture's own images) — NOT a
        // drive URL. So we anchor on the wrapper carrying data-wrap=break
        // (the fixture images have no wrap) rather than on the src scheme.
        // If the schema's parseHTML whitelist or the PM-side attr
        // serialization regressed, the attribute would arrive missing or
        // 'inline' on this round-trip.
        await page.reload()
        await editorRoot(page).waitFor({ timeout: 30_000 })
        const reloadedWrapper = editorRoot(page).locator('[data-node-view-wrapper][data-wrap="break"]')
        await expect(reloadedWrapper).toHaveCount(1, { timeout: 30_000 })
        await expect(reloadedWrapper.locator('img')).toBeVisible({ timeout: 30_000 })
    })
})
