import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import type { ComponentType, ReactNode } from 'react'
import { type Control, type FieldValues, type Path, useController } from 'react-hook-form'
import type { TextInputProps as RNTextInputProps } from 'react-native'
import { TextInput as RNTextInput, Text, View, type ViewProps } from 'react-native'

function LabelRow({
    label,
    icon: Icon,
}: {
    label: string
    icon?: ComponentType<{ size: number; color: string }>
}) {
    const mutedColor = useThemeColor('muted-foreground')
    if (!Icon) {
        return <Text className="text-sm font-semibold text-foreground">{label}</Text>
    }
    return (
        <View className="flex-row gap-2 items-center">
            <Icon size={16} color={mutedColor} />
            <Text className="text-sm font-semibold text-foreground">{label}</Text>
        </View>
    )
}

export type TextInputProps<T extends FieldValues = Record<string, unknown>> = Omit<
    RNTextInputProps,
    'value' | 'onChangeText' | 'onBlur'
> & {
    name: Path<T>
    control: Control<T>
    rules?: Record<string, unknown>
    label?: string
    labelIcon?: ComponentType<{ size: number; color: string }>
    hint?: string
    wrapperProps?: ViewProps
    addon?: ReactNode
    onBlur?: () => void
}

export function TextInput<T extends FieldValues = Record<string, unknown>>(
    props: TextInputProps<T>
) {
    const {
        label,
        labelIcon: LabelIcon,
        hint,
        name,
        control,
        rules,
        wrapperProps = {},
        addon,
        onBlur: onBlurProp,
        ...inputProps
    } = props
    const {
        field,
        fieldState: { error },
    } = useController({ name, control, rules })

    const placeholderColor = useThemeColor('field-placeholder')

    const hasError = !!error

    return (
        <View className="gap-1.5 mb-3" {...wrapperProps}>
            {label ? <LabelRow label={label} icon={LabelIcon} /> : null}
            <View className="flex-row gap-2 items-center">
                <RNTextInput
                    value={field.value || ''}
                    onChangeText={field.onChange}
                    onBlur={() => {
                        field.onBlur()
                        onBlurProp?.()
                    }}
                    accessibilityLabel={label}
                    testID={name}
                    placeholder={inputProps.placeholder}
                    autoFocus={inputProps.autoFocus}
                    keyboardType={inputProps.keyboardType}
                    autoCapitalize={inputProps.autoCapitalize}
                    secureTextEntry={inputProps.secureTextEntry}
                    placeholderTextColor={placeholderColor}
                    className={`flex-1 border rounded-lg px-3 py-2.5 text-base text-foreground bg-background ${hasError ? 'border-danger' : 'border-border'}`}
                />
                {addon}
            </View>
            {hint && !hasError ? <Text className="text-xs text-muted">{hint}</Text> : null}
            {hasError ? <Text className="text-xs text-danger">{error.message}</Text> : null}
        </View>
    )
}
