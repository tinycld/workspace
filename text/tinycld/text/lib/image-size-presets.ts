// Pure helpers for the image-attrs bottom sheet's Size section.
// Lives outside the React component so the size-preset math is
// vitest-testable without dragging in the actionsheet UI.
//
// Each preset names a fraction of the image's natural dimensions.
// resolvePresetSize takes the preset and natural sizes, then routes
// the multiplied pair through clampImageSize (the same clamp the
// web NodeView's reset button uses) so the editor's max-width
// constraint and min-size floor apply identically across the
// resize-handle and preset-button paths.

import { clampImageSize, type ClampedSize } from './image-resize'

export interface ImageSizePreset {
    id: 'small' | 'medium' | 'large' | 'original'
    label: string
    fraction: number
}

export const IMAGE_SIZE_PRESETS: ImageSizePreset[] = [
    { id: 'small', label: 'S', fraction: 0.33 },
    { id: 'medium', label: 'M', fraction: 0.5 },
    { id: 'large', label: 'L', fraction: 0.75 },
    { id: 'original', label: 'Original', fraction: 1.0 },
]

// Resolve a size preset against the image's natural dimensions.
// Returns integer width/height that respect the editor's
// content-width max and min-size floor. Returns null when natural
// dimensions are missing (image bytes haven't loaded inside the
// WebView yet) — callers (the bottom sheet's onSizePress closure,
// or a future toolbar preset shortcut) use the null to skip the
// post entirely.
export function resolvePresetSize(
    preset: ImageSizePreset,
    naturalWidth: number,
    naturalHeight: number
): ClampedSize | null {
    if (naturalWidth <= 0 || naturalHeight <= 0) return null
    const aspectRatio = naturalWidth / naturalHeight
    return clampImageSize({
        width: naturalWidth * preset.fraction,
        height: naturalHeight * preset.fraction,
        aspectRatio,
        mode: 'corner',
    })
}
