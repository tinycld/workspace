import { registerPreviewAction } from '@tinycld/core/file-viewer/preview-action-registry'
import { useOrgHref } from '@tinycld/core/lib/org-routes'
import { router } from 'expo-router'
import { ExternalLink } from 'lucide-react-native'
import { XLSX_MIME_TYPE } from '../types'

/**
 * Side-effect module: importing this file registers an "Open in Calc"
 * entry with core's PreviewModal action registry. The calc provider
 * imports it once at app boot so any preview surface (drive's
 * PreviewModal, mail's attachment preview, future packages) gets the
 * button when @tinycld/calc is linked AND the previewed file is an
 * .xlsx.
 *
 * The onPress handler navigates to the full calc editor at
 * /a/<orgSlug>/calc/<drive_item_id>. The previewed file's recordId
 * IS the drive_item.id — calc uses drive_items directly as the
 * canonical workbook record (see manifest.ts: `dependencies: ['drive']`),
 * so no lookup is required.
 *
 * Note: the registry's factory must run inside React (it calls hooks
 * like useOrgHref). Mail's AttachmentStrip and drive's PreviewModal
 * both call `getPreviewActionFactories().map((f) => f())` from inside
 * the component body, which provides the hook context.
 */
registerPreviewAction('calc.open', () => {
    const orgHref = useOrgHref()
    return {
        id: 'calc.open',
        icon: ExternalLink,
        label: 'Open in Calc',
        isApplicable: source => source.mimeType === XLSX_MIME_TYPE,
        onPress: (source, ctx) => {
            router.push(orgHref('calc/[id]', { id: source.recordId }))
            // Dismiss the preview modal — otherwise it sits open
            // over the destination editor.
            ctx.close()
        },
    }
})
