import { captureException } from '@tinycld/core/lib/errors'
import { useMutation } from '@tinycld/core/lib/mutations'
import { pb } from '@tinycld/core/lib/pocketbase'
import { useCurrentUserOrg } from '@tinycld/core/lib/use-current-user-org'
import { useOrgInfo } from '@tinycld/core/lib/use-org-info'
import { useOrgSlug } from '@tinycld/core/lib/use-org-slug'
import { newRecordId } from 'pbtsdb/core'
import { Platform } from 'react-native'
import { deduplicateName } from './deduplicate-name'

export interface CopyDriveItemInput {
    /** Drive item to duplicate. Must reference a non-folder item. */
    sourceItemId: string
    /**
     * Desired name for the new copy. The server still runs its dedup hook on
     * top — if `newName` collides with another sibling in `parentId`, the
     * server suffixes `(1)`, `(2)`, … — so callers don't have to pre-resolve.
     */
    newName: string
    /**
     * Destination folder. Defaults to the source's parent (Sheets-style
     * "Make a copy" lands the copy alongside the original).
     */
    parentId?: string
}

export interface CopyDriveItemResult {
    itemId: string
    finalName: string
    parentId: string
}

// useCopyDriveItem duplicates a non-folder drive_items row into a new
// drive_items row with a fresh file blob. Implementation parallels
// useSaveToDrive's fetch-then-upload flow but is parameterized by an
// existing drive item id (rather than an arbitrary FilePreviewSource),
// so callers in other packages — e.g. @tinycld/calc's File → Make a
// copy menu — don't need to know what fields live on `drive_items`.
//
// Folder copies are not supported here; they'd need a recursive walk
// + per-descendant blob copy. Throws if `sourceItemId` resolves to a
// folder.
export function useCopyDriveItem() {
    const { orgId } = useOrgInfo()
    const orgSlug = useOrgSlug()
    const userOrg = useCurrentUserOrg(orgSlug ?? '')
    const userOrgId = userOrg?.id ?? ''

    return useMutation({
        mutationFn: async (input: CopyDriveItemInput): Promise<CopyDriveItemResult> => {
            if (!orgId || !userOrgId) {
                throw new Error('Organization context not ready')
            }

            const source = await pb.collection('drive_items').getOne(input.sourceItemId, {
                fields: 'id,name,mime_type,file,parent,is_folder',
            })
            if (source.is_folder) {
                throw new Error('Cannot copy folders')
            }
            if (!source.file) {
                throw new Error('Source drive item has no file blob to copy')
            }

            const parentId = input.parentId ?? (source.parent ?? '')
            const mimeType = source.mime_type || 'application/octet-stream'

            const sourceUrl = pb.files.getURL(
                { collectionId: 'drive_items', id: source.id },
                source.file
            )
            const upload = await fetchForUpload(sourceUrl, input.newName, mimeType)

            // Pre-dedupe so we report the right final name back to the caller
            // even on the happy path (the server-side hook would do the same
            // thing, but the client doesn't see the server-rewritten name).
            const siblings = await pb.collection('drive_items').getFullList({
                filter: pb.filter('org = {:org} && parent = {:parent}', {
                    org: orgId,
                    parent: parentId,
                }),
                fields: 'name',
            })
            const finalName = deduplicateName(upload.name, new Set(siblings.map(s => s.name)))

            const itemId = newRecordId()
            const formData = new FormData()
            formData.append('id', itemId)
            formData.append('org', orgId)
            formData.append('name', finalName)
            formData.append('is_folder', 'false')
            formData.append('mime_type', mimeType)
            formData.append('parent', parentId)
            formData.append('created_by', userOrgId)
            formData.append('size', String(upload.size))
            // RN's FormData accepts a `{ uri, name, type }` object literal; on
            // web the `file` field is a real File. We cast to satisfy TS.
            formData.append('file', upload.file as unknown as Blob, finalName)
            formData.append('description', '')
            // The drive_items create hook (server/register.go) inserts the
            // owner drive_shares row in the same transaction, so the client
            // must not also insert one — the unique (item, user_org) index
            // would reject it.
            await pb.collection('drive_items').create(formData)

            return { itemId, finalName, parentId }
        },
        onError: err => {
            captureException('useCopyDriveItem', err)
        },
    })
}

interface UploadShape {
    name: string
    type: string
    size: number
    /** A `File` on web, a `{ uri, name, type }` literal on native. */
    file: unknown
}

// Mirrors save-to-drive's fetchForUpload. Kept private here rather than
// shared so save-to-drive (which also reports a destination-folder name
// in its success toast) stays self-contained. If the duplication grows
// past two call sites, extract into a shared module under drive/lib.
async function fetchForUpload(url: string, name: string, mimeType: string): Promise<UploadShape> {
    if (Platform.OS === 'web') {
        const resp = await fetch(url)
        if (!resp.ok) throw new Error(`Could not fetch source file (${resp.status})`)
        const blob = await resp.blob()
        const file = new File([blob], name, {
            type: mimeType || blob.type || 'application/octet-stream',
        })
        return { name: file.name, type: file.type, size: file.size, file }
    }
    const { File: FsFile, Paths } = await import('expo-file-system')
    const cacheName = `${Date.now()}-${name}`
    const target = new FsFile(Paths.cache, cacheName)
    const downloaded = await FsFile.downloadFileAsync(url, target)
    const size = downloaded.size ?? 0
    return {
        name,
        type: mimeType,
        size,
        file: { uri: downloaded.uri, name, type: mimeType },
    }
}
