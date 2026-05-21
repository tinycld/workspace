import { Menu, Separator } from '@tinycld/core/ui/menu'
import { useCallback, useEffect, useRef } from 'react'
import { Platform, Pressable, StyleSheet, type View } from 'react-native'
import { useGridStore, useGridStoreApi } from '../../hooks/use-grid-store'
import { DEFAULT_COL_WIDTH, DEFAULT_ROW_HEIGHT } from '../../lib/dimensions'

interface HandleContextMenuProps {
    onAutosizeCol: (col: number) => void
    // onResetCol/onResetRow are wired to the same setYColWidth/setYRowHeight
    // setters so writing the default deletes the entry — see lib/dimensions.ts.
    onResetCol: (col: number, width: number) => void
    onResetRow: (row: number, height: number) => void
    // Current sheet dimensions are needed for clamp logic on delete and
    // to disable delete when only one row/column remains.
    rowCount: number
    colCount: number
    // Displayed grid dimensions (rowCount/colCount clamped up to
    // MIN_ROWS/MIN_COLS in Grid.tsx). Inserts use these so a sheet with
    // stored count=0 still expands to cover the visible grid.
    displayedRowCount: number
    displayedColCount: number
}

// Single small menu shared by every column- and row-resize handle.
// Right-click (web) sets the target via the store; selecting an item
// dispatches and closes. Native users don't currently get this menu —
// long-press on a 6px handle isn't a practical mobile gesture, and
// the drag-to-resize gesture already covers the common case.
export function HandleContextMenu({
    onAutosizeCol,
    onResetCol,
    onResetRow,
    rowCount,
    colCount,
    displayedRowCount,
    displayedColCount,
}: HandleContextMenuProps) {
    const target = useGridStore(s => s.handleMenu)
    const store = useGridStoreApi()
    const onClose = useCallback(() => store.getState().closeHandleMenu(), [store])
    const contentRef = useRef<View | null>(null)

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

    const onAutosizeItem = useCallback(() => {
        if (target == null || target.axis !== 'col') return
        onAutosizeCol(target.index)
        onClose()
    }, [target, onAutosizeCol, onClose])

    const onResetItem = useCallback(() => {
        if (target == null) return
        if (target.axis === 'col') {
            onResetCol(target.index, DEFAULT_COL_WIDTH)
        } else {
            onResetRow(target.index, DEFAULT_ROW_HEIGHT)
        }
        onClose()
    }, [target, onResetCol, onResetRow, onClose])

    const onInsertRowAbove = useCallback(() => {
        if (target == null || target.axis !== 'row') return
        store.getState().insertRowAtHandle(target.index, 'above', displayedRowCount)
    }, [target, store, displayedRowCount])
    const onInsertRowBelow = useCallback(() => {
        if (target == null || target.axis !== 'row') return
        store.getState().insertRowAtHandle(target.index, 'below', displayedRowCount)
    }, [target, store, displayedRowCount])
    const onDeleteRow = useCallback(() => {
        if (target == null || target.axis !== 'row') return
        store.getState().deleteRowAtHandle(target.index, rowCount)
    }, [target, store, rowCount])

    const onInsertColLeft = useCallback(() => {
        if (target == null || target.axis !== 'col') return
        store.getState().insertColumnAtHandle(target.index, 'left', displayedColCount)
    }, [target, store, displayedColCount])
    const onInsertColRight = useCallback(() => {
        if (target == null || target.axis !== 'col') return
        store.getState().insertColumnAtHandle(target.index, 'right', displayedColCount)
    }, [target, store, displayedColCount])
    const onDeleteCol = useCallback(() => {
        if (target == null || target.axis !== 'col') return
        store.getState().deleteColumnAtHandle(target.index, colCount)
    }, [target, store, colCount])

    const isCol = target?.axis === 'col'

    return (
        <Menu isOpen={isOpen} onOpenChange={handleOpenChange} triggerPosition={triggerPos}>
            <Menu.Portal>
                {Platform.OS !== 'web' && (
                    <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
                )}
                <Menu.Content ref={contentRef} placement="bottom" align="start">
                    {isCol ? (
                        <>
                            <Menu.Item onPress={onInsertColLeft}>
                                <Menu.ItemTitle>Insert 1 column left</Menu.ItemTitle>
                            </Menu.Item>
                            <Menu.Item onPress={onInsertColRight}>
                                <Menu.ItemTitle>Insert 1 column right</Menu.ItemTitle>
                            </Menu.Item>
                            <Menu.Item onPress={onDeleteCol} isDisabled={colCount <= 1}>
                                <Menu.ItemTitle>Delete column</Menu.ItemTitle>
                            </Menu.Item>
                            <Separator className="my-1 mx-2" />
                            <Menu.Item onPress={onAutosizeItem}>
                                <Menu.ItemTitle>Auto-fit column width</Menu.ItemTitle>
                            </Menu.Item>
                            <Menu.Item onPress={onResetItem}>
                                <Menu.ItemTitle>Reset to default width</Menu.ItemTitle>
                            </Menu.Item>
                        </>
                    ) : (
                        <>
                            <Menu.Item onPress={onInsertRowAbove}>
                                <Menu.ItemTitle>Insert 1 row above</Menu.ItemTitle>
                            </Menu.Item>
                            <Menu.Item onPress={onInsertRowBelow}>
                                <Menu.ItemTitle>Insert 1 row below</Menu.ItemTitle>
                            </Menu.Item>
                            <Menu.Item onPress={onDeleteRow} isDisabled={rowCount <= 1}>
                                <Menu.ItemTitle>Delete row</Menu.ItemTitle>
                            </Menu.Item>
                            <Separator className="my-1 mx-2" />
                            <Menu.Item onPress={onResetItem}>
                                <Menu.ItemTitle>Reset to default height</Menu.ItemTitle>
                            </Menu.Item>
                        </>
                    )}
                </Menu.Content>
            </Menu.Portal>
        </Menu>
    )
}
