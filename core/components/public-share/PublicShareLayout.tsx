import { useQuery } from '@tanstack/react-query'
import { downloadFromUrl } from '@tinycld/core/file-viewer/file-url'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Modal, ModalBackdrop, ModalContent } from '@tinycld/core/ui/modal'
import { Download, FileIcon } from 'lucide-react-native'
import type { ReactNode } from 'react'
import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import { DefaultPublicPreviewFrame } from './DefaultPublicPreviewFrame'
import { PublicShareError, type PublicShareMetadata } from './types'

export interface PublicShareLayoutProps {
    /**
     * Stable cache key for the share record. Typically `[packageSlug, token]`
     * so multiple packages with their own share endpoints don't collide.
     */
    queryKey: readonly unknown[]
    /**
     * Fetches the metadata for the share link. Throw a `PublicShareError`
     * (with `status === 410` for revoked/expired links) so the layout can
     * pick the right error copy.
     */
    fetchMetadata: () => Promise<PublicShareMetadata>
    /**
     * Optional override for the preview body. Defaults to a generic
     * image/pdf/video/audio/file switch keyed off `metadata.category`.
     */
    renderPreview?: (metadata: PublicShareMetadata) => ReactNode
}

/**
 * Generic layout for any package's "public link to a single resource" page.
 * Owns the data fetch, the modal shell, the loading and error states, and
 * the download button (delegating to core's downloadFromUrl, which works on
 * web and native). Packages plug in their own metadata fetcher and, if they
 * want, a custom preview body.
 */
export function PublicShareLayout({
    queryKey,
    fetchMetadata,
    renderPreview,
}: PublicShareLayoutProps) {
    const { data, isLoading, error } = useQuery<PublicShareMetadata>({
        queryKey,
        queryFn: fetchMetadata,
        retry: false,
    })

    if (isLoading) return <LoadingDisplay />
    if (error) return <ErrorDisplay error={error} />
    if (!data) return null

    const preview = renderPreview ? (
        renderPreview(data)
    ) : (
        <DefaultPublicPreviewFrame
            name={data.name}
            mimeType={data.mime_type}
            category={data.category}
            fileUrl={data.file_url}
            thumbnailUrl={data.thumbnail_url}
            size={data.size}
        />
    )

    return (
        <View className="flex-1 bg-background">
            <Modal isOpen onClose={() => {}}>
                <ModalBackdrop />
                <ModalContent className="w-[95vw] h-[90vh] max-w-[1400px] p-0 rounded-xl overflow-hidden">
                    <PreviewHeader
                        name={data.name}
                        orgName={data.org_name}
                        fileUrl={data.file_url}
                        mimeType={data.mime_type}
                    />
                    <View className="flex-1 overflow-hidden">{preview}</View>
                </ModalContent>
            </Modal>
        </View>
    )
}

function LoadingDisplay() {
    return (
        <View className="items-center justify-center flex-1 gap-4">
            <ActivityIndicator size="large" />
            <Text className="text-muted-foreground">Loading shared file...</Text>
        </View>
    )
}

function ErrorDisplay({ error }: { error: unknown }) {
    const mutedColor = useThemeColor('muted-foreground')
    const status = error instanceof PublicShareError ? error.status : 0
    const isExpired = status === 410
    const title = isExpired ? 'Link expired' : 'Link not found'
    const description = isExpired
        ? 'This share link has expired or been revoked.'
        : 'This share link is invalid or the file has been removed.'

    return (
        <View className="items-center justify-center flex-1 gap-4 p-6">
            <FileIcon size={64} color={mutedColor} />
            <Text className="text-foreground" style={{ fontSize: 20, fontWeight: '600' }}>
                {title}
            </Text>
            <Text className="text-center text-muted-foreground" style={{ maxWidth: 400 }}>
                {description}
            </Text>
        </View>
    )
}

function PreviewHeader({
    name,
    orgName,
    fileUrl,
    mimeType,
}: {
    name: string
    orgName: string
    fileUrl: string
    mimeType: string
}) {
    const mutedColor = useThemeColor('muted-foreground')

    const handleDownload = () => {
        // The metadata's file_url already encodes any provider-specific query
        // (drive uses `?inline=0`); downloadFromUrl preserves it verbatim.
        const url = `${fileUrl}${fileUrl.includes('?') ? '&' : '?'}inline=0`
        downloadFromUrl(url, name, mimeType)
    }

    return (
        <View className="flex-row items-center px-4 py-3 gap-3 border-b border-border">
            <View className="flex-1 gap-1">
                <Text
                    numberOfLines={1}
                    className="text-foreground"
                    style={{ fontSize: 16, fontWeight: '600' }}
                >
                    {name}
                </Text>
                {orgName ? (
                    <Text
                        numberOfLines={1}
                        className="text-muted-foreground"
                        style={{ fontSize: 12 }}
                    >
                        Shared from {orgName}
                    </Text>
                ) : null}
            </View>
            <Pressable onPress={handleDownload} className="p-1.5 rounded-md" hitSlop={8}>
                <Download size={18} color={mutedColor} />
            </Pressable>
        </View>
    )
}
