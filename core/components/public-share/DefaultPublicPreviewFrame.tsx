import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { FileIcon } from 'lucide-react-native'
import { lazy, Suspense } from 'react'
import { ActivityIndicator, Image, Platform, Text, View } from 'react-native'

const PdfCanvasViewer = lazy(() =>
    import('@tinycld/core/file-viewer/previews/PdfCanvasViewer').then(m => ({
        default: m.PdfCanvasViewer,
    }))
)

interface DefaultPublicPreviewFrameProps {
    name: string
    mimeType: string
    category: string
    fileUrl: string
    thumbnailUrl: string
    size: number
}

function formatFileSize(bytes: number) {
    if (bytes === 0) return '0 B'
    const units = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(1024))
    return `${(bytes / 1024 ** i).toFixed(i > 0 ? 1 : 0)} ${units[i]}`
}

/**
 * Renders the body of a public share preview. Generic switch on `category`
 * with sensible inline previews for image / pdf / video / audio and a
 * file-icon fallback for everything else. Packages can pass a custom
 * `renderPreview` to PublicShareLayout to override.
 */
export function DefaultPublicPreviewFrame({
    name,
    mimeType,
    category,
    fileUrl,
    size,
}: DefaultPublicPreviewFrameProps) {
    const inlineUrl = `${fileUrl}${fileUrl.includes('?') ? '&' : '?'}inline=1`

    if (category === 'image') return <ImagePreview url={inlineUrl} name={name} />
    if (category === 'pdf') return <PdfPreview url={inlineUrl} />
    if (category === 'video') return <VideoPreview url={inlineUrl} mimeType={mimeType} />
    if (category === 'audio')
        return <AudioPreview url={inlineUrl} name={name} mimeType={mimeType} />

    return <GenericPreview name={name} mimeType={mimeType} size={size} />
}

function ImagePreview({ url, name }: { url: string; name: string }) {
    return (
        <View className="flex-1 items-center justify-center p-6">
            <Image
                source={{ uri: url }}
                accessibilityLabel={name}
                resizeMode="contain"
                className="w-full h-full"
            />
        </View>
    )
}

function PdfPreview({ url }: { url: string }) {
    if (Platform.OS !== 'web') {
        return <GenericPreview name="PDF Document" mimeType="application/pdf" size={0} />
    }

    return (
        <Suspense fallback={<ActivityIndicator />}>
            <PdfCanvasViewer url={url} />
        </Suspense>
    )
}

function VideoPreview({ url, mimeType }: { url: string; mimeType: string }) {
    if (Platform.OS !== 'web') {
        return <GenericPreview name="Video" mimeType={mimeType} size={0} />
    }

    return (
        <View className="flex-1 items-center justify-center p-6">
            {/* biome-ignore lint/a11y/useMediaCaption: shared file preview without captions */}
            <video src={url} controls style={{ maxWidth: '100%', maxHeight: '100%' }} />
        </View>
    )
}

function AudioPreview({ url, name, mimeType }: { url: string; name: string; mimeType: string }) {
    const mutedColor = useThemeColor('muted-foreground')

    if (Platform.OS !== 'web') {
        return <GenericPreview name={name} mimeType={mimeType} size={0} />
    }

    return (
        <View className="items-center justify-center flex-1 gap-4 p-6">
            <FileIcon size={64} color={mutedColor} />
            <Text className="text-foreground" style={{ fontWeight: '600' }}>
                {name}
            </Text>
            {/* biome-ignore lint/a11y/useMediaCaption: shared file preview without captions */}
            <audio src={url} controls style={{ width: '100%', maxWidth: 400 }} />
        </View>
    )
}

function GenericPreview({
    name,
    mimeType,
    size,
}: {
    name: string
    mimeType: string
    size: number
}) {
    const mutedColor = useThemeColor('muted-foreground')

    return (
        <View className="items-center justify-center flex-1 gap-4 p-6">
            <FileIcon size={64} color={mutedColor} />
            <Text className="text-center text-foreground" style={{ fontWeight: '600' }}>
                {name}
            </Text>
            <Text className="text-muted-foreground" style={{ fontSize: 12 }}>
                {mimeType || 'Unknown type'}
                {size > 0 ? ` • ${formatFileSize(size)}` : ''}
            </Text>
        </View>
    )
}
