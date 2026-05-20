import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Menu } from '@tinycld/core/ui/menu'
import type { LucideIcon } from 'lucide-react-native'
import { Check, MoreVertical } from 'lucide-react-native'
import { Pressable, View } from 'react-native'
import { ToolbarIconButton } from './ToolbarIconButton'

interface ToolbarMenuProps {
    icon: LucideIcon
    label: string
    children: React.ReactNode
}

export function ToolbarMenu({ icon, label, children }: ToolbarMenuProps) {
    return (
        <Menu>
            <Menu.Trigger>
                <ToolbarIconButton icon={icon} label={label} />
            </Menu.Trigger>
            <Menu.Portal>
                <Menu.Overlay />
                <Menu.Content presentation="popover" placement="bottom" align="start">
                    {children}
                </Menu.Content>
            </Menu.Portal>
        </Menu>
    )
}

interface MenuActionItemProps {
    label: string
    icon?: LucideIcon
    /** Custom leading element. Takes precedence over `icon` and `colorDot`. */
    leading?: React.ReactNode
    onPress: () => void
    href?: string
    isActive?: boolean
    colorDot?: string
    disabled?: boolean
}

export function MenuActionItem({
    label,
    icon: Icon,
    leading,
    onPress,
    href,
    isActive,
    colorDot,
    disabled,
}: MenuActionItemProps) {
    const mutedColor = useThemeColor('muted-foreground')
    const primaryColor = useThemeColor('primary')

    return (
        <Menu.Item onPress={disabled ? undefined : onPress} href={href} isDisabled={disabled}>
            {leading ? (
                leading
            ) : Icon ? (
                <Icon size={16} color={mutedColor} />
            ) : colorDot ? (
                <View
                    style={{
                        width: 12,
                        height: 12,
                        borderRadius: 6,
                        marginHorizontal: 2,
                        backgroundColor: colorDot,
                    }}
                />
            ) : (
                <View className="w-4" />
            )}
            <Menu.ItemTitle>{label}</Menu.ItemTitle>
            {isActive ? (
                <Check size={14} color={primaryColor} style={{ marginLeft: 'auto' }} />
            ) : null}
        </Menu.Item>
    )
}

interface DotsMenuProps {
    children: React.ReactNode
    size?: number
}

function stopPropagationOnly(e: React.MouseEvent) {
    e.stopPropagation()
}

export function DotsMenu({ children, size = 16 }: DotsMenuProps) {
    const mutedColor = useThemeColor('muted-foreground')

    return (
        // biome-ignore lint/a11y/useKeyWithClickEvents: stopPropagation wrapper only
        // biome-ignore lint/a11y/noStaticElementInteractions: stopPropagation wrapper only
        <div onClick={stopPropagationOnly} style={{ display: 'inline-flex' }}>
            <Menu>
                <Menu.Trigger>
                    <Pressable className="p-1.5 rounded-full" accessibilityLabel="More actions">
                        <MoreVertical size={size} color={mutedColor} />
                    </Pressable>
                </Menu.Trigger>
                <Menu.Portal>
                    <Menu.Overlay />
                    <Menu.Content presentation="popover" placement="bottom" align="start">
                        {children}
                    </Menu.Content>
                </Menu.Portal>
            </Menu>
        </div>
    )
}

interface MenuCheckboxItemProps {
    label: string
    checked: boolean
    onToggle: () => void
    colorDot?: string
}

export function MenuCheckboxItem({ label, checked, onToggle, colorDot }: MenuCheckboxItemProps) {
    const primaryColor = useThemeColor('primary')

    return (
        <Menu.Item onPress={onToggle}>
            {colorDot ? (
                <View
                    style={{
                        width: 14,
                        height: 14,
                        borderRadius: 3,
                        borderWidth: 2,
                        backgroundColor: checked ? colorDot : 'transparent',
                        borderColor: colorDot,
                    }}
                />
            ) : null}
            <Menu.ItemTitle>{label}</Menu.ItemTitle>
            {checked ? (
                <Check size={14} color={primaryColor} style={{ marginLeft: 'auto' }} />
            ) : null}
        </Menu.Item>
    )
}

export function MenuSectionLabel({ children }: { children: string }) {
    return <Menu.Label>{children}</Menu.Label>
}

export { Separator as MenuSeparator } from '@tinycld/core/ui/menu'
