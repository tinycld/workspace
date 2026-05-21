import { COLOR_PICKER_GRID_WIDTH, ColorPickerGrid } from '@tinycld/core/ui/color-picker'
import { Menu, useOpenMenu } from '@tinycld/core/ui/menubar'
import type { ComponentType } from 'react'
import { useCallback } from 'react'
import { Platform, Pressable, View } from 'react-native'
import { ToolbarTooltip } from './ToolbarTooltip'

interface TextColorButtonProps {
    // Lucide-style icon — `<Baseline>` for text color, `<Highlighter>`
    // for background. The icon gets a horizontal bar underline tinted
    // to the active color, matching the Google Sheets affordance.
    icon: ComponentType<{ size: number; color: string }>
    accessibilityLabel: string
    // Stable string used as the useOpenMenu key. Different keys for
    // text vs background prevent both popovers from sharing state and
    // closing each other.
    menuKey: string
    // Hex string of the currently-applied color. Undefined / empty
    // means "no override; renders with the inherited foreground".
    color: string | undefined
    disabled: boolean
    iconColor: string
    onSelect: (color: string) => void
}

// TextColorButton is the text-editor toolbar's color picker — one
// instance for text color, one for background color. Modeled on
// calc/components/toolbar/ColorPickerMenu.tsx: same shared
// ColorPickerGrid in the popover, same useOpenMenu de-dup keying,
// same accent underline bar under the icon. Differs only in the
// trigger button shape, which mirrors DocumentToolbar's FormatButton
// instead of calc's ToolbarButton.
export function TextColorButton({
    icon: Icon,
    accessibilityLabel,
    menuKey,
    color,
    disabled,
    iconColor,
    onSelect,
}: TextColorButtonProps) {
    const [isOpen, setIsOpen] = useOpenMenu(`text-toolbar:${menuKey}`)

    const handleSelect = useCallback(
        (value: string) => {
            onSelect(value)
            setIsOpen(false)
        },
        [onSelect, setIsOpen]
    )

    // Stop the mousedown from moving DOM focus off the ProseMirror
    // editor — same rationale as FormatButton in DocumentToolbar.tsx.
    const webProps =
        Platform.OS === 'web'
            ? { onMouseDown: (e: { preventDefault: () => void }) => e.preventDefault() }
            : {}

    // The underline bar shows the active color; when no color is
    // applied the bar is transparent (no visible underline) so the
    // button reads as "no color set" rather than "neutral-grey
    // color set." Matches Google Docs's affordance: empty underline
    // when no color is chosen, tinted underline after one is picked.
    const underlineColor = color || 'transparent'

    return (
        <Menu isOpen={isOpen} onOpenChange={setIsOpen}>
            <View {...(typeof document !== 'undefined' ? { 'data-tinycld-menu': 'trigger' } : {})}>
                <Menu.Trigger>
                    <ToolbarTooltip label={accessibilityLabel}>
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={accessibilityLabel}
                            accessibilityState={{ disabled, expanded: isOpen }}
                            disabled={disabled}
                            {...webProps}
                            className="rounded-md p-1.5"
                            style={{ opacity: disabled ? 0.4 : 1 }}
                            hitSlop={
                                Platform.OS === 'web'
                                    ? undefined
                                    : { top: 6, bottom: 6, left: 4, right: 4 }
                            }
                        >
                            <View className="items-center justify-center" style={{ gap: 1 }}>
                                <Icon size={16} color={iconColor} />
                                <View
                                    style={{
                                        height: 3,
                                        width: 16,
                                        backgroundColor: underlineColor,
                                        borderRadius: 1,
                                    }}
                                />
                            </View>
                        </Pressable>
                    </ToolbarTooltip>
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
                        <ColorPickerGrid
                            selected={color}
                            onSelect={handleSelect}
                            showClear
                            clearLabel="No color"
                        />
                    </View>
                </Menu.Content>
            </Menu.Portal>
        </Menu>
    )
}
