// ImageAttrsBottomSheet is React Native (Actionsheet, View, Pressable)
// styled with Uniwind - same constraint as every other RN-styled
// component in this package, it can't render under vitest's default
// node environment, and the per-file environment directive doesn't
// apply to sibling-package symlinked test files (see the longer
// commentary in use-webview-editor-commands.test.ts).
//
// What we DO lock here are:
//
//   1. The pure `resolvePresetSize` helper the sheet calls when a
//      size chip is tapped - same job clampImageSize does for the
//      web NodeView's reset button, but invoked from a preset
//      fraction instead of a drag delta.
//   2. The store integration - the sheet reads ImageSelection out of
//      the Zustand store and clears it on dismiss. We drive the store
//      directly and assert on the state transitions the sheet relies
//      on without booting React.
//   3. The image-options command wire: the sheet calls
//      commands.updateImageAttrs?.({ wrap | width, height }). We
//      replay the call against a stub commands object and assert the
//      shape, mirroring the use-webview-editor-commands tests' pattern.
//
// Visual + interaction coverage (chip layout, active-mode styling,
// backdrop dismiss) lives in Playwright once the device runner is
// wired up; for now those are out of vitest's reach.

import type { EditorCommands } from '@tinycld/core/lib/editor/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IMAGE_MAX_WIDTH, IMAGE_MIN_SIZE } from '../tinycld/text/lib/image-resize'
import { resolvePresetSize } from '../tinycld/text/lib/image-size-presets'
import { wrapToAttr } from '../tinycld/text/lib/image-wrap-modes'
import { useImageSelectionStore } from '../tinycld/text/lib/stores/image-selection-store'
import type { ImageSelection } from '../tinycld/text/webview-editor/source/editor-state-types'

function makeSelection(over: Partial<ImageSelection> = {}): ImageSelection {
    return {
        src: 'https://example/photo.png',
        alt: null,
        wrap: null,
        width: null,
        height: null,
        naturalWidth: 800,
        naturalHeight: 600,
        rect: null,
        ...over,
    }
}

beforeEach(() => {
    useImageSelectionStore.getState().clearSelection()
})

describe('resolvePresetSize', () => {
    it('returns null when natural dimensions are missing (image not loaded)', () => {
        expect(resolvePresetSize({ id: 'medium', label: 'M', fraction: 0.5 }, 0, 0)).toBeNull()
    })

    it('returns null when only natural width is 0 (defensive)', () => {
        expect(resolvePresetSize({ id: 'medium', label: 'M', fraction: 0.5 }, 0, 600)).toBeNull()
    })

    it('returns 50% of an 800x600 natural for the M preset', () => {
        // The preset fraction multiplies natural dimensions; clampImageSize
        // keeps both axes consistent with the 4:3 aspect ratio. 50% of
        // 800x600 = 400x300, well under IMAGE_MAX_WIDTH.
        const result = resolvePresetSize(
            { id: 'medium', label: 'M', fraction: 0.5 },
            800,
            600
        )
        expect(result).toEqual({ width: 400, height: 300 })
    })

    it('clamps the Original preset to IMAGE_MAX_WIDTH on a wide image', () => {
        // A 1600x900 natural is wider than the editor 800px content
        // column. Original means natural size; clampImageSize bounds
        // width at IMAGE_MAX_WIDTH and scales height to keep the ratio.
        const result = resolvePresetSize(
            { id: 'original', label: 'Original', fraction: 1.0 },
            1600,
            900
        )
        expect(result?.width).toBe(IMAGE_MAX_WIDTH)
        // 800 * (900/1600) = 450, rounded
        expect(result?.height).toBe(450)
    })

    it('respects the MIN_SIZE floor for tiny images on the S preset', () => {
        // A 60x40 natural at 33% would scale to ~20x13, below the
        // editor's 32px minimum. clampImageSize bumps the smaller axis
        // up to MIN_SIZE and scales the other to match the ratio.
        const result = resolvePresetSize(
            { id: 'small', label: 'S', fraction: 0.33 },
            60,
            40
        )
        expect(result).not.toBeNull()
        if (result) {
            expect(Math.min(result.width, result.height)).toBeGreaterThanOrEqual(IMAGE_MIN_SIZE)
            expect(Number.isInteger(result.width)).toBe(true)
            expect(Number.isInteger(result.height)).toBe(true)
        }
    })

    it('returns integers for all preset paths', () => {
        const result = resolvePresetSize(
            { id: 'small', label: 'S', fraction: 0.33 },
            777,
            513
        )
        expect(result).not.toBeNull()
        if (result) {
            expect(Number.isInteger(result.width)).toBe(true)
            expect(Number.isInteger(result.height)).toBe(true)
        }
    })
})

describe('useImageSelectionStore - bottom-sheet open/close lifecycle', () => {
    it('starts with no selection (sheet is closed by default)', () => {
        expect(useImageSelectionStore.getState().selection).toBeNull()
    })

    it('setSelection() with a selection opens the sheet; clearSelection() closes it', () => {
        const sel = makeSelection({ wrap: 'left' })
        useImageSelectionStore.getState().setSelection(sel)
        expect(useImageSelectionStore.getState().selection).toEqual(sel)

        useImageSelectionStore.getState().clearSelection()
        expect(useImageSelectionStore.getState().selection).toBeNull()
    })

    it('setSelection(null) clears the selection (equivalent to clearSelection())', () => {
        // useDocumentEditor.native pushes payload.kind === "image" ?
        // payload.image : null straight into setSelection(). Verifying
        // the null path keeps that callsite from drifting.
        useImageSelectionStore.getState().setSelection(makeSelection())
        useImageSelectionStore.getState().setSelection(null)
        expect(useImageSelectionStore.getState().selection).toBeNull()
    })
})

function stubCommands(): EditorCommands {
    return {
        toggleBold: vi.fn(),
        toggleItalic: vi.fn(),
        toggleUnderline: vi.fn(),
        toggleBulletList: vi.fn(),
        toggleOrderedList: vi.fn(),
        toggleBlockquote: vi.fn(),
        toggleHeading: vi.fn(),
        setLink: vi.fn(),
        removeLink: vi.fn(),
        undo: vi.fn(),
        redo: vi.fn(),
        updateImageAttrs: vi.fn(),
    }
}

describe('ImageAttrsBottomSheet - command wire shape', () => {
    it('Wrap left chip posts { wrap: "left" }', () => {
        const commands = stubCommands()
        commands.updateImageAttrs?.({ wrap: wrapToAttr('left') })
        expect(commands.updateImageAttrs).toHaveBeenCalledWith({ wrap: 'left' })
    })

    it('Wrap right chip posts { wrap: "right" }', () => {
        const commands = stubCommands()
        commands.updateImageAttrs?.({ wrap: wrapToAttr('right') })
        expect(commands.updateImageAttrs).toHaveBeenCalledWith({ wrap: 'right' })
    })

    it('Break chip posts { wrap: "break" }', () => {
        const commands = stubCommands()
        commands.updateImageAttrs?.({ wrap: wrapToAttr('break') })
        expect(commands.updateImageAttrs).toHaveBeenCalledWith({ wrap: 'break' })
    })

    it('Inline chip posts { wrap: null } (clears the attr)', () => {
        const commands = stubCommands()
        commands.updateImageAttrs?.({ wrap: wrapToAttr('inline') })
        expect(commands.updateImageAttrs).toHaveBeenCalledWith({ wrap: null })
    })

    it('Medium preset against a 800x600 image posts { width: 400, height: 300 }', () => {
        const commands = stubCommands()
        const size = resolvePresetSize({ id: 'medium', label: 'M', fraction: 0.5 }, 800, 600)
        if (!size) throw new Error('preset should resolve for 800x600 natural')
        commands.updateImageAttrs?.(size)
        expect(commands.updateImageAttrs).toHaveBeenCalledWith({ width: 400, height: 300 })
    })

    it('Size preset is skipped when natural dimensions are 0 (Size buttons disabled)', () => {
        // The sheet disables Size chips when naturalWidth==0; the
        // Pressable's disabled prop suppresses onPress. resolvePresetSize
        // also returns null defensively, so an accidental click through
        // would still not post a value.
        const commands = stubCommands()
        const size = resolvePresetSize({ id: 'large', label: 'L', fraction: 0.75 }, 0, 0)
        expect(size).toBeNull()
        if (size) commands.updateImageAttrs?.(size)
        expect(commands.updateImageAttrs).not.toHaveBeenCalled()
    })
})
