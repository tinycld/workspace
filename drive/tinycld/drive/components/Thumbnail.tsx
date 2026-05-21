import { Thumbnail as CoreThumbnail } from '@tinycld/core/file-viewer/Thumbnail'
import { driveItemToSource } from '../lib/file-url'
import type { DriveItemView } from '../types'

interface ThumbnailProps {
    item: DriveItemView
    size?: number
}

export function Thumbnail({ item, size = 120 }: ThumbnailProps) {
    return <CoreThumbnail source={driveItemToSource(item)} size={size} />
}
