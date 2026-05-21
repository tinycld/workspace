import { formatKeys } from '@tinycld/core/lib/shortcuts/keys'

// displayKeys renders a `$mod+Shift+x`-style binding string for the
// Keyboard shortcuts help dialog. Modifiers join with `+` regardless
// of platform (so Apple's "⌘+⇧+X" reads the same shape as the Windows
// "Ctrl+Shift+X"), and chord sequences (whitespace-separated combos
// like `t i`) join with a space. The function is the only renderer
// that touches `formatKeys`, so any future change to its output shape
// is contained here.
export function displayKeys(keys: string): string {
    return formatKeys(keys)
        .map(parts => parts.join('+'))
        .join(' ')
}
