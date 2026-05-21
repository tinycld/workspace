import { useOrgHref } from '@tinycld/core/lib/org-routes'
import { registerDriveItemAction } from '@tinycld/drive/lib/item-actions-registry'
import { router } from 'expo-router'
import { ExternalLink } from 'lucide-react-native'
import { DOCX_MIME_TYPE } from './mime'

/**
 * Side-effect module: importing this file registers an "Open in Text"
 * entry with drive's per-row context menu registry. The text
 * provider imports it once at app boot. Right-clicking a .docx file
 * row in drive shows the option; clicking it navigates to the full
 * text editor.
 *
 * Sibling to `open-in-text-action.tsx`, which registers the same
 * affordance against the preview-modal toolbar. Two registries
 * because the surfaces operate on different shapes (DriveItemView for
 * row actions; FilePreviewSource for previews) — see
 * `@tinycld/drive/lib/item-actions-registry` for the rationale.
 *
 * The action ID matches across both registries so QA can grep for a
 * single string and see all the places it appears.
 */
registerDriveItemAction('text.open', () => {
    const orgHref = useOrgHref()
    return {
        id: 'text.open',
        icon: ExternalLink,
        label: 'Open in Text',
        isApplicable: item => item.mimeType === DOCX_MIME_TYPE,
        onPress: item => {
            router.push(orgHref('text/[id]', { id: item.id }))
        },
    }
})
