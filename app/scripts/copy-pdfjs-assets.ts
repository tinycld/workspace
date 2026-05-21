import * as fs from 'node:fs'
import { createRequire } from 'node:module'
import * as path from 'node:path'

// Copy the runtime assets that PdfCanvasViewer.web.tsx loads at runtime
// (the pdfjs worker .mjs and react-pdf's text/annotation layer CSS) into
// public/workers/pdfcanvas/. Files there are auto-served at the matching
// URL by Expo's web build. Output is gitignored — it always tracks the
// installed package versions.

const ROOT = path.resolve(import.meta.dirname, '..')
const DEST = path.join(ROOT, 'public', 'workers', 'pdfcanvas')
const require = createRequire(import.meta.url)

// Resolve each package's installed directory via Node's resolver rather than a
// hardcoded ROOT/node_modules path. Under npm workspaces a dependency may be
// hoisted to the workspace-root node_modules (one level up from the app shell),
// so a fixed path misses it in CI even though it's installed. require.resolve
// finds it wherever it actually landed.
function packageDir(pkg: string): string {
    // Resolve the package.json to get the package root (works even when the
    // package has no main export, e.g. asset-only resolution).
    const pkgJson = require.resolve(`${pkg}/package.json`)
    return path.dirname(pkgJson)
}

const pdfjsDir = packageDir('pdfjs-dist')
const reactPdfDir = packageDir('react-pdf')

const assets = [
    {
        from: path.join(pdfjsDir, 'build/pdf.worker.min.mjs'),
        to: path.join(DEST, 'pdf.worker.min.mjs'),
    },
    {
        from: path.join(reactPdfDir, 'dist/Page/TextLayer.css'),
        to: path.join(DEST, 'react-pdf-text-layer.css'),
    },
    {
        from: path.join(reactPdfDir, 'dist/Page/AnnotationLayer.css'),
        to: path.join(DEST, 'react-pdf-annotation-layer.css'),
    },
]

fs.mkdirSync(DEST, { recursive: true })
for (const { from, to } of assets) {
    if (!fs.existsSync(from)) {
        throw new Error(`copy-pdfjs-assets: source missing: ${from}`)
    }
    fs.copyFileSync(from, to)
}
