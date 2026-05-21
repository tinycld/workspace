import { registerPreviewAction } from '@tinycld/core/file-viewer/preview-action-registry'
import type {
    FilePreviewSource,
    PreviewAction,
    PreviewActionContext,
} from '@tinycld/core/file-viewer/types'
import { useOrgHref } from '@tinycld/core/lib/org-routes'
import type { Href } from 'expo-router'
import { router } from 'expo-router'
import { ExternalLink } from 'lucide-react-native'
import { DOCX_MIME_TYPE } from './mime'

/**
 * Build the "Open in Text" preview action. Exposed (instead of being
 * inlined in the registerPreviewAction factory) so unit tests can
 * exercise the action's shape — id, icon, label, isApplicable, and
 * onPress side effects — without needing a React render to invoke
 * the factory hook.
 *
 * `orgHref` is the function returned by useOrgHref(). The factory
 * registered below calls the hook and forwards the result; tests pass
 * a stand-in directly.
 */
export function buildOpenInTextAction(
    orgHref: (path: string, extra?: Record<string, string>) => Href
): PreviewAction {
    return {
        id: 'text.open',
        icon: ExternalLink,
        label: 'Open in Text',
        isApplicable: (source: FilePreviewSource) => source.mimeType === DOCX_MIME_TYPE,
        onPress: (source: FilePreviewSource, ctx: PreviewActionContext) => {
            router.push(orgHref('text/[id]', { id: source.recordId }))
            // Dismiss the preview modal — otherwise it sits open
            // over the destination editor.
            ctx.close()
        },
    }
}

/**
 * Side-effect module: importing this file registers an "Open in Text"
 * entry with core's PreviewModal action registry. The text provider
 * imports it once at app boot so any preview surface (drive's
 * PreviewModal, mail's attachment preview, future packages) gets the
 * button when @tinycld/text is linked AND the previewed file is a
 * .docx.
 *
 * The factory must run inside React (it calls hooks like useOrgHref).
 * Mail's AttachmentStrip and drive's PreviewModal both call
 * `getPreviewActionFactories().map((f) => f())` from inside the
 * component body, which provides the hook context.
 *
 * The previewed file's recordId IS the drive_item.id — text uses
 * drive_items directly as the canonical document record (see
 * manifest.ts: `dependencies: ['drive']`), so no lookup is required.
 */
registerPreviewAction('text.open', () => buildOpenInTextAction(useOrgHref()))
