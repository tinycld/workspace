import { forwardRef, useCallback } from 'react'
import {
    type LayoutChangeEvent,
    type NativeSyntheticEvent,
    Platform,
    Text,
    TextInput,
    type TextInputSelectionChangeEventData,
    View,
} from 'react-native'
import { FORMULA_BAR_ACCESSORY_ID } from './formula-accessory-id'

// SpecialKey is the limited set of keys Grid wants to intercept for
// suggestion-popover navigation. The formula bar dispatches them up
// (rather than handling them locally) so a single key router lives in
// Grid alongside the in-cell editor.
export type FormulaSpecialKey = 'ArrowUp' | 'ArrowDown' | 'Tab' | 'Enter' | 'Escape'

interface FormulaBarProps {
    cellLabel: string | null
    value: string
    selection: { start: number; end: number } | undefined
    disabled: boolean
    onChange: (next: string) => void
    onSelectionChange: (start: number, end: number) => void
    onCommit: () => void
    onCancel: () => void
    onFocus: () => void
    onSpecialKey: (key: FormulaSpecialKey) => boolean // return true to consume
    onAnchorLayout: (rect: { left: number; top: number; width: number; height: number }) => void
}

// FormulaBar is a controlled input. The Grid owns the value, cursor
// selection, and the suggestion-popover key routing — this component
// just renders + dispatches.
//
// "Always editing the selected cell" is the spreadsheet convention —
// any keystroke here implicitly opens an edit session in the Grid via
// onChange. There is no separate enter-edit-mode step for the formula
// bar, so it behaves the same way Excel/Sheets do.
export const FormulaBar = forwardRef<TextInput, FormulaBarProps>(function FormulaBar(
    {
        cellLabel,
        value,
        selection,
        disabled,
        onChange,
        onSelectionChange,
        onCommit,
        onCancel,
        onFocus,
        onSpecialKey,
        onAnchorLayout,
    }: FormulaBarProps,
    ref
) {
    const onKeyPress = useCallback(
        (e: { nativeEvent: { key?: string }; preventDefault?: () => void }) => {
            const key = e.nativeEvent.key
            if (key === 'Escape') {
                if (onSpecialKey('Escape')) {
                    e.preventDefault?.()
                    return
                }
                onCancel()
                return
            }
            if (key === 'ArrowUp' || key === 'ArrowDown' || key === 'Tab' || key === 'Enter') {
                if (onSpecialKey(key)) {
                    e.preventDefault?.()
                }
            }
        },
        [onCancel, onSpecialKey]
    )

    const onSelChange = useCallback(
        (e: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
            const sel = e.nativeEvent.selection
            onSelectionChange(sel.start, sel.end)
        },
        [onSelectionChange]
    )

    const onLayout = useCallback(
        (e: LayoutChangeEvent) => {
            const { x, y, width, height } = e.nativeEvent.layout
            onAnchorLayout({ left: x, top: y, width, height })
        },
        [onAnchorLayout]
    )

    return (
        <View
            className="flex-row items-center bg-background border-b border-border"
            style={{ height: 28, paddingHorizontal: 4 }}
        >
            <View
                className="bg-surface-secondary border border-border items-center justify-center rounded"
                style={{ width: 56, height: 22, marginRight: 6 }}
            >
                <Text className="text-xs text-muted-foreground" style={{ fontFamily: 'monospace' }}>
                    {cellLabel ?? ''}
                </Text>
            </View>
            <TextInput
                ref={ref}
                value={value}
                selection={selection}
                editable={!disabled}
                onChangeText={onChange}
                onSelectionChange={onSelChange}
                onSubmitEditing={onCommit}
                onBlur={onCommit}
                onFocus={onFocus}
                onKeyPress={onKeyPress}
                onLayout={onLayout}
                accessibilityLabel="Formula bar"
                inputAccessoryViewID={
                    Platform.OS === 'ios' ? FORMULA_BAR_ACCESSORY_ID : undefined
                }
                style={{ flex: 1, height: 22, fontSize: 12, paddingHorizontal: 4 }}
                className="text-foreground"
            />
        </View>
    )
})
