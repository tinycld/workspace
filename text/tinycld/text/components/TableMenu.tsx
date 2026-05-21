import type { EditorCommands } from '@tinycld/core/lib/editor/types'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Menu, Separator } from '@tinycld/core/ui/menu'
import { useState } from 'react'
import {
    type GestureResponderEvent,
    Platform,
    Pressable,
    Text,
    View,
} from 'react-native'
import {
    cellAtPosition,
    clampGridSelection,
    GRID_PICKER_DEFAULT_COLS,
    GRID_PICKER_DEFAULT_ROWS,
    type GridPickerCell,
    isCellHighlighted,
} from './table-grid-picker-model'

interface TableMenuProps {
    isOpen: boolean
    onOpenChange: (open: boolean) => void
    isInTable: boolean
    canMergeCells: boolean
    canSplitCell: boolean
    commands: EditorCommands
    // The popover anchors to the wrapped trigger element. The
    // <Menu.Trigger> child receives a press handler that toggles the
    // popover; the trigger button's measurement drives the popover's
    // x/y placement. Must be a single ReactElement (not arbitrary
    // ReactNode) because Menu.Trigger clones it to inject onPress + ref.
    trigger: React.ReactElement
}

const CELL_SIZE = 18
const CELL_GAP = 2

// TableMenu renders as a portaled popover anchored under the toolbar
// "Table" button (Menu.Content placement="bottom" align="start"). The
// content depends on caret position:
//   - Caret NOT in a table → interactive grid picker for inserting
//     a new table. Row/column ops would no-op so we hide them.
//   - Caret IS in a table  → row/column add/delete operations. The
//     grid picker is hidden because inserting a new table while inside
//     one is rarely useful (you'd nest tables, which most users don't
//     want).
//
// Selection highlight uses the brand `primary` color rather than
// `accent` — the light-mode `accent` token is a near-white pastel that
// renders invisible against the popover surface.
export function TableMenu({
    isOpen,
    onOpenChange,
    isInTable,
    canMergeCells,
    canSplitCell,
    commands,
    trigger,
}: TableMenuProps) {
    return (
        <Menu isOpen={isOpen} onOpenChange={onOpenChange}>
            <Menu.Trigger>{trigger}</Menu.Trigger>
            <Menu.Portal>
                <Menu.Content placement="bottom" align="start">
                    <TableMenuBody
                        isInTable={isInTable}
                        canMergeCells={canMergeCells}
                        canSplitCell={canSplitCell}
                        commands={commands}
                        onClose={() => onOpenChange(false)}
                    />
                </Menu.Content>
            </Menu.Portal>
        </Menu>
    )
}

interface TableMenuBodyProps {
    isInTable: boolean
    canMergeCells: boolean
    canSplitCell: boolean
    commands: EditorCommands
    onClose: () => void
}

function TableMenuBody({
    isInTable,
    canMergeCells,
    canSplitCell,
    commands,
    onClose,
}: TableMenuBodyProps) {
    if (isInTable) {
        return (
            <View className="min-w-[200px] p-1">
                <Text className="text-xs font-semibold text-foreground px-3 pt-1.5 pb-1">
                    Table
                </Text>
                <MenuRow
                    label="Add row above"
                    onPress={() => {
                        commands.addRowBefore?.()
                        onClose()
                    }}
                />
                <MenuRow
                    label="Add row below"
                    onPress={() => {
                        commands.addRowAfter?.()
                        onClose()
                    }}
                />
                <MenuRow
                    label="Add column left"
                    onPress={() => {
                        commands.addColumnBefore?.()
                        onClose()
                    }}
                />
                <MenuRow
                    label="Add column right"
                    onPress={() => {
                        commands.addColumnAfter?.()
                        onClose()
                    }}
                />
                <Separator />
                <MenuRow
                    label="Merge cells"
                    isDisabled={!canMergeCells}
                    onPress={() => {
                        commands.mergeCells?.()
                        onClose()
                    }}
                />
                <MenuRow
                    label="Split cell"
                    isDisabled={!canSplitCell}
                    onPress={() => {
                        commands.splitCell?.()
                        onClose()
                    }}
                />
                <Separator />
                <MenuRow
                    label="Delete row"
                    onPress={() => {
                        commands.deleteRow?.()
                        onClose()
                    }}
                />
                <MenuRow
                    label="Delete column"
                    onPress={() => {
                        commands.deleteColumn?.()
                        onClose()
                    }}
                />
                <MenuRow
                    label="Delete table"
                    onPress={() => {
                        commands.deleteTable?.()
                        onClose()
                    }}
                />
            </View>
        )
    }

    return (
        <View className="p-3 gap-2">
            <Text className="text-xs font-semibold text-foreground">Insert table</Text>
            <TableGridPicker
                onInsert={cell => {
                    commands.insertTable?.(cell.row, cell.col)
                    onClose()
                }}
            />
        </View>
    )
}

interface TableGridPickerProps {
    onInsert: (cell: GridPickerCell) => void
    maxRows?: number
    maxCols?: number
}

// The interactive grid. On web, hover updates the highlight; click
// inserts. On native, pan-style touch updates the highlight as the
// finger moves; releasing inserts.
function TableGridPicker({
    onInsert,
    maxRows = GRID_PICKER_DEFAULT_ROWS,
    maxCols = GRID_PICKER_DEFAULT_COLS,
}: TableGridPickerProps) {
    const [hovered, setHovered] = useState<GridPickerCell | null>(null)
    // primary (brand teal) instead of `accent`: the light-mode accent
    // token is a near-white pastel that disappears against the popover
    // background — `primary` gives an unambiguous highlight in both
    // light and dark mode.
    const primary = useThemeColor('primary')
    const border = useThemeColor('border')
    const cellStride = CELL_SIZE + CELL_GAP

    const cells: { row: number; col: number }[] = []
    for (let r = 1; r <= maxRows; r++) {
        for (let c = 1; c <= maxCols; c++) {
            cells.push({ row: r, col: c })
        }
    }

    const handleTouchMove = (event: GestureResponderEvent) => {
        const { locationX, locationY } = event.nativeEvent
        const cell = cellAtPosition(locationX, locationY, cellStride, maxRows, maxCols)
        if (cell) setHovered(cell)
    }

    return (
        <View>
            <View
                accessibilityLabel="Table size grid"
                onStartShouldSetResponder={() => true}
                onMoveShouldSetResponder={() => true}
                onResponderGrant={handleTouchMove}
                onResponderMove={handleTouchMove}
                onResponderRelease={() => {
                    if (hovered) onInsert(clampGridSelection(hovered, maxRows, maxCols))
                }}
                onResponderTerminate={() => setHovered(null)}
                style={{
                    width: maxCols * cellStride - CELL_GAP,
                    height: maxRows * cellStride - CELL_GAP,
                    position: 'relative',
                }}
            >
                {cells.map(cell => {
                    const highlighted = isCellHighlighted(cell, hovered)
                    return (
                        <Pressable
                            key={`${cell.row}-${cell.col}`}
                            accessibilityRole="button"
                            accessibilityLabel={`${cell.row} by ${cell.col} table`}
                            onHoverIn={
                                Platform.OS === 'web' ? () => setHovered(cell) : undefined
                            }
                            onPress={() => onInsert(cell)}
                            style={{
                                position: 'absolute',
                                left: (cell.col - 1) * cellStride,
                                top: (cell.row - 1) * cellStride,
                                width: CELL_SIZE,
                                height: CELL_SIZE,
                                backgroundColor: highlighted ? primary : 'transparent',
                                borderColor: highlighted ? primary : border,
                                borderWidth: 1,
                                borderRadius: 2,
                            }}
                        />
                    )
                })}
            </View>
            <Text className="text-xs text-muted-foreground mt-1.5 text-center">
                {hovered ? `${hovered.row} × ${hovered.col}` : 'Hover to choose size'}
            </Text>
        </View>
    )
}

function MenuRow({
    label,
    onPress,
    isDisabled,
}: {
    label: string
    onPress: () => void
    isDisabled?: boolean
}) {
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityState={{ disabled: isDisabled }}
            disabled={isDisabled}
            onPress={onPress}
            className={`px-3 py-2 rounded-md ${
                isDisabled ? 'opacity-40' : 'hover:bg-surface-secondary'
            }`}
            hitSlop={Platform.OS === 'web' ? undefined : { top: 6, bottom: 6, left: 4, right: 4 }}
        >
            <Text className="text-sm text-foreground">{label}</Text>
        </Pressable>
    )
}
