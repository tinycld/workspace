/**
 * Shape returned by a package's public-share metadata endpoint. Cross-package
 * contract: a server route (e.g. drive's `/api/drive/share-link/{token}`)
 * looks up the share token, validates the link is still live, and returns
 * the metadata needed to render the preview UI.
 *
 * Packages that want to expose their own public-share flow (e.g. a future
 * sheets export) implement an endpoint that returns this shape and feed
 * the response to PublicShareLayout.
 */
export interface PublicShareMetadata {
    name: string
    mime_type: string
    size: number
    /**
     * Coarse-grained preview category used by DefaultPublicPreviewFrame to
     * pick a renderer. Keep it loose (string, not enum) so packages can add
     * categories without changing core. Recognized values: 'image', 'pdf',
     * 'video', 'audio'; anything else falls through to a generic preview.
     */
    category: string
    file_url: string
    thumbnail_url: string
    updated: string
    org_name: string
}

/**
 * Distinguishes "link expired/revoked" (HTTP 410) from "not found / invalid
 * token" so the error UI can show the right copy. Thrown by the fetcher the
 * caller hands to PublicShareLayout.
 */
export class PublicShareError extends Error {
    status: number
    constructor(status: number, message: string) {
        super(message)
        this.status = status
    }
}
