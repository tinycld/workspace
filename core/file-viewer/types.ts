import type { LucideIcon } from 'lucide-react-native'
import type { ComponentType } from 'react'

/**
 * The minimal metadata core's file viewer needs in order to display, fetch, and
 * thumbnail any PocketBase-backed file. Each consuming package (drive, mail, …)
 * adapts its own record shape into this type at the call site.
 */
export interface FilePreviewSource {
    collectionId: string
    recordId: string
    /** PocketBase file field value — the on-disk filename including the random suffix. */
    fileName: string
    /** Display name shown in the UI (typically with the random suffix stripped). */
    displayName: string
    mimeType: string
    size: number
    /**
     * Optional dedicated thumbnail file (e.g. a PDF first-page render, an Office
     * preview). When absent, image MIME types fall back to PocketBase's `?thumb=`
     * query parameter on the original file.
     */
    thumbnailFileName?: string
}

export interface PreviewProps {
    source: FilePreviewSource
    onClose: () => void
    onNext?: () => void
    onPrevious?: () => void
}

export interface ThumbnailProps {
    source: FilePreviewSource
    size?: number
}

export interface PreviewRegistryEntry {
    thumbnail?: ComponentType<ThumbnailProps>
    preview: ComponentType<PreviewProps>
}

/**
 * Context handed to a PreviewAction's onPress, alongside the source.
 * Surfaces are responsible for supplying these — drive's PreviewModal
 * and mail's AttachmentStrip each pass their own concrete `close`
 * implementation.
 */
export interface PreviewActionContext {
    /**
     * Closes the preview surface that hosts this action. Sheets's
     * "Open in Sheets" calls this after navigating away so the modal
     * doesn't sit open over the destination screen. "Save to Drive"
     * intentionally doesn't call this — it keeps the preview up so
     * the user can cancel the save and remain on the preview.
     */
    close: () => void
}

/**
 * A consumer-supplied action button rendered in the PreviewModal toolbar.
 * Mail uses this to inject a "Save to Drive" entry without core needing to
 * know anything about drive.
 */
export interface PreviewAction {
    /** Stable identifier used as the React key. */
    id: string
    /** Icon shown in the toolbar; tooltipped/announced via accessibilityLabel. */
    icon: LucideIcon
    /** Short human-readable label (used as accessibility label and tooltip). */
    label: string
    /** Disable the button while async work is in flight. */
    isPending?: boolean
    /**
     * Optional per-source predicate. When supplied, the action is only
     * rendered for sources where this returns true. Sheets uses this to
     * limit "Open in Sheets" to xlsx mime types; "Save to Drive" needs
     * no such filter (any attachment can be saved). Default: always
     * applicable.
     */
    isApplicable?: (source: FilePreviewSource) => boolean
    /**
     * Invoked with the currently-displayed source and a context bag
     * carrying surface-level callbacks (e.g. `close()` to dismiss the
     * preview). Actions that navigate away should call `ctx.close()`
     * so the preview doesn't sit open over the destination.
     */
    onPress: (source: FilePreviewSource, ctx: PreviewActionContext) => void
}
