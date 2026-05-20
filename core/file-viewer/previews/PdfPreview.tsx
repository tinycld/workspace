import { lazy, Suspense } from 'react'
import { ActivityIndicator } from 'react-native'
import type { PreviewProps } from '../types'
import { useAuthedFileURL } from '../use-authed-file-url'

const PdfCanvasViewer = lazy(() =>
    import('./PdfCanvasViewer').then(m => ({ default: m.PdfCanvasViewer }))
)

export function PdfPreview(props: PreviewProps) {
    const { url, isLoading } = useAuthedFileURL(props.source)

    if (isLoading) return <ActivityIndicator />
    if (!url) return null

    return (
        <Suspense fallback={<ActivityIndicator />}>
            <PdfCanvasViewer url={url} />
        </Suspense>
    )
}
