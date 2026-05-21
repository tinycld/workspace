import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Menu, useOpenMenu } from '@tinycld/core/ui/menubar'
import { AlignCenter, AlignLeft, AlignRight, ChevronDown } from 'lucide-react-native'
import type { ComponentType } from 'react'
import { useCallback } from 'react'
import { Platform, Pressable, View } from 'react-native'
import type { HorizontalAlign } from '../../hooks/grid/use-grid-format-controls'
import { ToolbarButton } from './ToolbarButton'

const ALIGN_OPTIONS: ReadonlyArray<{
    value: HorizontalAlign
    icon: ComponentType<{ size?: number; color?: string }>
    label: string
}> = [
    { value: 'left', icon: AlignLeft, label: 'Align left' },
    { value: 'center', icon: AlignCenter, label: 'Align center' },
    { value: 'right', icon: AlignRight, label: 'Align right' },
]

interface HorizontalAlignMenuProps {
    align: HorizontalAlign | undefined
    disabled: boolean
    onSetAlign: (align: HorizontalAlign) => void
}

// Trigger displays the active alignment's icon (defaulting to "left")
// plus a chevron, matching Google Sheets. The popover is a row of
// three icon buttons with the active one highlighted.
export function HorizontalAlignMenu({ align, disabled, onSetAlign }: HorizontalAlignMenuProps) {
    const fg = useThemeColor('foreground')
    const muted = useThemeColor('muted-foreground')
    const accent = useThemeColor('accent')
    const [isOpen, setIsOpen] = useOpenMenu('toolbar:horizontal-align')

    const active = align ?? 'left'
    const ActiveIcon = ALIGN_OPTIONS.find(o => o.value === active)?.icon ?? AlignLeft

    const onSelect = useCallback(
        (value: HorizontalAlign) => {
            onSetAlign(value)
            setIsOpen(false)
        },
        [onSetAlign, setIsOpen]
    )

    return (
        <Menu isOpen={isOpen} onOpenChange={setIsOpen}>
            <View {...(typeof document !== 'undefined' ? { 'data-tinycld-menu': 'trigger' } : {})}>
                <Menu.Trigger>
                    <ToolbarButton label="Horizontal align" disabled={disabled} width={36}>
                        <View className="flex-row items-center" style={{ gap: 2 }}>
                            <ActiveIcon size={14} color={fg} />
                            <ChevronDown size={10} color={muted} />
                        </View>
                    </ToolbarButton>
                </Menu.Trigger>
            </View>
            <Menu.Portal>
                <Menu.Content placement="bottom" align="start">
                    <View
                        className="flex-row items-center"
                        style={{ padding: 4, gap: 2 }}
                        {...(typeof document !== 'undefined'
                            ? { 'data-tinycld-menu': 'content' }
                            : {})}
                    >
                        {ALIGN_OPTIONS.map(option => {
                            const Icon = option.icon
                            const isActive = option.value === active
                            return (
                                <Pressable
                                    key={option.value}
                                    onPress={() => onSelect(option.value)}
                                    accessibilityLabel={option.label}
                                    accessibilityRole="button"
                                    accessibilityState={{ selected: isActive }}
                                    hitSlop={
                                        Platform.OS === 'web'
                                            ? undefined
                                            : { top: 6, bottom: 6, left: 4, right: 4 }
                                    }
                                    className={`items-center justify-center rounded ${isActive ? 'bg-accent' : ''}`}
                                    style={{
                                        width: 28,
                                        height: 24,
                                        borderWidth: isActive ? 1 : 0,
                                        borderColor: accent,
                                    }}
                                >
                                    <Icon size={14} color={fg} />
                                </Pressable>
                            )
                        })}
                    </View>
                </Menu.Content>
            </Menu.Portal>
        </Menu>
    )
}
