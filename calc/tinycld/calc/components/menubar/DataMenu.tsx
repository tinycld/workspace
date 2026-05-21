import { Menu, MenuBarMenu } from '@tinycld/core/ui/menubar'
import type { MenuBarProps } from './MenuBar'

export function DataMenu(props: MenuBarProps) {
    return (
        <MenuBarMenu menuId="data" label="Data">
            <Menu.Item onPress={props.onOpenSort} isDisabled={props.disabled}>
                <Menu.ItemTitle>Sort range</Menu.ItemTitle>
            </Menu.Item>
            <Menu.Item onPress={props.onToggleFilter} isDisabled={props.disabled}>
                <Menu.ItemTitle>
                    {props.isFilterActive ? 'Remove filter' : 'Create a filter'}
                </Menu.ItemTitle>
            </Menu.Item>
        </MenuBarMenu>
    )
}
