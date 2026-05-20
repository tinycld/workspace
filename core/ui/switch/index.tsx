'use client'
import { tva } from '@gluestack-ui/utils/nativewind-utils'
import React from 'react'
import { Pressable, type PressableProps, View } from 'react-native'

const trackStyle = tva({
    base: 'flex-row items-center justify-start w-[44px] h-[28px] rounded-full px-[3px] bg-border data-[checked=true]:bg-primary data-[checked=true]:justify-end data-[disabled=true]:opacity-40 data-[invalid=true]:border-2 data-[invalid=true]:border-danger web:cursor-pointer',
})

const thumbStyle = tva({
    base: 'w-[22px] h-[22px] rounded-full bg-background shadow-sm',
})

type SwitchProps = Omit<PressableProps, 'onPress' | 'children'> & {
    value?: boolean
    defaultValue?: boolean
    onValueChange?: (next: boolean) => void
    isDisabled?: boolean
    isInvalid?: boolean
    className?: string
}

export const Switch = React.forwardRef<React.ComponentRef<typeof Pressable>, SwitchProps>(
    function Switch(
        {
            value,
            defaultValue,
            onValueChange,
            disabled,
            isDisabled,
            isInvalid,
            className,
            accessibilityLabel,
            ...rest
        },
        ref
    ) {
        const [internal, setInternal] = React.useState(defaultValue ?? false)
        const isControlled = value !== undefined
        const checked = isControlled ? !!value : internal
        const isDisabledFinal = !!(disabled ?? isDisabled)

        const onPress = () => {
            if (isDisabledFinal) return
            const next = !checked
            if (!isControlled) setInternal(next)
            onValueChange?.(next)
        }

        const dataChecked = checked ? 'true' : 'false'
        const dataDisabled = isDisabledFinal ? 'true' : 'false'
        const dataInvalid = isInvalid ? 'true' : 'false'

        return (
            <Pressable
                ref={ref}
                role="switch"
                accessibilityRole="switch"
                accessibilityLabel={accessibilityLabel}
                aria-checked={checked}
                aria-disabled={isDisabledFinal}
                disabled={isDisabledFinal}
                onPress={onPress}
                data-checked={dataChecked}
                data-disabled={dataDisabled}
                data-invalid={dataInvalid}
                className={trackStyle({ class: className })}
                {...rest}
            >
                <View pointerEvents="none" data-checked={dataChecked} className={thumbStyle({})} />
            </Pressable>
        )
    }
)
