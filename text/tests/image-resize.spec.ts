import { expect, test } from '@playwright/test'
import {
    EDITOR_REACTION_TIMEOUT,
    editorRoot,
    openFreshTextDocument,
    TEXT_TEST_TIMEOUT,
} from './_menubar-helpers'

// Image resize v1: clicking a selected image surfaces three drag
// handles; dragging the corner handle preserves the aspect ratio and
// persists the new size into the PM image node's width/height attrs.
//
// This spec covers the editor-side resize interaction. The full DOCX
// round-trip (width/height through <wp:extent> EMUs) is covered by Go
// unit tests in server/translate/image_dimensions_test.go — those
// exercise the same parser/emitter pair the server bootstrap +
// flush go through, with finer granularity than a Playwright run can
// reach.

// 24×48 PNG (natural ratio 0.5 means corner-drag produces a clearly
// distinct width and height). RGBA (color-type 6) so Chromium decodes
// it — the earlier 1×2 gray+alpha (color-type 4) encoding decoded under
// libpng but Chromium rejected it, leaving naturalWidth at 0. That was
// invisible to this test (the NodeView falls back to rect.width when
// naturalWidth is 0), but a 1px-wide click target is fragile; a 24×48
// box gives a comfortable center click clear of the edge resize handles.
const PNG_24x48_BASE64 =
    'iVBORw0KGgoAAAANSUhEUgAAABgAAAAwCAYAAAALiLqjAAAAMElEQVR4nO3NIQ0AAAgAMIIRjIi0ghQItovrR1fOpRAIBAKBQCAQCAQCgUAgEHwKFnzKKiYoX5M4AAAAAElFTkSuQmCC'

function makePngBuffer(): Buffer {
    return Buffer.from(PNG_24x48_BASE64, 'base64')
}

// 100×50 PNG — a natural aspect ratio that's tall enough to exercise
// both the horizontal-drag (width-only) skew path and the reset path
// without the min-size clamp obscuring what we measure. RGBA
// (color-type 6) so Chromium decodes it and naturalWidth/naturalHeight
// report 100/50 — the reset test gates entirely on those being non-zero.
const PNG_100x50_BASE64 =
    'iVBORw0KGgoAAAANSUhEUgAAAGQAAAAyCAYAAACqNX6+AAAAj0lEQVR4nO3RMREAIBDAsBeBdmacggw6ZMjeu87a59IxvwMwJM2QGENiDIkxJMaQGENiDIkxJMaQGENiDIkxJMaQGENiDIkxJMaQGENiDIkxJMaQGENiDIkxJMaQGENiDIkxJMaQGENiDIkxJMaQGENiDIkxJMaQGENiDIkxJMaQGENiDIkxJMaQGENiDIl51jikXQD1g9sAAAAASUVORK5CYII='

function make100x50PngBuffer(): Buffer {
    return Buffer.from(PNG_100x50_BASE64, 'base64')
}

test.describe('Text — Image resize', () => {
    test.setTimeout(TEXT_TEST_TIMEOUT)

    test('dragging the corner handle resizes the image in place', async ({ page }) => {
        await openFreshTextDocument(page, 'image-resize')

        await editorRoot(page).click()
        await page.keyboard.press('End')

        // Insert an image via the toolbar (mirrors toolbar-image-insert
        // spec). After insert, the editor lands the caret AFTER the
        // image — we click the <img> to select it and surface the
        // resize handles.
        const fileChooserPromise = page.waitForEvent('filechooser')
        await page.getByRole('button', { name: 'Insert image', exact: true }).click()
        const chooser = await fileChooserPromise
        await chooser.setFiles({
            name: 'image-resize.png',
            mimeType: 'image/png',
            buffer: makePngBuffer(),
        })

        const inserted = editorRoot(page).locator('img[src*="/api/files/drive_items/"]').first()
        await expect(inserted).toBeVisible({ timeout: 30_000 })
        // Wait for the React NodeView wrapper (mounts a beat after the raw
        // <img>) so selecting the image actually surfaces the handles.
        await expect(editorRoot(page).locator('[data-node-view-wrapper]').first()).toBeVisible({
            timeout: 30_000,
        })

        // ProseMirror needs us to click the image to drop a NodeSelection
        // onto it — that's what flips ReactNodeViewRenderer's `selected`
        // prop and mounts the handles.
        await inserted.click()
        const cornerHandle = editorRoot(page).locator('[data-image-handle="corner"]').first()
        await expect(cornerHandle).toBeVisible({ timeout: EDITOR_REACTION_TIMEOUT })

        // Drag the corner handle right + down by 200px. The pointermove
        // updates liveSize; pointerup commits via updateAttributes,
        // which Yjs mirrors into the room.
        const handleBox = await cornerHandle.boundingBox()
        if (!handleBox) throw new Error('handle has no bounding box')
        const handleX = handleBox.x + handleBox.width / 2
        const handleY = handleBox.y + handleBox.height / 2
        await page.mouse.move(handleX, handleY)
        await page.mouse.down()
        await page.mouse.move(handleX + 200, handleY + 200, { steps: 10 })
        await page.mouse.up()

        // Width must have grown (corner-drag +200px) to at least the
        // 32px minimum. The exact value is an integer set by
        // clampImageSize; we assert it landed in the legal range and
        // that the height attr was committed alongside (corner-drag
        // commits both axes).
        const widthAttr = await inserted.getAttribute('width')
        const heightAttr = await inserted.getAttribute('height')
        expect(widthAttr).not.toBeNull()
        expect(heightAttr).not.toBeNull()
        const widthPx = Number.parseInt(widthAttr ?? '0', 10)
        const heightPx = Number.parseInt(heightAttr ?? '0', 10)
        expect(widthPx).toBeGreaterThanOrEqual(32)
        expect(heightPx).toBeGreaterThanOrEqual(32)

        // Orthogonality regression: flipping the wrap mode must not
        // clear the width/height attrs the drag just committed. The
        // toolbar's onChange handler is wired to only send `{ wrap }`
        // — the plan's §8 invariant. If a future refactor bundled
        // dimensions back into that updateAttributes call, the
        // concurrent-resize race would no longer be benign.
        //
        // Committing the resize replaces the image node, which clears the
        // NodeSelection — so the toolbar (gated on `selected`) unmounts.
        // Re-click the image to re-select it before reaching for the
        // toolbar; this is exactly what a user does to keep editing it.
        await inserted.click()
        const toolbar = editorRoot(page).locator('[data-image-wrap-toolbar]').first()
        await expect(toolbar).toBeVisible({ timeout: EDITOR_REACTION_TIMEOUT })
        await toolbar.locator('[data-image-wrap-mode="left"]').click()

        const widthAfter = Number.parseInt((await inserted.getAttribute('width')) ?? '0', 10)
        const heightAfter = Number.parseInt((await inserted.getAttribute('height')) ?? '0', 10)
        expect(widthAfter).toBe(widthPx)
        expect(heightAfter).toBe(heightPx)
    })

    test('reset-size button restores the natural dimensions after a skew', async ({ page }) => {
        // Upload + wait-for-natural-load + drag + reset is a long chain;
        // give it headroom beyond the default so a busy runner's slow but
        // correct run isn't failed by the per-test budget.
        test.setTimeout(180_000)

        // Drag the right-edge handle to grow the width without touching
        // the height — that's how a user accidentally produces a skewed
        // image (e.g. a 100×50 source dragged to 300×50). The reset
        // button on the wrap toolbar must restore the natural 100×50
        // dimensions in one click, even when the wrapper currently
        // carries a non-natural attr pair.
        await openFreshTextDocument(page, 'image-resize-reset')
        await editorRoot(page).click()
        await page.keyboard.press('End')

        const fileChooserPromise = page.waitForEvent('filechooser')
        await page.getByRole('button', { name: 'Insert image', exact: true }).click()
        const chooser = await fileChooserPromise
        await chooser.setFiles({
            name: 'reset-fixture.png',
            mimeType: 'image/png',
            buffer: make100x50PngBuffer(),
        })

        const inserted = editorRoot(page).locator('img[src*="/api/files/drive_items/"]').first()
        await expect(inserted).toBeVisible({ timeout: 30_000 })

        // Wait until the image has actually loaded so naturalWidth /
        // naturalHeight are non-zero. Without this the toolbar's
        // canReset gate would still be false even after the drag.
        await page.waitForFunction(
            () => {
                const img = document.querySelector<HTMLImageElement>(
                    '.ProseMirror img[src*="/api/files/drive_items/"]'
                )
                return img?.complete === true && img.naturalWidth > 0
            },
            { timeout: 30_000 }
        )

        await inserted.click()
        const rightHandle = editorRoot(page).locator('[data-image-handle="right"]').first()
        await expect(rightHandle).toBeVisible({ timeout: EDITOR_REACTION_TIMEOUT })

        // Horizontal-only drag: width grows, height stays — that's the
        // skew we want the reset button to undo.
        const handleBox = await rightHandle.boundingBox()
        if (!handleBox) throw new Error('right handle has no bounding box')
        const handleX = handleBox.x + handleBox.width / 2
        const handleY = handleBox.y + handleBox.height / 2
        await page.mouse.move(handleX, handleY)
        await page.mouse.down()
        await page.mouse.move(handleX + 200, handleY, { steps: 10 })
        await page.mouse.up()

        const widthBeforeReset = Number.parseInt((await inserted.getAttribute('width')) ?? '0', 10)
        const heightBeforeReset = Number.parseInt(
            (await inserted.getAttribute('height')) ?? '0',
            10
        )
        // Sanity: the right-edge drag produced a skewed pair — width
        // grew, height stayed at the natural value (50). If clampImageSize
        // ever started touching the height on a horizontal drag this
        // assertion would catch it.
        expect(widthBeforeReset).toBeGreaterThan(200)
        expect(heightBeforeReset).toBe(50)

        // Committing the resize replaces the image node, which clears the
        // NodeSelection — so the wrap toolbar (gated on `selected`) and its
        // reset button unmount. Re-click the image to re-select it before
        // reaching for the reset button, exactly as a user would re-click
        // to keep adjusting the image (mirrors the corner-drag test).
        await inserted.click()
        const resetButton = editorRoot(page).locator('[data-image-wrap-reset]').first()
        await expect(resetButton).toBeVisible({ timeout: EDITOR_REACTION_TIMEOUT })
        await expect(resetButton).toBeEnabled()
        await resetButton.click()

        const widthAfter = Number.parseInt((await inserted.getAttribute('width')) ?? '0', 10)
        const heightAfter = Number.parseInt((await inserted.getAttribute('height')) ?? '0', 10)
        expect(widthAfter).toBe(100)
        expect(heightAfter).toBe(50)

        // The reset commit replaces the image node and clears the
        // NodeSelection, unmounting the toolbar — so re-select before
        // checking the gate. After reset the dimensions match natural, so
        // canReset is false and the button must render disabled. If the
        // gate ever started always returning true, a second click would
        // still commit (a no-op but a wasted Yjs transaction).
        await inserted.click()
        const resetButtonAfter = editorRoot(page).locator('[data-image-wrap-reset]').first()
        await expect(resetButtonAfter).toBeVisible({ timeout: EDITOR_REACTION_TIMEOUT })
        await expect(resetButtonAfter).toBeDisabled()
    })
})
