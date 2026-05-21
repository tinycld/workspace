import { Menu, Separator } from '@tinycld/core/ui/menu'
import { useCallback, useEffect, useRef } from 'react'
import { Platform, Pressable, StyleSheet, type View } from 'react-native'
import type * as Y from 'yjs'
import { useClipboard } from '../../hooks/use-clipboard'
import { useFilterView } from '../../hooks/use-filter-view'
import { useGridStore, useGridStoreApi } from '../../hooks/use-grid-store'
import { useSheetConditionalFormats } from '../../hooks/use-sheet-conditional-formats'
import { useYSheets } from '../../hooks/use-y-sheets'
import { autosizeCol, commitColWidth, commitRowHeight } from './resize-actions'
import { rangeToSheetRelativeA1 } from '../../lib/conditional-format/a1'
import { anyRuleOverlapsRect } from '../../lib/conditional-format/range-index'
import { clearFilter } from '../../lib/filter'
import { pluralize } from '../../lib/pluralize'
import { allRanges, isDisjoint, primaryRange } from '../../lib/selection-range'
import { useConditionalFormatPanelStore } from '../../lib/stores/conditional-format-panel-store'
import { detectHeaderRow, sortRange } from '../../lib/sort'
import { columnLabel } from '../../lib/workbook-types'
import { DEFAULT_COL_WIDTH, DEFAULT_ROW_HEIGHT } from '../../lib/dimensions'
import { MIN_COLS, MIN_ROWS } from './constants'

interface HeaderContextMenuProps {
    doc: Y.Doc | null
    sheetId: string
}

// Right-click menu on the column-label or row-label cells. Distinct
// from CellContextMenu (right-click inside the grid body) and from
// HandleContextMenu (right-click on the resize handle between
// headers). openHeaderMenu in the store pre-selects the clicked
// row/col when it isn't already part of the active selection, so the
// menu's range-targeted actions operate on what the user expects.
export function HeaderContextMenu({ doc, sheetId }: HeaderContextMenuProps) {
    const target = useGridStore(s => s.headerMenu)
    const selection = useGridStore(s => s.selection)
    const disjoint = useGridStore(s => isDisjoint(s.selection))
    const store = useGridStoreApi()
    const onClose = useCallback(() => store.getState().closeHeaderMenu(), [store])
    const contentRef = useRef<View | null>(null)

    // Web outside-click dismissal mirrors CellContextMenu / HandleContextMenu.
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

    const sheets = useYSheets(doc)
    const sheet = sheets.find(s => s.id === sheetId)
    const rowCount = sheet?.rowCount ?? 0
    const colCount = sheet?.colCount ?? 0
    const displayedRowCount = Math.max(rowCount, MIN_ROWS)
    const displayedColCount = Math.max(colCount, MIN_COLS)
    const frozenRows = sheet?.frozenRows ?? 0
    const frozenCols = sheet?.frozenCols ?? 0
    const hasFreeze = frozenRows > 0 || frozenCols > 0

    const range = primaryRange(selection)
    const rowSpan = range != null ? range.endRow - range.startRow + 1 : 1
    const colSpan = range != null ? range.endCol - range.startCol + 1 : 1

    const isCol = target?.axis === 'col'

    const onInsertAbove = useCallback(
        () => store.getState().insertRowsAtSelection('above', displayedRowCount),
        [store, displayedRowCount]
    )
    const onInsertBelow = useCallback(
        () => store.getState().insertRowsAtSelection('below', displayedRowCount),
        [store, displayedRowCount]
    )
    const onInsertLeft = useCallback(
        () => store.getState().insertColumnsAtSelection('left', displayedColCount),
        [store, displayedColCount]
    )
    const onInsertRight = useCallback(
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

    const onClear = useCallback(() => store.getState().clearSelection(), [store])

    const clipboard = useClipboard({ doc, sheetId, store })
    const onCut = useCallback(() => {
        void clipboard.cut()
    }, [clipboard])
    const onCopy = useCallback(() => {
        void clipboard.copy()
    }, [clipboard])
    const onPaste = useCallback(() => {
        void clipboard.paste('all')
    }, [clipboard])

    // Freeze "up to" labels match the clicked header index — clearer
    // than the cell-menu's "up to row/col X (selection edge)" wording
    // since the user pointed at this specific header.
    const clickedIndex = target?.index ?? null
    const onFreezeRowsHere = useCallback(() => {
        if (clickedIndex == null) return
        store.getState().setFrozenRows(clickedIndex)
    }, [store, clickedIndex])
    const onFreezeColsHere = useCallback(() => {
        if (clickedIndex == null) return
        store.getState().setFrozenCols(clickedIndex)
    }, [store, clickedIndex])
    const onUnfreeze = useCallback(() => store.getState().unfreeze(), [store])

    const onAutosizeCol = useCallback(() => {
        if (clickedIndex == null) return
        autosizeCol(doc, sheetId, clickedIndex)
    }, [doc, sheetId, clickedIndex])
    const onResetColWidth = useCallback(() => {
        if (clickedIndex == null) return
        commitColWidth(doc, sheetId, clickedIndex, DEFAULT_COL_WIDTH)
    }, [doc, sheetId, clickedIndex])
    const onResetRowHeight = useCallback(() => {
        if (clickedIndex == null) return
        commitRowHeight(doc, sheetId, clickedIndex, DEFAULT_ROW_HEIGHT)
    }, [doc, sheetId, clickedIndex])

    // Sort/filter only make sense on a single contiguous column
    // selection — hide when disjoint. The cell menu does the same.
    const filterView = useFilterView(doc, sheetId)

    // Column-header sort uses the clicked column as the sort key but
    // must reorder every row across every column of the sheet — every
    // sibling column rides along with its row so a "Sort sheet A→Z"
    // does not desynchronise the table. The range spans all rows and
    // all columns; the sort key column is `range.startCol`.
    const fullSheetRange = useCallback(() => {
        if (range == null) return null
        const lastRow = Math.max(rowCount, displayedRowCount)
        const lastCol = Math.max(colCount, displayedColCount)
        return {
            startRow: 1,
            endRow: lastRow,
            startCol: 1,
            endCol: lastCol,
        }
    }, [range, rowCount, displayedRowCount, colCount, displayedColCount])

    const onSortAsc = useCallback(() => {
        if (doc == null || range == null) return
        const r = fullSheetRange()
        if (r == null) return
        const hasHeader = detectHeaderRow(doc, sheetId, r)
        const result = sortRange(doc, sheetId, r, range.startCol, 'asc', hasHeader)
        if (result.ok && result.mergesBroken > 0) {
            store.getState().setSortStatus({ mergesBroken: result.mergesBroken })
        }
    }, [doc, sheetId, fullSheetRange, range, store])

    const onSortDesc = useCallback(() => {
        if (doc == null || range == null) return
        const r = fullSheetRange()
        if (r == null) return
        const hasHeader = detectHeaderRow(doc, sheetId, r)
        const result = sortRange(doc, sheetId, r, range.startCol, 'desc', hasHeader)
        if (result.ok && result.mergesBroken > 0) {
            store.getState().setSortStatus({ mergesBroken: result.mergesBroken })
        }
    }, [doc, sheetId, fullSheetRange, range, store])

    const onOpenFilterDialog = useCallback(() => {
        if (clickedIndex == null) return
        store.getState().openFilterDialog(clickedIndex)
        store.getState().closeHeaderMenu()
    }, [store, clickedIndex])

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

    const conditionalFormattingMenuLabel = hasRuleOnSelection
        ? 'Edit conditional formatting…'
        : 'Conditional formatting…'

    const onRemoveFilter = useCallback(() => {
        if (doc == null) return
        clearFilter(doc, sheetId)
    }, [doc, sheetId])

    if (isCol) {
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
                        <Separator className="my-1 mx-2" />
                        <Menu.Item onPress={onInsertLeft}>
                            <Menu.ItemTitle>
                                Insert {pluralize(colSpan, 'column')} left
                            </Menu.ItemTitle>
                        </Menu.Item>
                        <Menu.Item onPress={onInsertRight}>
                            <Menu.ItemTitle>
                                Insert {pluralize(colSpan, 'column')} right
                            </Menu.ItemTitle>
                        </Menu.Item>
                        <Menu.Item onPress={onDeleteCols} isDisabled={colCount <= 1}>
                            <Menu.ItemTitle>
                                {colSpan === 1 ? 'Delete column' : `Delete ${colSpan} columns`}
                            </Menu.ItemTitle>
                        </Menu.Item>
                        <Separator className="my-1 mx-2" />
                        <Menu.Item onPress={onClear}>
                            <Menu.ItemTitle>Clear contents</Menu.ItemTitle>
                        </Menu.Item>
                        <Separator className="my-1 mx-2" />
                        <Menu.Item onPress={onSortAsc} isDisabled={disjoint}>
                            <Menu.ItemTitle>Sort sheet A→Z</Menu.ItemTitle>
                        </Menu.Item>
                        <Menu.Item onPress={onSortDesc} isDisabled={disjoint}>
                            <Menu.ItemTitle>Sort sheet Z→A</Menu.ItemTitle>
                        </Menu.Item>
                        {filterView == null ? (
                            <Menu.Item
                                onPress={onOpenFilterDialog}
                                isDisabled={disjoint || clickedIndex == null}
                            >
                                <Menu.ItemTitle>Create filter…</Menu.ItemTitle>
                            </Menu.Item>
                        ) : filterView.mode === 'header' ? (
                            <>
                                <Menu.Item
                                    onPress={onOpenFilterDialog}
                                    isDisabled={clickedIndex == null}
                                >
                                    <Menu.ItemTitle>
                                        {filterView.criteria[clickedIndex ?? -1] != null
                                            ? 'Edit filter…'
                                            : 'Add filter…'}
                                    </Menu.ItemTitle>
                                </Menu.Item>
                                <Menu.Item onPress={onRemoveFilter}>
                                    <Menu.ItemTitle>Remove all filters</Menu.ItemTitle>
                                </Menu.Item>
                            </>
                        ) : null}
                        <Separator className="my-1 mx-2" />
                        {clickedIndex != null && clickedIndex > 0 ? (
                            <Menu.Item onPress={onFreezeColsHere}>
                                <Menu.ItemTitle>
                                    Freeze up to column {columnLabel(clickedIndex)}
                                </Menu.ItemTitle>
                            </Menu.Item>
                        ) : null}
                        <Menu.Item onPress={onUnfreeze} isDisabled={!hasFreeze}>
                            <Menu.ItemTitle>Unfreeze</Menu.ItemTitle>
                        </Menu.Item>
                        <Separator className="my-1 mx-2" />
                        <Menu.Item onPress={onAutosizeCol}>
                            <Menu.ItemTitle>Auto-fit column width</Menu.ItemTitle>
                        </Menu.Item>
                        <Menu.Item onPress={onResetColWidth}>
                            <Menu.ItemTitle>Reset to default width</Menu.ItemTitle>
                        </Menu.Item>
                        <Separator className="my-1 mx-2" />
                        <Menu.Item onPress={onOpenConditionalFormatting}>
                            <Menu.ItemTitle>{conditionalFormattingMenuLabel}</Menu.ItemTitle>
                        </Menu.Item>
                    </Menu.Content>
                </Menu.Portal>
            </Menu>
        )
    }

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
                    <Separator className="my-1 mx-2" />
                    <Menu.Item onPress={onInsertAbove}>
                        <Menu.ItemTitle>Insert {pluralize(rowSpan, 'row')} above</Menu.ItemTitle>
                    </Menu.Item>
                    <Menu.Item onPress={onInsertBelow}>
                        <Menu.ItemTitle>Insert {pluralize(rowSpan, 'row')} below</Menu.ItemTitle>
                    </Menu.Item>
                    <Menu.Item onPress={onDeleteRows} isDisabled={rowCount <= 1}>
                        <Menu.ItemTitle>
                            {rowSpan === 1 ? 'Delete row' : `Delete ${rowSpan} rows`}
                        </Menu.ItemTitle>
                    </Menu.Item>
                    <Separator className="my-1 mx-2" />
                    <Menu.Item onPress={onClear}>
                        <Menu.ItemTitle>Clear contents</Menu.ItemTitle>
                    </Menu.Item>
                    <Separator className="my-1 mx-2" />
                    {clickedIndex != null && clickedIndex > 0 ? (
                        <Menu.Item onPress={onFreezeRowsHere}>
                            <Menu.ItemTitle>Freeze up to row {clickedIndex}</Menu.ItemTitle>
                        </Menu.Item>
                    ) : null}
                    <Menu.Item onPress={onUnfreeze} isDisabled={!hasFreeze}>
                        <Menu.ItemTitle>Unfreeze</Menu.ItemTitle>
                    </Menu.Item>
                    <Separator className="my-1 mx-2" />
                    <Menu.Item onPress={onResetRowHeight}>
                        <Menu.ItemTitle>Reset to default height</Menu.ItemTitle>
                    </Menu.Item>
                    <Separator className="my-1 mx-2" />
                    <Menu.Item onPress={onOpenConditionalFormatting}>
                        <Menu.ItemTitle>{conditionalFormattingMenuLabel}</Menu.ItemTitle>
                    </Menu.Item>
                </Menu.Content>
            </Menu.Portal>
        </Menu>
    )
}
