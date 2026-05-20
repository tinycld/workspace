// TypeScript and the bundler resolve this bare module to either
// PdfCanvasViewer.web.tsx or PdfCanvasViewer.native.tsx; the bare file is
// here so import sites have a stable path and TS picks up the type. At
// runtime Metro/Webpack pick the platform-specific variant. The body just
// returns null so this file alone is harmless if it ever gets bundled.
export function PdfCanvasViewer(_: { url: string }) {
    return null
}
