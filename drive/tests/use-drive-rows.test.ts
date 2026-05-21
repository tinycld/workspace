import { describe, expect, it } from 'vitest'
import { buildGridRows, buildListRows } from '../tinycld/drive/hooks/useDriveRows'
import type { DriveItemView } from '../tinycld/drive/types'

function item(id: string, opts: Partial<DriveItemView> = {}): DriveItemView {
    return {
        id,
        name: id,
        isFolder: false,
        mimeType: 'text/plain',
        parentId: '',
        owner: 'me',
        ownerUserOrgId: 'uo1',
        updated: '',
        size: 0,
        shared: false,
        starred: false,
        trashedAt: '',
        file: '',
        thumbnail: '',
        description: '',
        category: 'document',
        ...opts,
    }
}

describe('buildListRows', () => {
    const folder1 = item('f1', { isFolder: true })
    const folder2 = item('f2', { isFolder: true })
    const file1 = item('file1')
    const file2 = item('file2')

    it('emits folders then files as a flat list', () => {
        const rows = buildListRows({
            folders: [folder1, folder2],
            files: [file1, file2],
        })
        expect(rows.map(r => r.kind)).toEqual(['item', 'item', 'item', 'item'])
        expect(rows[0].item.id).toBe('f1')
        expect(rows[3].item.id).toBe('file2')
    })

    it('preserves a contiguous index across folders + files', () => {
        const rows = buildListRows({
            folders: [folder1, folder2],
            files: [file1, file2],
        })
        expect(rows[0].index).toBe(0)
        expect(rows[1].index).toBe(1)
        expect(rows[2].index).toBe(2)
        expect(rows[3].index).toBe(3)
    })

    it('keeps uploading items in the row stream so they render as cells', () => {
        const uploading = item('upl', { uploadStatus: 'uploading' })
        const rows = buildListRows({
            folders: [],
            files: [uploading, file1],
        })
        expect(rows).toHaveLength(2)
        expect(rows[0].item.id).toBe('upl')
    })
})

describe('buildGridRows', () => {
    const folder1 = item('f1', { isFolder: true })
    const file1 = item('file1')
    const file2 = item('file2')

    it('emits section labels and cards', () => {
        const rows = buildGridRows({
            folders: [folder1],
            files: [file1, file2],
        })
        expect(rows.map(r => r.kind)).toEqual(['section', 'card', 'section', 'card', 'card'])
        expect((rows[0] as { title: string }).title).toBe('Folders')
        expect((rows[2] as { title: string }).title).toBe('Files')
    })

    it('skips empty section labels', () => {
        const onlyFiles = buildGridRows({
            folders: [],
            files: [file1],
        })
        expect(onlyFiles.map(r => r.kind)).toEqual(['section', 'card'])
        expect((onlyFiles[0] as { title: string }).title).toBe('Files')

        const onlyFolders = buildGridRows({
            folders: [folder1],
            files: [],
        })
        expect(onlyFolders.map(r => r.kind)).toEqual(['section', 'card'])
        expect((onlyFolders[0] as { title: string }).title).toBe('Folders')
    })

    it('keeps uploading items as cards', () => {
        const uploading = item('upl', { uploadStatus: 'uploading' })
        const rows = buildGridRows({
            folders: [],
            files: [uploading, file1],
        })
        expect(rows).toHaveLength(3)
        expect(rows[0].kind).toBe('section')
        expect(rows[1]).toMatchObject({ kind: 'card', item: { id: 'upl' } })
    })

    it('returns an empty array when there are no folders or files', () => {
        const rows = buildGridRows({ folders: [], files: [] })
        expect(rows).toEqual([])
    })
})
