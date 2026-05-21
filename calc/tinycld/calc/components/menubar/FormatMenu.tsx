import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Menu, MenuBarMenu, MenuShortcut, Separator } from '@tinycld/core/ui/menubar'
import { Check } from 'lucide-react-native'
import { View } from 'react-native'
import { numberFormatPresets } from '../toolbar/NumberFormatMenu'
import type { MenuBarProps } from './MenuBar'

const FONT_SIZES = [8, 9, 10, 11, 12, 14, 18, 24, 36]

function CheckedIndicator({ isOn }: { isOn: boolean }) {
    const fg = useThemeColor('foreground')
    if (!isOn) return <View style={{ width: 14 }} />
    return <Check size={14} color={fg} />
}

export function FormatMenu(props: MenuBarProps) {
    return (
        <MenuBarMenu menuId="format" label="Format">
            <Menu.Sub>
                <Menu.SubTrigger>
                    <Menu.ItemTitle>Number</Menu.ItemTitle>
                </Menu.SubTrigger>
                <Menu.SubContent>
                    {numberFormatPresets.map(preset => (
                        <Menu.Item
                            key={preset.id}
                            onPress={() => props.onApplyPreset(preset.id)}
                            isDisabled={props.disabled}
                        >
                            <Menu.ItemTitle>{preset.label}</Menu.ItemTitle>
                        </Menu.Item>
                    ))}
                </Menu.SubContent>
            </Menu.Sub>
            <Menu.Sub>
                <Menu.SubTrigger>
                    <Menu.ItemTitle>Text</Menu.ItemTitle>
                </Menu.SubTrigger>
                <Menu.SubContent>
                    <Menu.Item onPress={props.onToggleBold} isDisabled={props.disabled}>
                        <CheckedIndicator isOn={props.isBold} />
                        <Menu.ItemTitle>Bold</Menu.ItemTitle>
                        <MenuShortcut keys="⌘B" />
                    </Menu.Item>
                    <Menu.Item onPress={props.onToggleItalic} isDisabled={props.disabled}>
                        <CheckedIndicator isOn={props.isItalic} />
                        <Menu.ItemTitle>Italic</Menu.ItemTitle>
                        <MenuShortcut keys="⌘I" />
                    </Menu.Item>
                    <Menu.Item onPress={props.onToggleUnderline} isDisabled={props.disabled}>
                        <CheckedIndicator isOn={props.isUnderline} />
                        <Menu.ItemTitle>Underline</Menu.ItemTitle>
                        <MenuShortcut keys="⌘U" />
                    </Menu.Item>
                    <Menu.Item onPress={props.onToggleStrike} isDisabled={props.disabled}>
                        <CheckedIndicator isOn={props.isStrike} />
                        <Menu.ItemTitle>Strikethrough</Menu.ItemTitle>
                        <MenuShortcut keys="⌘⇧X" />
                    </Menu.Item>
                </Menu.SubContent>
            </Menu.Sub>
            <Menu.Sub>
                <Menu.SubTrigger>
                    <Menu.ItemTitle>Alignment</Menu.ItemTitle>
                </Menu.SubTrigger>
                <Menu.SubContent>
                    <Menu.Item
                        onPress={() => props.onSetHorizontalAlign('left')}
                        isDisabled={props.disabled}
                    >
                        <CheckedIndicator isOn={props.horizontalAlign === 'left'} />
                        <Menu.ItemTitle>Left</Menu.ItemTitle>
                    </Menu.Item>
                    <Menu.Item
                        onPress={() => props.onSetHorizontalAlign('center')}
                        isDisabled={props.disabled}
                    >
                        <CheckedIndicator isOn={props.horizontalAlign === 'center'} />
                        <Menu.ItemTitle>Center</Menu.ItemTitle>
                    </Menu.Item>
                    <Menu.Item
                        onPress={() => props.onSetHorizontalAlign('right')}
                        isDisabled={props.disabled}
                    >
                        <CheckedIndicator isOn={props.horizontalAlign === 'right'} />
                        <Menu.ItemTitle>Right</Menu.ItemTitle>
                    </Menu.Item>
                </Menu.SubContent>
            </Menu.Sub>
            <Menu.Sub>
                <Menu.SubTrigger>
                    <Menu.ItemTitle>Font size</Menu.ItemTitle>
                </Menu.SubTrigger>
                <Menu.SubContent>
                    {FONT_SIZES.map(size => (
                        <Menu.Item
                            key={size}
                            onPress={() => props.onSetFontSize(size)}
                            isDisabled={props.disabled}
                        >
                            <CheckedIndicator isOn={props.fontSize === size} />
                            <Menu.ItemTitle>{String(size)}</Menu.ItemTitle>
                        </Menu.Item>
                    ))}
                </Menu.SubContent>
            </Menu.Sub>
            <Menu.Sub>
                <Menu.SubTrigger>
                    <Menu.ItemTitle>Merge cells</Menu.ItemTitle>
                </Menu.SubTrigger>
                <Menu.SubContent>
                    <Menu.Item onPress={props.onMergeAll} isDisabled={props.disabled}>
                        <Menu.ItemTitle>Merge all</Menu.ItemTitle>
                    </Menu.Item>
                    <Menu.Item onPress={props.onMergeHorizontal} isDisabled={props.disabled}>
                        <Menu.ItemTitle>Merge horizontally</Menu.ItemTitle>
                    </Menu.Item>
                    <Menu.Item onPress={props.onMergeVertical} isDisabled={props.disabled}>
                        <Menu.ItemTitle>Merge vertically</Menu.ItemTitle>
                    </Menu.Item>
                    <Menu.Item onPress={props.onUnmerge} isDisabled={props.disabled}>
                        <Menu.ItemTitle>Unmerge</Menu.ItemTitle>
                    </Menu.Item>
                </Menu.SubContent>
            </Menu.Sub>
            <Separator />
            <Menu.Item onPress={props.onOpenConditionalFormatting}>
                <Menu.ItemTitle>Conditional formatting…</Menu.ItemTitle>
            </Menu.Item>
            <Separator />
            <Menu.Item onPress={props.onClearFormatting} isDisabled={props.disabled}>
                <Menu.ItemTitle>Clear formatting</Menu.ItemTitle>
                <MenuShortcut keys="⌘\" />
            </Menu.Item>
        </MenuBarMenu>
    )
}
