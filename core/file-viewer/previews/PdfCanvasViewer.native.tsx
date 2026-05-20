import { captureException } from '@tinycld/core/lib/errors'
import { useState } from 'react'
import { Text, View } from 'react-native'
import Pdf from 'react-native-pdf'

// Native PDF rendering. The web variant lazy-loads `react-pdf`/`pdfjs-dist`;
// here we stay with the native renderer (`react-native-pdf` → WKWebView/pdf.js
// on iOS, AndroidPdfViewer on Android) which streams the URL itself, so no
// `expo-file-system` plumbing is needed. The URL we receive already carries a
// PocketBase `?token=...` query param via `useAuthedFileURL`.
export function PdfCanvasViewer({ url }: { url: string }) {
    const [errored, setErrored] = useState(false)

    if (errored) {
        return (
            <View className="flex-1 items-center justify-center p-8">
                <Text className="text-foreground text-center">Could not load this PDF.</Text>
            </View>
        )
    }

    return (
        <View className="flex-1 bg-background">
            <Pdf
                source={{ uri: url, cache: true }}
                style={pdfStyle}
                trustAllCerts={false}
                onError={err => {
                    captureException('PdfCanvasViewer', err instanceof Error ? err : new Error(String(err)))
                    setErrored(true)
                }}
            />
        </View>
    )
}

const pdfStyle = { flex: 1, width: '100%' as const, height: '100%' as const }
