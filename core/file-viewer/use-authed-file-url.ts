import { useQuery } from '@tanstack/react-query'
import { pb } from '@tinycld/core/lib/pocketbase'
import { pickThumbnailBase } from './pick-thumbnail-base'
import type { FilePreviewSource } from './types'

// PocketBase serves files behind the parent record's viewRule. Browsers carry
// the auth implicitly via the SDK's request pipeline, but native HTTP fetches
// (react-native-pdf, expo-file-system, …) need an explicit `?token=` query
// param. The token comes from `pb.files.getToken()`, lives ~2 minutes, and is
// per-user — so it's safe to share across previews. We cache it via React
// Query with a stale time well under the server-side expiry, and key off a
// constant so concurrent consumers (50 list thumbnails + an open preview)
// dedupe to a single network request.
const FILE_TOKEN_STALE_MS = 90_000
const FILE_TOKEN_QUERY_KEY = ['pb-files-token'] as const

export function useFileToken() {
    return useQuery({
        queryKey: FILE_TOKEN_QUERY_KEY,
        queryFn: () => pb.files.getToken(),
        staleTime: FILE_TOKEN_STALE_MS,
        gcTime: FILE_TOKEN_STALE_MS,
        enabled: pb.authStore.isValid,
    })
}

export function buildAuthedFileURL(
    source: FilePreviewSource | undefined,
    token: string | undefined
) {
    if (!source?.fileName) return ''
    return pb.files.getURL(
        { collectionId: source.collectionId, id: source.recordId },
        source.fileName,
        token ? { token } : undefined
    )
}

export function buildAuthedThumbnailURL(
    source: FilePreviewSource | undefined,
    size: string,
    token: string | undefined
) {
    if (!source) return ''
    const baseUrl = pickThumbnailBase(source)
    if (!baseUrl) return ''
    const url = pb.files.getURL(
        { collectionId: source.collectionId, id: source.recordId },
        baseUrl,
        token ? { token } : undefined
    )
    return `${url}${url.includes('?') ? '&' : '?'}thumb=${size}`
}

export function useAuthedFileURL(source: FilePreviewSource | undefined) {
    const enabled = !!source?.fileName && pb.authStore.isValid
    const { data: token, isLoading } = useFileToken()
    const url = buildAuthedFileURL(source, token)
    return { url, isLoading: enabled && isLoading && !token }
}

export function useAuthedThumbnailURL(source: FilePreviewSource | undefined, size: string) {
    const enabled = !!source && !!pickThumbnailBase(source) && pb.authStore.isValid
    const { data: token, isLoading } = useFileToken()
    const url = buildAuthedThumbnailURL(source, size, token)
    return { url, isLoading: enabled && isLoading && !token }
}

/**
 * Imperative one-shot fetch for the file token. Use from non-React contexts
 * (download handlers, share-sheet flows). React components should use
 * `useFileToken` / `useAuthedFileURL` so the request is shared via React
 * Query's cache.
 */
export async function getFileToken(): Promise<string | undefined> {
    if (!pb.authStore.isValid) return undefined
    try {
        return await pb.files.getToken()
    } catch {
        return undefined
    }
}
