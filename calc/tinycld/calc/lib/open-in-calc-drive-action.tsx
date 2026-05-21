import { useOrgHref } from '@tinycld/core/lib/org-routes'
import { registerDriveItemAction } from '@tinycld/drive/lib/item-actions-registry'
import { router } from 'expo-router'
import { ExternalLink } from 'lucide-react-native'
import { XLSX_MIME_TYPE } from '../types'

/**
 * Side-effect module: importing this file registers an "Open in Calc"
 * entry with drive's per-row context menu registry. The calc
 * provider imports it once at app boot. Right-clicking an .xlsx file
 * row in drive shows the option; clicking it navigates to the full
 * calc editor.
 *
 * Sibling to `open-in-calc-action.tsx`, which registers the same
 * affordance against the preview-modal toolbar. Two registries
 * because the surfaces operate on different shapes (DriveItemView for
 * row actions; FilePreviewSource for previews) — see
 * `@tinycld/drive/lib/item-actions-registry` for the rationale.
 *
 * The action ID matches across both registries so QA can grep for a
 * single string and see all the places it appears.
 */
registerDriveItemAction('calc.open', () => {
    const orgHref = useOrgHref()
    return {
        id: 'calc.open',
        icon: ExternalLink,
        label: 'Open in Calc',
        isApplicable: item => item.mimeType === XLSX_MIME_TYPE,
        onPress: item => {
            router.push(orgHref('calc/[id]', { id: item.id }))
        },
    }
})
