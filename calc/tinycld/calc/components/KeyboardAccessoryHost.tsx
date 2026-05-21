import type { FormulaSpecialKey } from './FormulaBar'

interface KeyboardAccessoryHostProps {
    onSpecialKey: (key: FormulaSpecialKey) => boolean
    onCancel: () => void
}

// Web + Android fallback. InputAccessoryView is iOS-only and isn't
// exported from react-native-web, so we render nothing on these
// platforms. Metro picks the .ios.tsx variant on iOS.
export function KeyboardAccessoryHost(_props: KeyboardAccessoryHostProps) {
    return null
}
