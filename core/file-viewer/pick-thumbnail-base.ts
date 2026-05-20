import type { FilePreviewSource } from './types'

/**
 * Pure helper: which file name (if any) to use as the basis for a thumbnail URL.
 * Lives in its own module so tests can import it without pulling in the
 * runtime PocketBase client or native modules (expo-file-system, expo-sharing).
 */
export function pickThumbnailBase(
    source: Pick<FilePreviewSource, 'mimeType' | 'fileName' | 'thumbnailFileName'>
): string {
    if (source.thumbnailFileName) return source.thumbnailFileName
    if (source.mimeType.startsWith('image/') && source.fileName) return source.fileName
    return ''
}
