import { useWebStylesheet } from '@tinycld/core/lib/use-web-styles'
import { useEffect, useRef, useState } from 'react'
import { View } from 'react-native'
import { Document, Page, pdfjs } from 'react-pdf'

pdfjs.GlobalWorkerOptions.workerSrc = '/workers/pdfcanvas/pdf.worker.min.mjs'

// The modal Dialog uses a FocusScope with trapped={true} that listens for
// focusin/focusout on the document. During a mouse drag for text selection, the
// browser fires focus events which trigger the trap's scheduleRefocus(), snapping
// focus back via rAF and killing the in-progress selection. This hook suppresses
// those focus events during drags so the browser's native selection works.
function useFocusTrapDragFix(containerRef: React.RefObject<HTMLElement | null>) {
    useEffect(() => {
        const container = containerRef.current
        if (!container) return

        let isDragging = false

        const onMouseDown = (e: MouseEvent) => {
            if (container.contains(e.target as Node)) {
                isDragging = true
            }
        }
        const onMouseUp = () => {
            isDragging = false
        }
        const onFocusIn = (e: FocusEvent) => {
            if (isDragging) e.stopImmediatePropagation()
        }
        const onFocusOut = (e: FocusEvent) => {
            if (isDragging) e.stopImmediatePropagation()
        }

        document.addEventListener('mousedown', onMouseDown, { capture: true })
        document.addEventListener('mouseup', onMouseUp, { capture: true })
        document.addEventListener('focusin', onFocusIn, { capture: true })
        document.addEventListener('focusout', onFocusOut, { capture: true })

        return () => {
            document.removeEventListener('mousedown', onMouseDown, { capture: true })
            document.removeEventListener('mouseup', onMouseUp, { capture: true })
            document.removeEventListener('focusin', onFocusIn, { capture: true })
            document.removeEventListener('focusout', onFocusOut, { capture: true })
        }
    }, [containerRef])
}

const PAGE_GAP = 16
const PADDING = 16
const INTERSECTION_MARGIN = '100%'

function LazyPage({ pageNumber, width }: { pageNumber: number; width: number }) {
    const ref = useRef<HTMLDivElement>(null)
    const [shouldRender, setShouldRender] = useState(false)

    useEffect(() => {
        const el = ref.current
        if (!el) return

        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting) {
                    setShouldRender(true)
                    observer.disconnect()
                }
            },
            { rootMargin: INTERSECTION_MARGIN }
        )
        observer.observe(el)
        return () => observer.disconnect()
    }, [])

    const estimatedHeight = width * 1.294

    return (
        <div
            ref={ref}
            style={{ ...pageWrapperStyles, minHeight: shouldRender ? undefined : estimatedHeight }}
        >
            {shouldRender && <Page pageNumber={pageNumber} width={width} />}
        </div>
    )
}

export function PdfCanvasViewer({ url }: { url: string }) {
    const [pageCount, setPageCount] = useState(0)
    const [containerWidth, setContainerWidth] = useState(0)
    const containerRef = useRef<HTMLDivElement>(null)

    useWebStylesheet('react-pdf-text-layer-css', '/workers/pdfcanvas/react-pdf-text-layer.css')
    useWebStylesheet(
        'react-pdf-annotation-layer-css',
        '/workers/pdfcanvas/react-pdf-annotation-layer.css'
    )

    useFocusTrapDragFix(containerRef)

    const pageWidth = containerWidth - PADDING * 2

    return (
        <View className="flex-1" onLayout={e => setContainerWidth(e.nativeEvent.layout.width)}>
            <div ref={containerRef} style={scrollContainerStyles}>
                <Document file={url} onLoadSuccess={({ numPages }) => setPageCount(numPages)}>
                    {pageWidth > 0 &&
                        Array.from({ length: pageCount }, (_, i) => {
                            const pageNumber = i + 1
                            return (
                                <LazyPage
                                    key={pageNumber}
                                    pageNumber={pageNumber}
                                    width={pageWidth}
                                />
                            )
                        })}
                </Document>
            </div>
        </View>
    )
}

const scrollContainerStyles: React.CSSProperties = {
    flex: 1,
    overflow: 'auto',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: PADDING,
    gap: PAGE_GAP,
}

const pageWrapperStyles: React.CSSProperties = {
    boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
}
