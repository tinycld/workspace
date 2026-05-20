import { Switch } from '@tinycld/core/ui/switch'
import { type Control, type FieldValues, type Path, useController } from 'react-hook-form'
import { Text, View, type ViewProps } from 'react-native'

export type ToggleProps<T extends FieldValues = Record<string, unknown>> = {
    name: Path<T>
    control: Control<T>
    label: string
    hint?: string
    disabled?: boolean
    wrapperProps?: ViewProps
}

export function Toggle<T extends FieldValues = Record<string, unknown>>({
    name,
    control,
    label,
    hint,
    disabled = false,
    wrapperProps = {},
}: ToggleProps<T>) {
    const {
        field,
        fieldState: { error },
    } = useController({ name, control })

    const hasError = !!error

    return (
        <View className="gap-1.5 mb-3" {...wrapperProps}>
            <View className="flex-row items-center justify-between gap-2">
                <Text className="text-sm font-semibold text-foreground">{label}</Text>
                <Switch
                    value={Boolean(field.value)}
                    onValueChange={field.onChange}
                    disabled={disabled}
                    accessibilityLabel={label}
                />
            </View>
            {hint && !hasError ? <Text className="text-xs text-muted">{hint}</Text> : null}
            {hasError ? <Text className="text-xs text-danger">{error.message}</Text> : null}
        </View>
    )
}
