import { Menu, Separator } from '@tinycld/core/ui/menu'
import { useCallback, useEffect, useRef } from 'react'
import { Platform, Pressable, StyleSheet, type View } from 'react-native'
import type * as Y from 'yjs'
import { useClipboard } from '../../hooks/use-clipboard'
import { useFilterView } from '../../hooks/use-filter-view'
import { useGridStore, useGridStoreApi } from '../../hooks/use-grid-store'
import { setYCell } from '../../hooks/use-y-cell'
import { useYSheets } from '../../hooks/use-y-sheets'
import { rangeToSheetRelativeA1 } from '../../lib/conditional-format/a1'
import { anyRuleOverlapsRect } from '../../lib/conditional-format/range-index'
import { useSheetConditionalFormats } from '../../hooks/use-sheet-conditional-formats'
import { applyValuesFilterFromSelection, clearFilter } from '../../lib/filter'
import { pluralize } from '../../lib/pluralize'
import {
    allRanges,
    forEachCellInSelection,
    isDisjoint,
    primaryRange,
} from '../../lib/selection-range'
import { useConditionalFormatPanelStore } from '../../lib/stores/conditional-format-panel-store'
import { detectHeaderRow, sortRange } from '../../lib/sort'
import { columnLabel } from '../../lib/workbook-types'
import { MIN_COLS, MIN_ROWS } from './constants'

interface CellContextMenuProps {
    doc: Y.Doc | null
    sheetId: string
}

// Single Menu instance shared by every cell. Mounted in Grid so cells
// stay free of any per-cell Menu overhead. Positioned at the
// cursor/touch coordinates via Menu's triggerPosition prop (a 0×0
// "trigger rect" anchored at the click point produces a popover that
// drops down to the bottom-right of the cursor, with edge-flip handled
// by Menu.Content).
export function CellContextMenu({ doc, sheetId }: CellContextMenuProps) {
    const target = useGridStore(s => s.contextTarget)
    // Read the live selection so range-aware menu actions (clear,
    // sort/filter) cover every cell currently highlighted.
    // openCellContextMenu has already collapsed the range to a single
    // cell when the right-click landed outside any prior sub-range,
    // so this naturally reduces to single-cell when there's no range.
    const selection = useGridStore(s => s.selection)
    const disjoint = useGridStore(s => isDisjoint(s.selection))
    const store = useGridStoreApi()
    const onClose = useCallback(() => store.getState().closeCellContextMenu(), [store])
    const contentRef = useRef<View | null>(null)

    // Web: dismiss on any pointerdown outside the menu content.
    // Mirrors the pattern in @tinycld/core/components/ContextMenu —
    // Gluestack's overlay scrim is unreliable for outside-click
    // dismissal (clicks can land on cells underneath).
    //
    // Native: a Pressable absolute-fill scrim inside Menu.Portal handles
    // taps outside; rendered conditionally below.
    useEffect(() => {
        if (Platform.OS !== 'web') return
        if (target == null) return
        const handler = (event: PointerEvent) => {
            const targetNode = event.target as Node | null
            const node = contentRef.current as unknown as Node | null
            if (targetNode && node?.contains(targetNode)) return
            onClose()
        }
        document.addEventListener('pointerdown', handler, true)
        return () => {
            document.removeEventListener('pointerdown', handler, true)
        }
    }, [target, onClose])

    const isOpen = target != null
    const triggerPos = target
        ? { x: target.cursor.x, y: target.cursor.y, width: 0, height: 0 }
        : null

    const handleOpenChange = useCallback(
        (open: boolean) => {
            if (!open) onClose()
        },
        [onClose]
    )

    // Tier B consumer: structural insert/delete and sort/filter
    // route by the primary sub-range (last). Disjoint sub-ranges
    // come along for the shift but the primary drives the op.
    const range = primaryRange(selection)
    const rowSpan = range != null ? range.endRow - range.startRow + 1 : 1
    const colSpan = range != null ? range.endCol - range.startCol + 1 : 1

    const sheets = useYSheets(doc)
    const sheet = sheets.find(s => s.id === sheetId)
    const rowCount = sheet?.rowCount ?? 0
    const colCount = sheet?.colCount ?? 0
    // Grid.tsx clamps the displayed grid up to MIN_ROWS/MIN_COLS, so a
    // fresh sheet shows 50×26 even with rowCount=colCount=0. Pass the
    // displayed dims to insert actions so the post-insert sheet covers
    // the rows/cols the user already saw.
    const displayedRowCount = Math.max(rowCount, MIN_ROWS)
    const displayedColCount = Math.max(colCount, MIN_COLS)

    const onInsertRowAbove = useCallback(
        () => store.getState().insertRowsAtSelection('above', displayedRowCount),
        [store, displayedRowCount]
    )
    const onInsertRowBelow = useCallback(
        () => store.getState().insertRowsAtSelection('below', displayedRowCount),
        [store, displayedRowCount]
    )
    const onInsertColLeft = useCallback(
        () => store.getState().insertColumnsAtSelection('left', displayedColCount),
        [store, displayedColCount]
    )
    const onInsertColRight = useCallback(
        () => store.getState().insertColumnsAtSelection('right', displayedColCount),
        [store, displayedColCount]
    )
    const onDeleteRows = useCallback(
        () => store.getState().deleteSelectedRows(rowCount),
        [store, rowCount]
    )
    const onDeleteCols = useCallback(
        () => store.getState().deleteSelectedColumns(colCount),
        [store, colCount]
    )

    const onClear = useCallback(() => {
        if (selection == null || doc == null) return
        forEachCellInSelection(selection, (row, col) => {
            setYCell(doc, sheetId, row, col, '')
        })
    }, [doc, sheetId, selection])

    const clipboard = useClipboard({ doc, sheetId, store })
    // Fire-and-forget wrappers — async errors are swallowed inside the
    // hook; the menu just closes after the user's tap.
    const onCut = useCallback(() => {
        void clipboard.cut()
    }, [clipboard])
    const onCopy = useCallback(() => {
        void clipboard.copy()
    }, [clipboard])
    const onPaste = useCallback(() => {
        void clipboard.paste('all')
    }, [clipboard])
    const onPasteValues = useCallback(() => {
        void clipboard.paste('values')
    }, [clipboard])
    const onPasteFormulas = useCallback(() => {
        void clipboard.paste('formulas')
    }, [clipboard])
    const onPasteFormat = useCallback(() => {
        void clipboard.paste('format')
    }, [clipboard])
    const onPasteTranspose = useCallback(() => {
        void clipboard.paste('transpose')
    }, [clipboard])

    const onComment = useCallback(() => {
        if (target == null) return
        store
            .getState()
            .openCommentPopover(target.cell.row, target.cell.col, target.cursor.x, target.cursor.y)
    }, [target, store])

    const frozenRows = sheet?.frozenRows ?? 0
    const frozenCols = sheet?.frozenCols ?? 0
    const hasFreeze = frozenRows > 0 || frozenCols > 0
    const bottomRow = range?.endRow ?? null
    const rightCol = range?.endCol ?? null

    const filterView = useFilterView(doc, sheetId)
    // Sort/filter only make sense on a single contiguous rectangle —
    // hide the entries when the selection is disjoint (plan Tier B).
    const hasMultiCellRange = range != null && !disjoint && (rowSpan > 1 || colSpan > 1)

    // Sort uses the active range's first column as the key. The
    // hasHeader flag is detected automatically — a one-shot sort menu
    // item shouldn't pop a dialog.
    const onSortAsc = useCallback(() => {
        if (doc == null || range == null) return
        const hasHeader = detectHeaderRow(doc, sheetId, range)
        const result = sortRange(doc, sheetId, range, range.startCol, 'asc', hasHeader)
        if (result.ok && result.mergesBroken > 0) {
            store.getState().setSortStatus({ mergesBroken: result.mergesBroken })
        }
    }, [doc, sheetId, range, store])

    const onSortDesc = useCallback(() => {
        if (doc == null || range == null) return
        const hasHeader = detectHeaderRow(doc, sheetId, range)
        const result = sortRange(doc, sheetId, range, range.startCol, 'desc', hasHeader)
        if (result.ok && result.mergesBroken > 0) {
            store.getState().setSortStatus({ mergesBroken: result.mergesBroken })
        }
    }, [doc, sheetId, range, store])

    const onCreateFilter = useCallback(() => {
        if (doc == null || range == null) return
        applyValuesFilterFromSelection(doc, sheetId, range, displayedRowCount, frozenRows)
    }, [doc, sheetId, range, displayedRowCount, frozenRows])

    const onRemoveFilter = useCallback(() => {
        if (doc == null) return
        clearFilter(doc, sheetId)
    }, [doc, sheetId])

    const onMergeAll = useCallback(() => store.getState().mergeSelection(), [store])
    const onUnmergeMenuAction = useCallback(() => store.getState().unmergeSelection(), [store])

    const sheetRules = useSheetConditionalFormats(doc, sheetId)
    const hasRuleOnSelection =
        range != null &&
        anyRuleOverlapsRect(sheetRules, {
            startRow: range.startRow,
            startCol: range.startCol,
            endRow: range.endRow,
            endCol: range.endCol,
        })

    const onOpenConditionalFormatting = useCallback(() => {
        const defaultRanges = allRanges(selection).map((r) =>
            rangeToSheetRelativeA1(r.startRow, r.startCol, r.endRow, r.endCol)
        )
        useConditionalFormatPanelStore.getState().open(sheetId, { defaultRanges })
        onClose()
    }, [selection, sheetId, onClose])

    return (
        <Menu isOpen={isOpen} onOpenChange={handleOpenChange} triggerPosition={triggerPos}>
            <Menu.Portal>
                {Platform.OS !== 'web' && (
                    <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
                )}
                <Menu.Content ref={contentRef} placement="bottom" align="start">
                    <Menu.Item onPress={onCut}>
                        <Menu.ItemTitle>Cut</Menu.ItemTitle>
                    </Menu.Item>
                    <Menu.Item onPress={onCopy}>
                        <Menu.ItemTitle>Copy</Menu.ItemTitle>
                    </Menu.Item>
                    <Menu.Item onPress={onPaste}>
                        <Menu.ItemTitle>Paste</Menu.ItemTitle>
                    </Menu.Item>
                    <Menu.Sub>
                        <Menu.SubTrigger>
                            <Menu.ItemTitle>Paste special</Menu.ItemTitle>
                        </Menu.SubTrigger>
                        <Menu.SubContent>
                            <Menu.Item onPress={onPasteValues}>
                                <Menu.ItemTitle>Values only</Menu.ItemTitle>
                            </Menu.Item>
                            <Menu.Item onPress={onPasteFormulas}>
                                <Menu.ItemTitle>Formulas only</Menu.ItemTitle>
                            </Menu.Item>
                            <Menu.Item onPress={onPasteFormat}>
                                <Menu.ItemTitle>Format only</Menu.ItemTitle>
                            </Menu.Item>
                            <Menu.Item onPress={onPasteTranspose}>
                                <Menu.ItemTitle>Transposed</Menu.ItemTitle>
                            </Menu.Item>
                        </Menu.SubContent>
                    </Menu.Sub>
                    <Separator className="my-1 mx-2" />
                    <Menu.Sub>
                        <Menu.SubTrigger>
                            <Menu.ItemTitle>Insert</Menu.ItemTitle>
                        </Menu.SubTrigger>
                        <Menu.SubContent>
                            <Menu.Item onPress={onInsertRowAbove}>
                                <Menu.ItemTitle>{pluralize(rowSpan, 'row')} above</Menu.ItemTitle>
                            </Menu.Item>
                            <Menu.Item onPress={onInsertRowBelow}>
                                <Menu.ItemTitle>{pluralize(rowSpan, 'row')} below</Menu.ItemTitle>
                            </Menu.Item>
                            <Menu.Item onPress={onInsertColLeft}>
                                <Menu.ItemTitle>{pluralize(colSpan, 'column')} left</Menu.ItemTitle>
                            </Menu.Item>
                            <Menu.Item onPress={onInsertColRight}>
                                <Menu.ItemTitle>
                                    {pluralize(colSpan, 'column')} right
                                </Menu.ItemTitle>
                            </Menu.Item>
                        </Menu.SubContent>
                    </Menu.Sub>
                    <Menu.Sub>
                        <Menu.SubTrigger>
                            <Menu.ItemTitle>Delete</Menu.ItemTitle>
                        </Menu.SubTrigger>
                        <Menu.SubContent>
                            <Menu.Item onPress={onDeleteRows} isDisabled={rowCount <= 1}>
                                <Menu.ItemTitle>
                                    {rowSpan === 1 ? 'This row' : `These ${rowSpan} rows`}
                                </Menu.ItemTitle>
                            </Menu.Item>
                            <Menu.Item onPress={onDeleteCols} isDisabled={colCount <= 1}>
                                <Menu.ItemTitle>
                                    {colSpan === 1 ? 'This column' : `These ${colSpan} columns`}
                                </Menu.ItemTitle>
                            </Menu.Item>
                        </Menu.SubContent>
                    </Menu.Sub>
                    <Separator className="my-1 mx-2" />
                    <Menu.Item onPress={onClear}>
                        <Menu.ItemTitle>Clear contents</Menu.ItemTitle>
                    </Menu.Item>
                    <Separator className="my-1 mx-2" />
                    <Menu.Item onPress={onComment}>
                        <Menu.ItemTitle>Comment</Menu.ItemTitle>
                    </Menu.Item>
                    <Separator className="my-1 mx-2" />
                    <Menu.Sub>
                        <Menu.SubTrigger>
                            <Menu.ItemTitle>Freeze</Menu.ItemTitle>
                        </Menu.SubTrigger>
                        <Menu.SubContent>
                            <Menu.Item onPress={() => store.getState().setFrozenRows(1)}>
                                <Menu.ItemTitle>Freeze 1 row</Menu.ItemTitle>
                            </Menu.Item>
                            <Menu.Item onPress={() => store.getState().setFrozenRows(2)}>
                                <Menu.ItemTitle>Freeze 2 rows</Menu.ItemTitle>
                            </Menu.Item>
                            {bottomRow != null && bottomRow > 0 && (
                                <Menu.Item
                                    onPress={() => store.getState().setFrozenRows(bottomRow)}
                                >
                                    <Menu.ItemTitle>Freeze up to row {bottomRow}</Menu.ItemTitle>
                                </Menu.Item>
                            )}
                            <Menu.Item onPress={() => store.getState().setFrozenCols(1)}>
                                <Menu.ItemTitle>Freeze 1 column</Menu.ItemTitle>
                            </Menu.Item>
                            <Menu.Item onPress={() => store.getState().setFrozenCols(2)}>
                                <Menu.ItemTitle>Freeze 2 columns</Menu.ItemTitle>
                            </Menu.Item>
                            {rightCol != null && rightCol > 0 && (
                                <Menu.Item
                                    onPress={() => store.getState().setFrozenCols(rightCol)}
                                >
                                    <Menu.ItemTitle>
                                        Freeze up to column {columnLabel(rightCol)}
                                    </Menu.ItemTitle>
                                </Menu.Item>
                            )}
                            <Menu.Item
                                onPress={() => store.getState().unfreeze()}
                                isDisabled={!hasFreeze}
                            >
                                <Menu.ItemTitle>Unfreeze</Menu.ItemTitle>
                            </Menu.Item>
                        </Menu.SubContent>
                    </Menu.Sub>
                    <Separator className="my-1 mx-2" />
                    {hasMultiCellRange ? (
                        <>
                            <Menu.Item onPress={onSortAsc}>
                                <Menu.ItemTitle>Sort range A→Z</Menu.ItemTitle>
                            </Menu.Item>
                            <Menu.Item onPress={onSortDesc}>
                                <Menu.ItemTitle>Sort range Z→A</Menu.ItemTitle>
                            </Menu.Item>
                        </>
                    ) : null}
                    {filterView == null ? (
                        <Menu.Item
                            onPress={onCreateFilter}
                            isDisabled={range == null || disjoint}
                        >
                            <Menu.ItemTitle>Filter</Menu.ItemTitle>
                        </Menu.Item>
                    ) : filterView.mode === 'range' ? (
                        <Menu.Item onPress={onRemoveFilter}>
                            <Menu.ItemTitle>Remove filter</Menu.ItemTitle>
                        </Menu.Item>
                    ) : null}
                    <Separator className="my-1 mx-2" />
                    <Menu.Item onPress={onMergeAll} isDisabled={disjoint}>
                        <Menu.ItemTitle>Merge cells</Menu.ItemTitle>
                    </Menu.Item>
                    <Menu.Item onPress={onUnmergeMenuAction} isDisabled={disjoint}>
                        <Menu.ItemTitle>Unmerge</Menu.ItemTitle>
                    </Menu.Item>
                    <Separator className="my-1 mx-2" />
                    <Menu.Item onPress={onOpenConditionalFormatting}>
                        <Menu.ItemTitle>
                            {hasRuleOnSelection
                                ? 'Edit conditional formatting…'
                                : 'Conditional formatting…'}
                        </Menu.ItemTitle>
                    </Menu.Item>
                </Menu.Content>
            </Menu.Portal>
        </Menu>
    )
}
