import { hexToRgba } from '@tinycld/core/lib/color-utils'
import { Platform } from 'react-native'

interface UseRowFocusStyleArgs {
    isFocused?: boolean
    isHovered?: boolean
    borderColor: string
    activeIndicator: string
}

/**
 * Shared visual treatment for list rows that participate in keyboard nav:
 * hover and keyboard focus both render an accent-coloured left stripe, and
 * keyboard focus additionally gets a "shrunken" inset border with a tinted
 * background so the active row is unambiguous. Returns a style object to
 * spread into the row container, or `null` when nothing should change.
 */
export function rowFocusStyle({
    isFocused,
    isHovered,
    borderColor,
    activeIndicator,
}: UseRowFocusStyleArgs): Record<string, unknown> | null {
    if (Platform.OS !== 'web') return null

    const borderInset = hexToRgba(borderColor, 0.6)
    const shrunkenBox = `inset 1px 0 0 ${borderInset}, inset -1px 0 0 ${borderInset}, inset 0 -1px 0 ${borderInset}, inset 0 1px 0 ${borderInset}`
    const stripeBox = `inset 3px 0 0 ${activeIndicator}`

    const showShrunken = !!isFocused
    const showStripe = !!(isHovered || isFocused)
    if (!showShrunken && !showStripe) return null

    const boxShadow = [showShrunken ? shrunkenBox : null, showStripe ? stripeBox : null]
        .filter(Boolean)
        .join(', ')

    return {
        boxShadow,
        ...(showShrunken
            ? {
                  backgroundColor: hexToRgba(borderColor, 0.12),
                  borderBottomColor: 'transparent',
              }
            : {}),
    }
}
