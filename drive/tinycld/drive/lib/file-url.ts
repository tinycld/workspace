import type { FilePreviewSource } from '@tinycld/core/file-viewer/types'
import type { DriveItemView } from '../types'

const DRIVE_ITEMS_COLLECTION = 'drive_items'

export function driveItemToSource(item: DriveItemView): FilePreviewSource {
    return {
        collectionId: DRIVE_ITEMS_COLLECTION,
        recordId: item.id,
        fileName: item.file,
        displayName: item.name,
        mimeType: item.mimeType,
        size: item.size,
        thumbnailFileName: item.thumbnail || undefined,
    }
}
