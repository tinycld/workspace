/**
 * Pure helpers for normalizing native file-picker results into a shape that
 * FormData can consume in the same way a browser's File does.
 *
 * The React/Expo bits live in `use-pick-files.ts`; these helpers are split out
 * so the unit tests can run in vitest's node environment without needing a DOM
 * or expo modules.
 */

export interface PickedFile {
    name: string
    type: string
    size: number
    /**
     * The thing to put into FormData under the file field.
     *
     * On web this is a real `File`. On native it's an object literal
     * `{ uri, name, type, size }` that React Native's FormData polyfill
     * recognizes and uploads as multipart. We intentionally cast to `File`
     * because every consumer of this value (mail's addFiles, drive's
     * uploadFiles) only reads `.size`/`.type`/`.name` and treats the value
     * as opaque when handing it to FormData.
     */
    file: File
}

export interface DocumentAssetLike {
    uri: string
    name?: string | null
    mimeType?: string | null
    size?: number | null
}

export interface ImageAssetLike {
    uri: string
    fileName?: string | null
    mimeType?: string | null
    fileSize?: number | null
    type?: 'image' | 'video' | 'livePhoto' | 'pairedVideo' | string | null
}

export function documentAssetToPickedFile(asset: DocumentAssetLike): PickedFile {
    const name = asset.name ?? deriveNameFromUri(asset.uri) ?? 'document'
    const type = asset.mimeType ?? 'application/octet-stream'
    const size = asset.size ?? 0
    return wrapAsFile({ uri: asset.uri, name, type, size })
}

export function imageAssetToPickedFile(asset: ImageAssetLike): PickedFile {
    const fallbackExt = asset.mimeType?.split('/')[1] ?? (asset.type === 'video' ? 'mp4' : 'jpg')
    const name =
        asset.fileName ?? deriveNameFromUri(asset.uri) ?? `IMG_${Date.now()}.${fallbackExt}`
    const type = asset.mimeType ?? (asset.type === 'video' ? 'video/mp4' : 'image/jpeg')
    const size = asset.fileSize ?? 0
    return wrapAsFile({ uri: asset.uri, name, type, size })
}

export function webFileToPickedFile(file: File): PickedFile {
    return { name: file.name, type: file.type, size: file.size, file }
}

function deriveNameFromUri(uri: string): string | undefined {
    const trailing = uri.split('/').pop()
    if (!trailing) return undefined
    // Strip query string if present (e.g. content URIs sometimes include one).
    const clean = trailing.split('?')[0]
    return clean || undefined
}

interface NativeFileShape {
    uri: string
    name: string
    type: string
    size: number
}

function wrapAsFile(payload: NativeFileShape): PickedFile {
    return {
        name: payload.name,
        type: payload.type,
        size: payload.size,
        file: payload as unknown as File,
    }
}
