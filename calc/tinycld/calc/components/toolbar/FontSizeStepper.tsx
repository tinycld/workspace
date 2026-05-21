import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Minus, Plus } from 'lucide-react-native'
import { useCallback, useEffect, useState } from 'react'
import { Platform, TextInput, View } from 'react-native'
import { ToolbarButton } from './ToolbarButton'

const DEFAULT_SIZE = 10
const MIN_SIZE = 6
const MAX_SIZE = 96

interface FontSizeStepperProps {
    size: number | undefined
    disabled: boolean
    onSetSize: (size: number) => void
}

// "− [10] +" font size control. Local state is justified here because
// the TextInput is keyed at every keystroke and we don't want to
// commit a half-typed number to the Y.Doc — only on blur, Enter,
// or button click.
export function FontSizeStepper({ size, disabled, onSetSize }: FontSizeStepperProps) {
    const fg = useThemeColor('foreground')
    const border = useThemeColor('border')
    const effective = size ?? DEFAULT_SIZE
    const [draft, setDraft] = useState(String(effective))

    // When the selection changes (which changes the incoming `size`),
    // overwrite any in-progress local draft so the field reflects the
    // newly-active cell.
    useEffect(() => {
        setDraft(String(size ?? DEFAULT_SIZE))
    }, [size])

    const commit = useCallback(
        (raw: string) => {
            const parsed = Number.parseInt(raw, 10)
            if (!Number.isFinite(parsed)) {
                setDraft(String(effective))
                return
            }
            const clamped = Math.max(MIN_SIZE, Math.min(MAX_SIZE, parsed))
            setDraft(String(clamped))
            onSetSize(clamped)
        },
        [effective, onSetSize]
    )

    const onMinus = useCallback(() => {
        const next = Math.max(MIN_SIZE, effective - 1)
        setDraft(String(next))
        onSetSize(next)
    }, [effective, onSetSize])

    const onPlus = useCallback(() => {
        const next = Math.min(MAX_SIZE, effective + 1)
        setDraft(String(next))
        onSetSize(next)
    }, [effective, onSetSize])

    return (
        <View className="flex-row items-center" style={{ marginHorizontal: 2 }}>
            <ToolbarButton
                label="Decrease font size"
                icon={Minus}
                disabled={disabled}
                onPress={onMinus}
            />
            <TextInput
                value={draft}
                onChangeText={setDraft}
                onBlur={() => commit(draft)}
                onSubmitEditing={() => commit(draft)}
                editable={!disabled}
                accessibilityLabel="Font size"
                inputMode="numeric"
                keyboardType="number-pad"
                selectTextOnFocus
                style={{
                    width: 32,
                    height: 22,
                    marginHorizontal: 2,
                    borderWidth: 1,
                    borderColor: border,
                    borderRadius: 3,
                    color: fg,
                    textAlign: 'center',
                    fontSize: 12,
                    paddingHorizontal: 2,
                    paddingVertical: 0,
                    opacity: disabled ? 0.4 : 1,
                    // Web ergonomics: hide the browser's spin buttons.
                    ...(Platform.OS === 'web'
                        ? ({ MozAppearance: 'textfield' } as Record<string, unknown>)
                        : {}),
                }}
            />
            <ToolbarButton
                label="Increase font size"
                icon={Plus}
                disabled={disabled}
                onPress={onPlus}
            />
        </View>
    )
}
