import { Menu, MenuBarMenu, Separator } from '@tinycld/core/ui/menubar'
import type { MenuBarProps } from './MenuBar'

export function ViewMenu(props: MenuBarProps) {
    const hiddenSheets = props.allSheets.filter(s => s.hidden)
    const hasHidden = hiddenSheets.length > 0

    return (
        <MenuBarMenu menuId="view" label="View">
            <Menu.Sub>
                <Menu.SubTrigger>
                    <Menu.ItemTitle>Freeze</Menu.ItemTitle>
                </Menu.SubTrigger>
                <Menu.SubContent>
                    <Menu.Item onPress={() => props.onSetFrozenRows(0)}>
                        <Menu.ItemTitle>No rows</Menu.ItemTitle>
                    </Menu.Item>
                    <Menu.Item onPress={() => props.onSetFrozenRows(1)}>
                        <Menu.ItemTitle>1 row</Menu.ItemTitle>
                    </Menu.Item>
                    <Menu.Item onPress={() => props.onSetFrozenRows(2)}>
                        <Menu.ItemTitle>2 rows</Menu.ItemTitle>
                    </Menu.Item>
                    {props.selectionBottomRow != null && (
                        <Menu.Item
                            onPress={() => props.onSetFrozenRows(props.selectionBottomRow ?? 0)}
                        >
                            <Menu.ItemTitle>
                                {`Up to row ${props.selectionBottomRow}`}
                            </Menu.ItemTitle>
                        </Menu.Item>
                    )}
                    <Separator />
                    <Menu.Item onPress={() => props.onSetFrozenCols(0)}>
                        <Menu.ItemTitle>No columns</Menu.ItemTitle>
                    </Menu.Item>
                    <Menu.Item onPress={() => props.onSetFrozenCols(1)}>
                        <Menu.ItemTitle>1 column</Menu.ItemTitle>
                    </Menu.Item>
                    <Menu.Item onPress={() => props.onSetFrozenCols(2)}>
                        <Menu.ItemTitle>2 columns</Menu.ItemTitle>
                    </Menu.Item>
                    {props.selectionRightCol != null && (
                        <Menu.Item
                            onPress={() => props.onSetFrozenCols(props.selectionRightCol ?? 0)}
                        >
                            <Menu.ItemTitle>
                                {`Up to column ${props.selectionRightCol}`}
                            </Menu.ItemTitle>
                        </Menu.Item>
                    )}
                    <Separator />
                    <Menu.Item onPress={props.onUnfreeze}>
                        <Menu.ItemTitle>Unfreeze</Menu.ItemTitle>
                    </Menu.Item>
                </Menu.SubContent>
            </Menu.Sub>
            <Menu.Item onPress={props.onShowComments}>
                <Menu.ItemTitle>Show comments</Menu.ItemTitle>
            </Menu.Item>
            <Menu.Sub>
                <Menu.SubTrigger>
                    <Menu.ItemTitle>Hidden sheets</Menu.ItemTitle>
                </Menu.SubTrigger>
                <Menu.SubContent>
                    {!hasHidden && (
                        <Menu.Item isDisabled>
                            <Menu.ItemTitle>(no hidden sheets)</Menu.ItemTitle>
                        </Menu.Item>
                    )}
                    {hiddenSheets.map(s => (
                        <Menu.Item key={s.id} onPress={() => props.onShowSheet(s.id)}>
                            <Menu.ItemTitle>{s.name}</Menu.ItemTitle>
                        </Menu.Item>
                    ))}
                </Menu.SubContent>
            </Menu.Sub>
        </MenuBarMenu>
    )
}
