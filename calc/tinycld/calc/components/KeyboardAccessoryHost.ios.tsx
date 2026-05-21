import { InputAccessoryView } from 'react-native'
import type { FormulaSpecialKey } from './FormulaBar'
import { FormulaBarKeyboardAccessory } from './FormulaBarKeyboardAccessory'
import { FORMULA_BAR_ACCESSORY_ID } from './formula-accessory-id'

interface KeyboardAccessoryHostProps {
    onSpecialKey: (key: FormulaSpecialKey) => boolean
    onCancel: () => void
}

// iOS-only host: InputAccessoryView is not exported from react-native-web,
// so importing it unconditionally crashes web bundling. Platform extensions
// (`.ios.tsx` + base `.tsx`) keep the import out of the web bundle entirely.
export function KeyboardAccessoryHost({
    onSpecialKey,
    onCancel,
}: KeyboardAccessoryHostProps) {
    return (
        <InputAccessoryView nativeID={FORMULA_BAR_ACCESSORY_ID}>
            <FormulaBarKeyboardAccessory
                onSpecialKey={onSpecialKey}
                onCancel={onCancel}
            />
        </InputAccessoryView>
    )
}
