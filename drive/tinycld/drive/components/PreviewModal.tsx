import { PreviewModal as CorePreviewModal } from '@tinycld/core/file-viewer/PreviewModal'
import { getPreviewActionFactories } from '@tinycld/core/file-viewer/preview-action-registry'
import { useCallback, useMemo } from 'react'
import { useDrive } from '../hooks/useDrive'
import { driveItemToSource } from '../lib/file-url'
import type { DriveItemView } from '../types'

interface PreviewModalProps {
    isVisible: boolean
    item: DriveItemView | null
    onClose: () => void
}

export function PreviewModal({ isVisible, item, onClose }: PreviewModalProps) {
    const { currentItems, openPreview, downloadItem } = useDrive()

    const files = useMemo(() => currentItems.filter(i => !i.isFolder), [currentItems])
    const currentIndex = item ? files.findIndex(f => f.id === item.id) : -1
    const hasPrevious = currentIndex > 0
    const hasNext = currentIndex >= 0 && currentIndex < files.length - 1

    const handlePrevious = useCallback(() => {
        if (hasPrevious) openPreview(files[currentIndex - 1])
    }, [hasPrevious, currentIndex, files, openPreview])

    const handleNext = useCallback(() => {
        if (hasNext) openPreview(files[currentIndex + 1])
    }, [hasNext, currentIndex, files, openPreview])

    const handleDownload = useCallback(() => {
        if (item) downloadItem(item.id)
    }, [downloadItem, item])

    // Extension-point actions registered by other packages (e.g.
    // calc's "Open in Calc"). Factories register at module-load
    // time, so the list is stable for the lifetime of the app —
    // calling each factory unconditionally here is safe under the
    // rules of hooks. CorePreviewModal handles `isApplicable` filtering.
    const previewActions = getPreviewActionFactories().map(factory => factory())

    return (
        <CorePreviewModal
            isVisible={isVisible}
            source={item ? driveItemToSource(item) : null}
            onClose={onClose}
            onPrevious={hasPrevious ? handlePrevious : undefined}
            onNext={hasNext ? handleNext : undefined}
            onDownload={handleDownload}
            actions={previewActions}
        />
    )
}
