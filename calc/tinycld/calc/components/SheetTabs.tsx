import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Menu, Separator } from '@tinycld/core/ui/menu'
import { Plus } from 'lucide-react-native'
import { useCallback, useState } from 'react'
import {
    type GestureResponderEvent,
    Platform,
    Pressable,
    ScrollView,
    Text,
    View,
} from 'react-native'
import type * as Y from 'yjs'
import { useSheetActions } from '../hooks/use-sheet-actions'
import { useSheetTabsStore } from '../hooks/use-sheet-tabs-store'
import type { SheetWithId } from '../hooks/use-y-sheets'
import { RenameSheetInput } from './sheet-tabs/RenameSheetInput'
import { SheetTabContextMenu } from './sheet-tabs/SheetTabContextMenu'

const TAB_HEIGHT = 28
const TAB_MIN_WIDTH = 80
const TAB_MAX_WIDTH = 200
const COLOR_BAND_HEIGHT = 3

interface SheetTabsProps {
    doc: Y.Doc | null
    allSheets: SheetWithId[]
    activeSheetId: string
    onSelect: (sheetId: string) => void
}

// SheetTabs renders Excel-style file-folder tabs along the bottom of
// the workbook. Always renders — even with one or zero sheets — so
// the trailing "+" button is reachable.
//
// The strip sits on a 1px bottom border that runs the full width.
// Active tab uses bg-background (visually flush with the grid above
// it, "elevated" toward the user). Inactive tabs use
// bg-surface-secondary with muted text and a top divider so the
// stack reads as folder tabs in front of a back wall.
//
// Right-click on a tab opens SheetTabContextMenu; double-click enters
// inline rename mode via RenameSheetInput. Hidden sheets surface
// through the "+" button's submenu.
export function SheetTabs({ doc, allSheets, activeSheetId, onSelect }: SheetTabsProps) {
    const visibleSheets = allSheets.filter(s => !s.hidden)
    const hiddenSheets = allSheets.filter(s => s.hidden === true)
    const renamingId = useSheetTabsStore(s => s.renamingId)
    const startRename = useSheetTabsStore(s => s.startRename)
    const cancelRename = useSheetTabsStore(s => s.cancelRename)
    const openContextMenu = useSheetTabsStore(s => s.openContextMenu)
    const actions = useSheetActions(doc)

    const handleAdd = useCallback(() => {
        const id = actions.addSheet()
        if (id) onSelect(id)
    }, [actions, onSelect])

    const handleShow = useCallback(
        (sheetId: string) => {
            actions.showSheet(sheetId)
            onSelect(sheetId)
        },
        [actions, onSelect]
    )

    const handleRenameCommit = useCallback(
        (sheetId: string, next: string) => {
            // Whether or not the rename succeeds, close the editor.
            // A failed rename leaves the original name in place; the
            // user can re-trigger via the context menu.
            actions.renameSheet(sheetId, next)
            cancelRename()
        },
        [actions, cancelRename]
    )

    return (
        <View className="border-t border-border bg-surface-secondary">
            <View className="flex-row items-end">
                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={{ alignItems: 'flex-end' }}
                    style={{ flex: 1 }}
                >
                    {visibleSheets.map(sheet => (
                        <SheetTab
                            key={sheet.id}
                            sheet={sheet}
                            isActive={sheet.id === activeSheetId}
                            isRenaming={sheet.id === renamingId}
                            onSelect={onSelect}
                            onStartRename={startRename}
                            onOpenContextMenu={openContextMenu}
                            onRenameCommit={handleRenameCommit}
                            onRenameCancel={cancelRename}
                        />
                    ))}
                </ScrollView>
                <AddSheetButton onAdd={handleAdd} hiddenSheets={hiddenSheets} onShow={handleShow} />
            </View>
            <SheetTabContextMenu
                doc={doc}
                allSheets={allSheets}
                activeSheetId={activeSheetId}
                onSelect={onSelect}
            />
        </View>
    )
}

interface SheetTabProps {
    sheet: SheetWithId
    isActive: boolean
    isRenaming: boolean
    onSelect: (id: string) => void
    onStartRename: (id: string) => void
    onOpenContextMenu: (id: string, x: number, y: number) => void
    onRenameCommit: (id: string, next: string) => void
    onRenameCancel: () => void
}

function SheetTab({
    sheet,
    isActive,
    isRenaming,
    onSelect,
    onStartRename,
    onOpenContextMenu,
    onRenameCommit,
    onRenameCancel,
}: SheetTabProps) {
    // Web: native contextmenu + dblclick. Native: long-press surfaces
    // the context menu (RN Pressable has no contextmenu event); single
    // press selects, with rename triggered exclusively from the menu.
    //
    // iPad runs Expo Web (Platform.OS === 'web') but has no right-click,
    // so the web branch also wires onLongPress on a Pressable inside
    // the wrapping div — touch surfaces the context menu at the
    // gesture's pageX/pageY, mirroring the right-click path.
    const handleSelect = useCallback(() => onSelect(sheet.id), [onSelect, sheet.id])
    const handleLongPress = useCallback(
        (e: GestureResponderEvent) => {
            const { pageX, pageY } = e.nativeEvent
            onOpenContextMenu(sheet.id, pageX, pageY)
        },
        [onOpenContextMenu, sheet.id]
    )

    if (Platform.OS === 'web') {
        return (
            <div
                onContextMenu={(e: React.MouseEvent) => {
                    e.preventDefault()
                    onOpenContextMenu(sheet.id, e.clientX, e.clientY)
                }}
                onDoubleClick={() => onStartRename(sheet.id)}
            >
                <Pressable
                    onPress={handleSelect}
                    onLongPress={handleLongPress}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: isActive }}
                >
                    <TabBody
                        sheet={sheet}
                        isActive={isActive}
                        isRenaming={isRenaming}
                        onPress={handleSelect}
                        onRenameCommit={onRenameCommit}
                        onRenameCancel={onRenameCancel}
                    />
                </Pressable>
            </div>
        )
    }

    return (
        <Pressable
            onPress={handleSelect}
            onLongPress={handleLongPress}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
        >
            <TabBody
                sheet={sheet}
                isActive={isActive}
                isRenaming={isRenaming}
                onPress={handleSelect}
                onRenameCommit={onRenameCommit}
                onRenameCancel={onRenameCancel}
            />
        </Pressable>
    )
}

interface TabBodyProps {
    sheet: SheetWithId
    isActive: boolean
    isRenaming: boolean
    onPress: () => void
    onRenameCommit: (id: string, next: string) => void
    onRenameCancel: () => void
}

function TabBody({ sheet, isActive, isRenaming, onPress, onRenameCommit, onRenameCancel }: TabBodyProps) {
    const className = isActive
        ? 'flex-row items-center justify-center px-3 bg-background border-l border-r border-t border-border rounded-t-md'
        : 'flex-row items-center justify-center px-3 bg-surface-secondary border-r border-border'
    return (
        <View
            accessibilityLabel={`Sheet ${sheet.name}`}
            style={{
                height: TAB_HEIGHT,
                minWidth: TAB_MIN_WIDTH,
                maxWidth: TAB_MAX_WIDTH,
            }}
            className={className}
        >
            {isRenaming ? (
                <RenameSheetInput
                    initialValue={sheet.name}
                    onCommit={next => onRenameCommit(sheet.id, next)}
                    onCancel={onRenameCancel}
                />
            ) : (
                <Pressable onPress={onPress}>
                    <Text
                        numberOfLines={1}
                        className={
                            isActive
                                ? 'text-xs font-medium text-foreground'
                                : 'text-xs text-muted-foreground'
                        }
                    >
                        {sheet.name}
                    </Text>
                </Pressable>
            )}
            {sheet.color ? <ColorBand color={sheet.color} /> : null}
        </View>
    )
}

function ColorBand({ color }: { color: string }) {
    return (
        <View
            style={{
                position: 'absolute',
                left: 0,
                right: 0,
                bottom: 0,
                height: COLOR_BAND_HEIGHT,
                backgroundColor: color,
            }}
        />
    )
}

interface AddSheetButtonProps {
    onAdd: () => void
    hiddenSheets: SheetWithId[]
    onShow: (id: string) => void
}

function AddSheetButton({ onAdd, hiddenSheets, onShow }: AddSheetButtonProps) {
    const [menuOpen, setMenuOpen] = useState(false)
    const hasHidden = hiddenSheets.length > 0
    const fg = useThemeColor('muted-foreground')
    return (
        <View className="flex-row items-end" style={{ height: TAB_HEIGHT }}>
            <Pressable
                onPress={onAdd}
                accessibilityRole="button"
                accessibilityLabel="Add sheet"
                className="px-3 items-center justify-center border-l border-r border-border bg-surface-secondary"
                style={{ height: TAB_HEIGHT }}
            >
                <Plus size={14} color={fg} />
            </Pressable>
            {hasHidden ? (
                <Menu isOpen={menuOpen} onOpenChange={setMenuOpen}>
                    <Menu.Trigger>
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Show hidden sheets"
                            className="px-3 items-center justify-center border-r border-border bg-surface-secondary"
                            style={{ height: TAB_HEIGHT }}
                        >
                            <Text className="text-xs text-muted-foreground">⋯</Text>
                        </Pressable>
                    </Menu.Trigger>
                    <Menu.Portal>
                        <Menu.Content placement="top" align="start">
                            <Menu.Label>Hidden sheets</Menu.Label>
                            <Separator className="my-1 mx-2" />
                            {hiddenSheets.map(sheet => (
                                <Menu.Item key={sheet.id} onPress={() => onShow(sheet.id)}>
                                    <Menu.ItemTitle>{sheet.name}</Menu.ItemTitle>
                                </Menu.Item>
                            ))}
                        </Menu.Content>
                    </Menu.Portal>
                </Menu>
            ) : null}
        </View>
    )
}
