import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Menu, MenuBarMenu, MenuShortcut, Separator } from '@tinycld/core/ui/menubar'
import { Check } from 'lucide-react-native'
import { View } from 'react-native'
import type { MenuBarProps } from './MenuBar'

function CheckedIndicator({ isOn }: { isOn: boolean }) {
    const fg = useThemeColor('foreground')
    if (!isOn) return <View style={{ width: 14 }} />
    return <Check size={14} color={fg} />
}

export function FormatMenu(props: MenuBarProps) {
    const { commands, toolbarState, disabled } = props
    const isInTable = toolbarState.isInTable ?? false
    const tableOpsDisabled = disabled || !isInTable

    return (
        <MenuBarMenu menuId="format" label="Format">
            <Menu.Sub>
                <Menu.SubTrigger>
                    <Menu.ItemTitle>Text</Menu.ItemTitle>
                </Menu.SubTrigger>
                <Menu.SubContent>
                    <Menu.Item onPress={() => commands.toggleBold()} isDisabled={disabled}>
                        <CheckedIndicator isOn={toolbarState.isBoldActive} />
                        <Menu.ItemTitle>Bold</Menu.ItemTitle>
                        <MenuShortcut keys="⌘B" />
                    </Menu.Item>
                    <Menu.Item onPress={() => commands.toggleItalic()} isDisabled={disabled}>
                        <CheckedIndicator isOn={toolbarState.isItalicActive} />
                        <Menu.ItemTitle>Italic</Menu.ItemTitle>
                        <MenuShortcut keys="⌘I" />
                    </Menu.Item>
                    <Menu.Item onPress={() => commands.toggleUnderline()} isDisabled={disabled}>
                        <CheckedIndicator isOn={toolbarState.isUnderlineActive} />
                        <Menu.ItemTitle>Underline</Menu.ItemTitle>
                        <MenuShortcut keys="⌘U" />
                    </Menu.Item>
                    <Menu.Item
                        onPress={() => commands.toggleCode?.()}
                        isDisabled={disabled}
                    >
                        <CheckedIndicator isOn={toolbarState.isCodeActive ?? false} />
                        <Menu.ItemTitle>Inline code</Menu.ItemTitle>
                        <MenuShortcut keys="⌘`" />
                    </Menu.Item>
                    <Menu.Item
                        onPress={() => commands.toggleCodeBlock?.()}
                        isDisabled={disabled}
                    >
                        <CheckedIndicator isOn={toolbarState.isCodeBlockActive ?? false} />
                        <Menu.ItemTitle>Code block</Menu.ItemTitle>
                        <MenuShortcut keys="⌘⇧`" />
                    </Menu.Item>
                </Menu.SubContent>
            </Menu.Sub>
            <Menu.Sub>
                <Menu.SubTrigger>
                    <Menu.ItemTitle>Paragraph styles</Menu.ItemTitle>
                </Menu.SubTrigger>
                <Menu.SubContent>
                    <Menu.Item
                        onPress={() => {
                            const lvl = toolbarState.activeHeadingLevel
                            if (lvl != null) commands.toggleHeading(lvl)
                        }}
                        isDisabled={disabled || toolbarState.activeHeadingLevel == null}
                    >
                        <CheckedIndicator
                            isOn={
                                toolbarState.activeHeadingLevel == null ||
                                toolbarState.activeHeadingLevel === 0
                            }
                        />
                        <Menu.ItemTitle>Normal text</Menu.ItemTitle>
                    </Menu.Item>
                    <Menu.Item onPress={() => commands.toggleHeading(1)} isDisabled={disabled}>
                        <CheckedIndicator isOn={toolbarState.activeHeadingLevel === 1} />
                        <Menu.ItemTitle>Heading 1</Menu.ItemTitle>
                    </Menu.Item>
                    <Menu.Item onPress={() => commands.toggleHeading(2)} isDisabled={disabled}>
                        <CheckedIndicator isOn={toolbarState.activeHeadingLevel === 2} />
                        <Menu.ItemTitle>Heading 2</Menu.ItemTitle>
                    </Menu.Item>
                    <Menu.Item onPress={() => commands.toggleHeading(3)} isDisabled={disabled}>
                        <CheckedIndicator isOn={toolbarState.activeHeadingLevel === 3} />
                        <Menu.ItemTitle>Heading 3</Menu.ItemTitle>
                    </Menu.Item>
                </Menu.SubContent>
            </Menu.Sub>
            <Menu.Sub>
                <Menu.SubTrigger>
                    <Menu.ItemTitle>Bullets &amp; numbering</Menu.ItemTitle>
                </Menu.SubTrigger>
                <Menu.SubContent>
                    <Menu.Item onPress={() => commands.toggleBulletList()} isDisabled={disabled}>
                        <CheckedIndicator isOn={toolbarState.isBulletListActive} />
                        <Menu.ItemTitle>Bulleted list</Menu.ItemTitle>
                    </Menu.Item>
                    <Menu.Item onPress={() => commands.toggleOrderedList()} isDisabled={disabled}>
                        <CheckedIndicator isOn={toolbarState.isOrderedListActive} />
                        <Menu.ItemTitle>Numbered list</Menu.ItemTitle>
                    </Menu.Item>
                    <Menu.Item onPress={() => commands.toggleBlockquote()} isDisabled={disabled}>
                        <CheckedIndicator isOn={toolbarState.isBlockquoteActive} />
                        <Menu.ItemTitle>Blockquote</Menu.ItemTitle>
                    </Menu.Item>
                </Menu.SubContent>
            </Menu.Sub>
            <Menu.Sub>
                <Menu.SubTrigger>
                    <Menu.ItemTitle>Align &amp; indent</Menu.ItemTitle>
                </Menu.SubTrigger>
                <Menu.SubContent>
                    <Menu.Item
                        onPress={() => commands.setTextAlign?.('left')}
                        isDisabled={disabled}
                    >
                        <CheckedIndicator
                            isOn={
                                toolbarState.currentAlign === 'left' ||
                                toolbarState.currentAlign == null
                            }
                        />
                        <Menu.ItemTitle>Align left</Menu.ItemTitle>
                        <MenuShortcut keys="⌘⇧L" />
                    </Menu.Item>
                    <Menu.Item
                        onPress={() => commands.setTextAlign?.('center')}
                        isDisabled={disabled}
                    >
                        <CheckedIndicator isOn={toolbarState.currentAlign === 'center'} />
                        <Menu.ItemTitle>Center</Menu.ItemTitle>
                        <MenuShortcut keys="⌘⇧E" />
                    </Menu.Item>
                    <Menu.Item
                        onPress={() => commands.setTextAlign?.('right')}
                        isDisabled={disabled}
                    >
                        <CheckedIndicator isOn={toolbarState.currentAlign === 'right'} />
                        <Menu.ItemTitle>Align right</Menu.ItemTitle>
                        <MenuShortcut keys="⌘⇧R" />
                    </Menu.Item>
                    <Menu.Item
                        onPress={() => commands.setTextAlign?.('justify')}
                        isDisabled={disabled}
                    >
                        <CheckedIndicator isOn={toolbarState.currentAlign === 'justify'} />
                        <Menu.ItemTitle>Justify</Menu.ItemTitle>
                        <MenuShortcut keys="⌘⇧J" />
                    </Menu.Item>
                    <Separator />
                    <Menu.Item
                        onPress={() => commands.indentBlock?.()}
                        isDisabled={disabled || !(toolbarState.canIndent ?? false)}
                    >
                        <View style={{ width: 14 }} />
                        <Menu.ItemTitle>Increase indent</Menu.ItemTitle>
                        <MenuShortcut keys="⌘]" />
                    </Menu.Item>
                    <Menu.Item
                        onPress={() => commands.outdentBlock?.()}
                        isDisabled={disabled || !(toolbarState.canOutdent ?? false)}
                    >
                        <View style={{ width: 14 }} />
                        <Menu.ItemTitle>Decrease indent</Menu.ItemTitle>
                        <MenuShortcut keys="⌘[" />
                    </Menu.Item>
                </Menu.SubContent>
            </Menu.Sub>
            <Separator />
            <Menu.Sub>
                <Menu.SubTrigger>
                    <Menu.ItemTitle>Table</Menu.ItemTitle>
                </Menu.SubTrigger>
                <Menu.SubContent>
                    <Menu.Item
                        onPress={() => commands.addRowBefore?.()}
                        isDisabled={tableOpsDisabled}
                    >
                        <Menu.ItemTitle>Insert row above</Menu.ItemTitle>
                    </Menu.Item>
                    <Menu.Item
                        onPress={() => commands.addRowAfter?.()}
                        isDisabled={tableOpsDisabled}
                    >
                        <Menu.ItemTitle>Insert row below</Menu.ItemTitle>
                    </Menu.Item>
                    <Menu.Item
                        onPress={() => commands.addColumnBefore?.()}
                        isDisabled={tableOpsDisabled}
                    >
                        <Menu.ItemTitle>Insert column left</Menu.ItemTitle>
                    </Menu.Item>
                    <Menu.Item
                        onPress={() => commands.addColumnAfter?.()}
                        isDisabled={tableOpsDisabled}
                    >
                        <Menu.ItemTitle>Insert column right</Menu.ItemTitle>
                    </Menu.Item>
                    <Separator />
                    <Menu.Item
                        onPress={() => commands.deleteRow?.()}
                        isDisabled={tableOpsDisabled}
                    >
                        <Menu.ItemTitle>Delete row</Menu.ItemTitle>
                    </Menu.Item>
                    <Menu.Item
                        onPress={() => commands.deleteColumn?.()}
                        isDisabled={tableOpsDisabled}
                    >
                        <Menu.ItemTitle>Delete column</Menu.ItemTitle>
                    </Menu.Item>
                    <Menu.Item
                        onPress={() => commands.deleteTable?.()}
                        isDisabled={tableOpsDisabled}
                    >
                        <Menu.ItemTitle>Delete table</Menu.ItemTitle>
                    </Menu.Item>
                </Menu.SubContent>
            </Menu.Sub>
        </MenuBarMenu>
    )
}
