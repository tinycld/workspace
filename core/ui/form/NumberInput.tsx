import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { type Control, type FieldValues, type Path, useController } from 'react-hook-form'
import { Pressable, TextInput as RNTextInput, Text, View, type ViewProps } from 'react-native'

export type NumberInputProps<T extends FieldValues = Record<string, unknown>> = {
    name: Path<T>
    control: Control<T>
    label?: string
    hint?: string
    increment?: number
    min?: number
    max?: number
    disabled?: boolean
    wrapperProps?: ViewProps
}

export function NumberInput<T extends FieldValues = Record<string, unknown>>({
    name,
    control,
    label,
    hint,
    increment = 1,
    min,
    max,
    disabled = false,
    wrapperProps = {},
}: NumberInputProps<T>) {
    const placeholderColor = useThemeColor('field-placeholder')
    const {
        field,
        fieldState: { error },
    } = useController({ name, control })

    const hasError = !!error

    const handleTextChange = (text: string) => {
        if (text === '' || text === '-') {
            field.onChange(text)
            return
        }
        const digitsOnly = text.replace(/[^0-9-]/g, '')
        if (digitsOnly !== text) return

        const numValue = Number.parseInt(digitsOnly, 10)
        if (Number.isNaN(numValue)) return
        if (min !== undefined && numValue < min) return
        if (max !== undefined && numValue > max) return
        field.onChange(numValue)
    }

    const handleIncrement = () => {
        const current = typeof field.value === 'number' ? field.value : 0
        const next = current + increment
        if (max === undefined || next <= max) field.onChange(next)
    }

    const handleDecrement = () => {
        const current = typeof field.value === 'number' ? field.value : 0
        const next = current - increment
        if (min === undefined || next >= min) field.onChange(next)
    }

    const displayValue =
        field.value === '' || field.value === '-' ? field.value : String(field.value ?? '')

    const canDecrement = !disabled && (min === undefined || field.value > min)
    const canIncrement = !disabled && (max === undefined || field.value < max)

    return (
        <View className="gap-1.5 mb-3" {...wrapperProps}>
            {label ? <Text className="text-sm font-semibold text-foreground">{label}</Text> : null}
            <View className="flex-row items-center gap-2">
                <Pressable
                    onPress={handleDecrement}
                    disabled={!canDecrement}
                    className={`items-center justify-center rounded-lg bg-default size-11 ${canDecrement ? 'opacity-100' : 'opacity-40'}`}
                >
                    <Text className="text-lg font-semibold text-foreground">−</Text>
                </Pressable>
                <RNTextInput
                    value={displayValue}
                    onChangeText={handleTextChange}
                    onBlur={field.onBlur}
                    keyboardType="numeric"
                    editable={!disabled}
                    accessibilityLabel={label}
                    testID={name}
                    placeholderTextColor={placeholderColor}
                    className={`flex-1 border rounded-lg px-3 py-2.5 text-center text-base text-foreground bg-background ${hasError ? 'border-danger' : 'border-border'}`}
                />
                <Pressable
                    onPress={handleIncrement}
                    disabled={!canIncrement}
                    className={`items-center justify-center rounded-lg bg-default size-11 ${canIncrement ? 'opacity-100' : 'opacity-40'}`}
                >
                    <Text className="text-lg font-semibold text-foreground">+</Text>
                </Pressable>
            </View>
            {hint && !hasError ? <Text className="text-xs text-muted">{hint}</Text> : null}
            {hasError ? <Text className="text-xs text-danger">{error.message}</Text> : null}
        </View>
    )
}
