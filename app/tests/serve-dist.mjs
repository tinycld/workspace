// Tiny static server for the exported web build (app/dist). Stands in for the
// real expo:test/dev.ts stack in this spike — enough to validate that a
// package-scoped Playwright run can hand off to an app-shell-owned webServer.
import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize } from 'node:path'

const DIST = join(import.meta.dirname, '..', 'dist')
const PORT = Number(process.env.SPIKE_E2E_PORT ?? 7300)

const MIME = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
}

createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0])
    let filePath = join(DIST, normalize(urlPath))
    if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
        filePath = join(DIST, 'index.html') // SPA fallback
    }
    res.writeHead(200, { 'content-type': MIME[extname(filePath)] ?? 'application/octet-stream' })
    createReadStream(filePath).pipe(res)
}).listen(PORT, () => console.log(`serve-dist on http://localhost:${PORT}`))
