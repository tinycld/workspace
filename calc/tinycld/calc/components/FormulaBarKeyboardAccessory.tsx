import { openHelp } from '@tinycld/core/lib/help/open-help'
import { Pressable, Text, View } from 'react-native'
import type { FormulaSpecialKey } from './FormulaBar'

interface FormulaBarKeyboardAccessoryProps {
    onSpecialKey: (key: FormulaSpecialKey) => boolean
    onCancel: () => void
}

// iOS keyboard accessory bar shown while any calc TextInput
// (FormulaBar or cell editor) is focused. The iOS soft keyboard
// doesn't expose Tab/Enter/arrows reliably, so we surface them as
// touchable buttons that route through the same onSpecialKey
// handler the hardware keyboard would.
export function FormulaBarKeyboardAccessory({
    onSpecialKey,
    onCancel,
}: FormulaBarKeyboardAccessoryProps) {
    return (
        <View className="flex-row items-center justify-around border-t border-border bg-surface-secondary px-2 py-2">
            <AccessoryButton label="Esc" onPress={onCancel} />
            <AccessoryButton label="▲" onPress={() => onSpecialKey('ArrowUp')} />
            <AccessoryButton label="▼" onPress={() => onSpecialKey('ArrowDown')} />
            <AccessoryButton label="Tab" onPress={() => onSpecialKey('Tab')} />
            <AccessoryButton label="Enter" onPress={() => onSpecialKey('Enter')} />
            <AccessoryButton label="fx" onPress={() => openHelp('calc:functions')} />
        </View>
    )
}

function AccessoryButton({ label, onPress }: { label: string; onPress: () => void }) {
    return (
        <Pressable
            onPress={onPress}
            className="rounded-md bg-background px-3 py-2"
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
        >
            <Text className="text-sm text-foreground">{label}</Text>
        </Pressable>
    )
}
