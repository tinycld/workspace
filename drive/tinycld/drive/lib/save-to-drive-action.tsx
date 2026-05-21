import { registerPreviewAction } from '@tinycld/core/file-viewer/preview-action-registry'
import { Save } from 'lucide-react-native'
import { useSaveToDriveStore } from '../stores/save-to-drive-store'

/**
 * Side-effect module: importing this file registers a "Save to Drive" entry
 * with core's PreviewModal action registry. Drive's provider imports it once
 * at app boot so any preview surface (mail, future packages) automatically
 * gets the action button when @tinycld/drive is linked.
 *
 * The onPress handler opens the SaveToDriveDialog (mounted by DriveProvider),
 * which presents drive's standard folder picker. The dialog runs the actual
 * save mutation against the user-chosen folder.
 */
registerPreviewAction('drive.save', () => {
    const open = useSaveToDriveStore((s) => s.open)
    return {
        id: 'drive.save',
        icon: Save,
        label: 'Save to Drive',
        isApplicable: (source) => source.collectionId !== 'drive_items',
        onPress: (source) => {
            open(source)
        },
    }
})
