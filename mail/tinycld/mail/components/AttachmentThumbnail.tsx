import { downloadFile } from '@tinycld/core/file-viewer/file-url'
import { getFileIconForMime } from '@tinycld/core/file-viewer/file-icons'
import type { FilePreviewSource } from '@tinycld/core/file-viewer/types'
import { useAuthedThumbnailURL } from '@tinycld/core/file-viewer/use-authed-file-url'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Download } from 'lucide-react-native'
import { Image, Pressable, Text, View } from 'react-native'

const CARD_WIDTH = 160
const CARD_HEIGHT = 90

interface AttachmentThumbnailProps {
    source: FilePreviewSource
    onPress?: () => void
}

export function AttachmentThumbnail({ source, onPress }: AttachmentThumbnailProps) {
    const mutedColor = useThemeColor('muted-foreground')
    const { icon: FileIcon, color: iconColor } = getFileIconForMime(source.mimeType, mutedColor)
    // Request a thumbnail sized roughly for the card. The dedicated
    // attachment_thumbnail field (PDF first-page render, etc.) is preferred
    // when present; image MIME types fall back to PocketBase's ?thumb=.
    const { url: thumbnailUrl } = useAuthedThumbnailURL(source, `${CARD_WIDTH * 2}x${CARD_HEIGHT * 2}`)

    return (
        <Pressable
            className="rounded-lg border border-border overflow-hidden bg-surface-secondary"
            style={{ width: CARD_WIDTH }}
            onPress={onPress}
        >
            {thumbnailUrl ? (
                <Image
                    source={{ uri: thumbnailUrl }}
                    style={{ width: '100%', height: CARD_HEIGHT }}
                    resizeMode="cover"
                />
            ) : (
                <View
                    className="w-full items-center justify-center bg-surface-secondary"
                    style={{ height: CARD_HEIGHT }}
                >
                    <FileIcon size={24} color={iconColor} />
                </View>
            )}
            <View className="flex-row items-center px-2 gap-1" style={{ paddingVertical: 6 }}>
                <Text className="flex-1 text-foreground" style={{ fontSize: 12, fontWeight: '500' }} numberOfLines={1}>
                    {source.displayName}
                </Text>
                <Pressable
                    onPress={(event) => {
                        // Stop the parent card's onPress (preview) from also firing.
                        event.stopPropagation()
                        downloadFile(source)
                    }}
                    className="p-1 rounded"
                    hitSlop={6}
                    accessibilityLabel={`Download ${source.displayName}`}
                >
                    <Download size={14} color={mutedColor} />
                </Pressable>
            </View>
        </Pressable>
    )
}
