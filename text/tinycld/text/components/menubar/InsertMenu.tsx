import { Menu, MenuBarMenu, MenuShortcut } from '@tinycld/core/ui/menubar'
import { useImageInsert } from '../ImageInsertButton'
import type { MenuBarProps } from './MenuBar'

const TABLE_PRESETS: ReadonlyArray<{ rows: number; cols: number; label: string }> = [
    { rows: 2, cols: 2, label: '2 × 2' },
    { rows: 3, cols: 3, label: '3 × 3' },
    { rows: 4, cols: 4, label: '4 × 4' },
    { rows: 5, cols: 5, label: '5 × 5' },
]

export function InsertMenu(props: MenuBarProps) {
    const { commands, disabled, onRequestInsertLink, onInsertImage } = props
    const handleImage = useImageInsert(onInsertImage)

    return (
        <MenuBarMenu menuId="insert" label="Insert">
            <Menu.Item onPress={handleImage} isDisabled={disabled}>
                <Menu.ItemTitle>Image</Menu.ItemTitle>
            </Menu.Item>
            <Menu.Sub>
                <Menu.SubTrigger>
                    <Menu.ItemTitle>Table</Menu.ItemTitle>
                </Menu.SubTrigger>
                <Menu.SubContent>
                    {TABLE_PRESETS.map(preset => (
                        <Menu.Item
                            key={preset.label}
                            onPress={() => commands.insertTable?.(preset.rows, preset.cols)}
                            isDisabled={disabled || commands.insertTable == null}
                        >
                            <Menu.ItemTitle>{preset.label}</Menu.ItemTitle>
                        </Menu.Item>
                    ))}
                </Menu.SubContent>
            </Menu.Sub>
            <Menu.Item onPress={onRequestInsertLink} isDisabled={disabled}>
                <Menu.ItemTitle>Link</Menu.ItemTitle>
                <MenuShortcut keys="⌘K" />
            </Menu.Item>
        </MenuBarMenu>
    )
}
