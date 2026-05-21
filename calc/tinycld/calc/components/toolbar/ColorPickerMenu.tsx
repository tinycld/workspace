import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import {
    BORDERS_PALETTE,
    COLOR_PALETTE,
    COLOR_PICKER_GRID_WIDTH,
    ColorPickerGrid,
    type Swatch,
} from '@tinycld/core/ui/color-picker'
import { Menu, useOpenMenu } from '@tinycld/core/ui/menubar'
import type { ComponentType, ReactNode } from 'react'
import { useCallback } from 'react'
import { View } from 'react-native'
import { ToolbarButton } from './ToolbarButton'

// Re-export the palettes so calc-internal callers (BordersMenu,
// conditional-format StylePicker) keep their existing import path.
// The values now live in core; this file is the calc-toolbar shell.
export { BORDERS_PALETTE, COLOR_PALETTE, type Swatch }

interface ColorPickerMenuProps {
    color: string | undefined
    disabled: boolean
    label: string
    triggerIcon: ComponentType<{ size?: number; color?: string }>
    // Optional render slot drawn under the trigger icon — used by the
    // text-color and fill-color buttons to show an underline bar tinted
    // to the active swatch (matches the Google Sheets affordance).
    triggerOverlay?: ReactNode
    onSetColor: (color: string) => void
}

export function ColorPickerMenu({
    color,
    disabled,
    label,
    triggerIcon: Icon,
    triggerOverlay,
    onSetColor,
}: ColorPickerMenuProps) {
    const fg = useThemeColor('foreground')
    const [isOpen, setIsOpen] = useOpenMenu(`toolbar:color:${label}`)

    const onSelect = useCallback(
        (value: string) => {
            onSetColor(value)
            setIsOpen(false)
        },
        [onSetColor, setIsOpen]
    )

    return (
        <Menu isOpen={isOpen} onOpenChange={setIsOpen}>
            <View {...(typeof document !== 'undefined' ? { 'data-tinycld-menu': 'trigger' } : {})}>
                <Menu.Trigger>
                    <ToolbarButton label={label} disabled={disabled}>
                        <View className="items-center justify-center">
                            <Icon size={14} color={fg} />
                            {triggerOverlay}
                        </View>
                    </ToolbarButton>
                </Menu.Trigger>
            </View>
            <Menu.Portal>
                <Menu.Content placement="bottom" align="start">
                    <View
                        style={{ width: COLOR_PICKER_GRID_WIDTH }}
                        {...(typeof document !== 'undefined'
                            ? { 'data-tinycld-menu': 'content' }
                            : {})}
                    >
                        <ColorPickerGrid selected={color} onSelect={onSelect} showClear />
                    </View>
                </Menu.Content>
            </Menu.Portal>
        </Menu>
    )
}
