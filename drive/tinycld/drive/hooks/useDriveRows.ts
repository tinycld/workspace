import { useMemo } from 'react'
import type { DriveItemView } from '../types'

// List mode is a flat sequence of items; the column header is a sibling
// of the FlashList, not a row. Each list row carries its own absolute
// index so even-row striping / position-aware tooltips work without
// needing the row builder to know about virtualization.
export type ListRow = { kind: 'item'; item: DriveItemView; index: number }

// Grid mode prepends a section label per non-empty bucket. Section
// labels span the full row via overrideItemLayout({ span: numColumns }).
// Folders and files are rendered as separate cards with their own
// recycle pools (driven by getItemType).
export type GridRow =
    | { kind: 'section'; title: 'Folders' | 'Files' }
    | { kind: 'card'; item: DriveItemView }

export interface BuildListRowsParams {
    folders: DriveItemView[]
    files: DriveItemView[]
}

export interface BuildGridRowsParams {
    folders: DriveItemView[]
    files: DriveItemView[]
}

export function buildListRows({ folders, files }: BuildListRowsParams): ListRow[] {
    const rows: ListRow[] = []
    let i = 0
    for (const folder of folders) rows.push({ kind: 'item', item: folder, index: i++ })
    for (const file of files) rows.push({ kind: 'item', item: file, index: i++ })
    return rows
}

export function buildGridRows({ folders, files }: BuildGridRowsParams): GridRow[] {
    const rows: GridRow[] = []
    if (folders.length > 0) {
        rows.push({ kind: 'section', title: 'Folders' })
        for (const folder of folders) rows.push({ kind: 'card', item: folder })
    }
    if (files.length > 0) {
        rows.push({ kind: 'section', title: 'Files' })
        for (const file of files) rows.push({ kind: 'card', item: file })
    }
    return rows
}

export function useListRows(params: BuildListRowsParams): ListRow[] {
    return useMemo(() => buildListRows(params), [params.folders, params.files])
}

export function useGridRows(params: BuildGridRowsParams): GridRow[] {
    return useMemo(() => buildGridRows(params), [params.folders, params.files])
}
