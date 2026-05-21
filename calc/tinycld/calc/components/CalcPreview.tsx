import { useRenderedHtml } from '@tinycld/core/file-viewer/fetch-rendered-html'
import { HtmlSurface } from '@tinycld/core/file-viewer/HtmlSurface'
import type { PreviewProps } from '@tinycld/core/file-viewer/types'
import { ActivityIndicator, Text, View } from 'react-native'
import { PREVIEW_CSS } from './preview-css'

// CalcPreview is the read-only viewer for .xlsx files. The HTML is
// rendered by the calc server's /api/calc/render/:id endpoint and
// mounted in an isolated iframe (web) or WebView (native) via
// HtmlSurface. No live YDoc, no JSON workbook model, no on-device
// rendering — the server is the only component that ever touches
// xlsx bytes and the only component that emits HTML.
export function CalcPreview({ source }: PreviewProps) {
    const { data, isLoading, error } = useRenderedHtml(source)

    if (isLoading) {
        return (
            <View className="flex-1 items-center justify-center">
                <ActivityIndicator />
            </View>
        )
    }

    if (error) {
        return (
            <View className="flex-1 items-center justify-center px-4">
                <Text className="text-sm text-muted-foreground">
                    Could not open spreadsheet: {error.message}
                </Text>
            </View>
        )
    }

    // The server returns an empty `<section class="tinycld-calc">` wrapper
    // when the underlying file is missing or has no data — treat any
    // fragment without a grid as "nothing to show".
    if (!data || !data.html || !data.html.includes('tinycld-calc-grid')) {
        return (
            <View className="flex-1 items-center justify-center">
                <Text className="text-sm text-muted-foreground">Spreadsheet is empty.</Text>
            </View>
        )
    }

    return (
        <HtmlSurface
            html={data.html}
            css={PREVIEW_CSS}
            ariaLabel={`Preview of ${source.displayName}`}
        />
    )
}
