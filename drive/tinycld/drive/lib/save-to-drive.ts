import { captureException } from '@tinycld/core/lib/errors'
import type { FilePreviewSource } from '@tinycld/core/file-viewer/types'
import { useMutation } from '@tinycld/core/lib/mutations'
import { notify } from '@tinycld/core/lib/notify'
import { pb } from '@tinycld/core/lib/pocketbase'
import { useOrgInfo } from '@tinycld/core/lib/use-org-info'
import { useOrgSlug } from '@tinycld/core/lib/use-org-slug'
import { useCurrentUserOrg } from '@tinycld/core/lib/use-current-user-org'
import { newRecordId } from 'pbtsdb/core'
import { Platform } from 'react-native'
import { deduplicateName } from './deduplicate-name'

export { deduplicateName }

export interface SaveToDriveInput {
    source: FilePreviewSource
    /** Destination folder ID. Empty string = root ("My Files"). */
    parentId: string
    /** Display name of the destination folder, used in the success toast. */
    parentName: string
}

/**
 * Hook that saves a previewable file (e.g. a mail attachment) into the
 * current user's Drive. Returns a mutation-style object with `mutate`,
 * `mutateAsync`, and `isPending`.
 *
 * Caller chooses the destination folder. Filename collisions get the
 * standard `(1)`, `(2)`, … suffix within the destination.
 */
export function useSaveToDrive() {
    const { orgId } = useOrgInfo()
    const orgSlug = useOrgSlug()
    const userOrg = useCurrentUserOrg(orgSlug ?? '')
    const userOrgId = userOrg?.id ?? ''

    return useMutation({
        mutationFn: async ({ source, parentId, parentName }: SaveToDriveInput) => {
            if (!orgId || !userOrgId) {
                throw new Error('Organization context not ready')
            }

            // Fetch the source file (e.g. a mail attachment served by
            // PocketBase) and shape it for upload. On web we use the standard
            // File constructor; on native there's no global File class and
            // RN's FormData polyfill expects a `{ uri, name, type }` literal
            // instead — so we stream the bytes to a cache URI via
            // expo-file-system and hand that URI to FormData.
            const sourceUrl = pb.files.getURL(
                { collectionId: source.collectionId, id: source.recordId },
                source.fileName
            )
            const mimeType = source.mimeType || 'application/octet-stream'
            const upload = await fetchForUpload(sourceUrl, source.displayName, mimeType)

            // De-duplicate the filename within the destination folder.
            const siblings = await pb.collection('drive_items').getFullList({
                filter: pb.filter('org = {:org} && parent = {:parent}', {
                    org: orgId,
                    parent: parentId,
                }),
                fields: 'name',
            })
            const finalName = deduplicateName(upload.name, new Set(siblings.map((s) => s.name)))

            const itemId = newRecordId()
            const formData = new FormData()
            formData.append('id', itemId)
            formData.append('org', orgId)
            formData.append('name', finalName)
            formData.append('is_folder', 'false')
            formData.append('mime_type', upload.type)
            formData.append('parent', parentId)
            formData.append('created_by', userOrgId)
            formData.append('size', String(upload.size))
            // RN's FormData accepts a `{ uri, name, type }` object literal; on
            // web the `file` field is a real File. We cast to satisfy TS.
            formData.append('file', upload.file as unknown as Blob)
            formData.append('description', '')
            // The drive_items create hook (server/register.go) inserts the
            // owner drive_shares row in the same transaction, so the client
            // must not also insert one — the unique (item, user_org) index
            // would reject it.
            await pb.collection('drive_items').create(formData)

            return { itemId, finalName, parentId, parentName }
        },
        onSuccess: ({ finalName, parentName }) => {
            notify.emit({
                event: 'drive.save_succeeded',
                title: `Saved to ${parentName}`,
                body: finalName,
                durationMs: 4000,
                data: { name: finalName, folder: parentName },
            })
        },
        onError: (err) => {
            const reason = err instanceof Error ? err.message : 'Unknown error'
            captureException('useSaveToDrive', err)
            notify.emit({
                event: 'drive.save_failed',
                title: 'Could not save to Drive',
                body: reason,
                durationMs: 6000,
                data: { reason },
            })
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

async function fetchForUpload(url: string, name: string, mimeType: string): Promise<UploadShape> {
    if (Platform.OS === 'web') {
        const resp = await fetch(url)
        if (!resp.ok) throw new Error(`Could not download attachment (${resp.status})`)
        const blob = await resp.blob()
        const file = new File([blob], name, { type: mimeType || blob.type || 'application/octet-stream' })
        return { name: file.name, type: file.type, size: file.size, file }
    }
    // Native: download to the cache directory; FormData uploads via URI.
    // Lazy-imported so this module stays usable in vitest's node env.
    const { File: FsFile, Paths } = await import('expo-file-system')
    // Suffix the cache filename with a timestamp so repeated saves of the
    // same source (or two attachments named "image.png" from different
    // threads) don't collide. The user-visible filename is still `name` —
    // the cache name only matters until the FormData upload completes.
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

