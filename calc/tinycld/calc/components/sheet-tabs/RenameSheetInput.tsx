import { useEffect, useRef, useState } from 'react'
import { type NativeSyntheticEvent, TextInput, type TextInputKeyPressEventData } from 'react-native'

interface RenameSheetInputProps {
    initialValue: string
    onCommit: (next: string) => void
    onCancel: () => void
}

// RenameSheetInput is the inline editor that replaces a tab's label
// while the sheet is in rename mode. Pre-fills with the current name,
// auto-focuses, selects all on mount; commits on Enter / blur, cancels
// on Esc.
//
// Validation (non-empty, unique-name) lives in the parent — this
// component just emits the trimmed string and lets the action layer
// reject invalid names. Rejected commits surface as the parent
// re-opening the input with the previous value.
export function RenameSheetInput({ initialValue, onCommit, onCancel }: RenameSheetInputProps) {
    const [value, setValue] = useState(initialValue)
    const ref = useRef<TextInput | null>(null)
    const committedRef = useRef(false)

    // Focus + select-all once after mount. selectTextOnFocus does this on
    // native; on web setSelectionRange runs after the focus call lands.
    useEffect(() => {
        ref.current?.focus()
    }, [])

    const commit = () => {
        if (committedRef.current) return
        committedRef.current = true
        onCommit(value.trim())
    }

    const handleKeyPress = (e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
        if (e.nativeEvent.key === 'Escape') {
            committedRef.current = true
            onCancel()
        }
    }

    return (
        <TextInput
            ref={ref}
            value={value}
            onChangeText={setValue}
            onSubmitEditing={commit}
            onBlur={commit}
            onKeyPress={handleKeyPress}
            selectTextOnFocus
            autoFocus
            accessibilityLabel="Rename sheet"
            className="text-xs text-foreground bg-background px-2 py-0.5 border border-accent rounded-sm"
            style={{ minWidth: 64, height: 22 }}
        />
    )
}
