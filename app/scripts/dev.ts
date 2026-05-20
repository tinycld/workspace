// Dev launcher: spawns the Go PB server + Expo, and runs an HTTP proxy on
// the user-facing port that routes /api and /_ to PB and everything else to
// Expo.
//
// SSL: enabled by default if assets/localhost*.pem are present, disabled
// if absent. Override with --ssl (force on, errors if certs missing) or
// --no-ssl (force off). The proxy listens with TLS when enabled.
//
// Defaults: proxy 7100, PB 7101, Expo 7102. If any port in the block is
// taken we shift the whole block by +10 and re-probe so they stay grouped.
// Override with --port <n> to pin the user-facing port (PB = n+1, Expo =
// n+2); fail fast instead of probing alternatives. --pb-data-dir <path>
// points PB at a non-default data directory (used by the Playwright test
// mode to share state with the seed scripts).
//
// On web, the app always resolves PB at window.location.origin, so the
// dev proxy at the user-facing port handles /api and /_ same-origin. No
// EXPO_PUBLIC_ENV plumbing or build-time URL injection — everything works
// off the page's own origin.

import { type ChildProcess, spawn, spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as http from 'node:http'
import * as https from 'node:https'
import * as net from 'node:net'
import * as path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const CERT_PATH = path.join(ROOT, 'assets', 'localhost.pem')
const KEY_PATH = path.join(ROOT, 'assets', 'localhost-key.pem')

const DEFAULT_PROXY_PORT = 7100
const BLOCK_SHIFT = 10
const MAX_BLOCK_ATTEMPTS = 5

// Pull a flag value (`--name value`) out of process.argv. Returns null if
// the flag isn't present; throws if it's the last token (no value follows).
function flagValue(name: string): string | null {
    const i = process.argv.indexOf(name)
    if (i === -1) return null
    const v = process.argv[i + 1]
    if (v === undefined || v.startsWith('-')) {
        throw new Error(`dev: flag ${name} requires a value`)
    }
    return v
}

function resolveExplicitPort(): number | null {
    const raw = flagValue('--port')
    if (raw === null) return null
    const n = Number.parseInt(raw, 10)
    if (!Number.isFinite(n) || n <= 0 || n > 65_533) {
        throw new Error(`dev: --port must be a port number (got ${raw})`)
    }
    return n
}

function resolvePbDataDir(): string | null {
    const raw = flagValue('--pb-data-dir')
    if (raw === null) return null
    return path.isAbsolute(raw) ? raw : path.join(ROOT, raw)
}

// SSL is on when both cert files exist, unless explicitly disabled with
// --no-ssl. --ssl forces it on (and fails if certs are missing).
function resolveUseSsl(): boolean {
    if (process.argv.includes('--no-ssl')) return false
    if (process.argv.includes('--ssl')) {
        if (!fs.existsSync(CERT_PATH) || !fs.existsSync(KEY_PATH)) {
            throw new Error(`--ssl requires ${CERT_PATH} and ${KEY_PATH}; generate with mkcert`)
        }
        return true
    }
    return fs.existsSync(CERT_PATH) && fs.existsSync(KEY_PATH)
}

// --no-expo skips spawning Expo so the dev script runs only PB + proxy.
// Use this to launch Expo yourself in a separate terminal (`npx expo
// start --port <expo>`) when you need Expo's interactive shortcuts
// (`i`, `j`, `r`) or its full log stream — both get muted when Expo is
// spawned with piped stdio because the Expo CLI flips to a quieter
// non-TTY mode. PB and proxy stay on their usual ports; the proxy
// returns 503 for any request targeted at Expo until you start one
// yourself, so the app keeps working as soon as you do.
const skipExpo = process.argv.includes('--no-expo')

const useSsl = resolveUseSsl()

interface PortBlock {
    proxy: number
    pb: number
    expo: number
}

async function probePort(port: number): Promise<boolean> {
    return new Promise(resolve => {
        const server = net.createServer()
        server.once('error', () => resolve(false))
        server.once('listening', () => {
            server.close(() => resolve(true))
        })
        server.listen(port, '127.0.0.1')
    })
}

async function tryConnect(port: number, host = '127.0.0.1'): Promise<boolean> {
    return new Promise(resolve => {
        const sock = net.connect({ port, host })
        const done = (ok: boolean) => {
            sock.removeAllListeners()
            sock.destroy()
            resolve(ok)
        }
        sock.once('connect', () => done(true))
        sock.once('error', () => done(false))
    })
}

async function waitForUpstream(port: number, label: string, timeoutMs: number): Promise<void> {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
        if (await tryConnect(port)) return
        await new Promise(r => setTimeout(r, 200))
    }
    throw new Error(`dev: ${label} on :${port} did not accept connections within ${timeoutMs}ms`)
}

async function isBlockFree(block: PortBlock): Promise<boolean> {
    const results = await Promise.all([
        probePort(block.proxy),
        probePort(block.pb),
        probePort(block.expo),
    ])
    return results.every(Boolean)
}

function blockAt(i: number): PortBlock {
    const base = DEFAULT_PROXY_PORT + i * BLOCK_SHIFT
    return { proxy: base, pb: base + 1, expo: base + 2 }
}

interface PortHolder {
    pid: number
    command: string
}

function findPortHolder(port: number): PortHolder | null {
    // lsof on macOS: -t prints just PIDs, -nP skips DNS/port-name lookups,
    // -sTCP:LISTEN restricts to the listening socket so we don't catch
    // ephemeral clients.
    const lsof = spawnSync('lsof', ['-t', '-nP', `-iTCP:${port}`, '-sTCP:LISTEN'], {
        encoding: 'utf8',
    })
    const pid = Number.parseInt(lsof.stdout.trim().split('\n')[0] ?? '', 10)
    if (!Number.isFinite(pid) || pid <= 0) return null
    const ps = spawnSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' })
    return { pid, command: ps.stdout.trim() || '<unknown>' }
}

function prompt(question: string): Promise<string> {
    process.stdout.write(question)
    return new Promise(resolve => {
        const onData = (chunk: Buffer) => {
            process.stdin.removeListener('data', onData)
            process.stdin.pause()
            resolve(chunk.toString('utf8').trim())
        }
        process.stdin.resume()
        process.stdin.once('data', onData)
    })
}

async function waitForPortFree(port: number, timeoutMs = 5_000): Promise<boolean> {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
        if (await probePort(port)) return true
        await new Promise(r => setTimeout(r, 100))
    }
    return false
}

async function findFreeBlock(startIndex: number): Promise<PortBlock | null> {
    for (let i = startIndex; i < MAX_BLOCK_ATTEMPTS; i++) {
        const candidate = blockAt(i)
        if (await isBlockFree(candidate)) return candidate
    }
    return null
}

async function pickBlock(): Promise<PortBlock> {
    const explicit = resolveExplicitPort()
    if (explicit !== null) {
        const block: PortBlock = { proxy: explicit, pb: explicit + 1, expo: explicit + 2 }
        if (await isBlockFree(block)) return block
        // Don't fall back when the user pinned a port — they almost certainly
        // want to know that it's busy. List the holders so the failure is
        // actionable.
        const holders = [block.proxy, block.pb, block.expo]
            .map(p => ({ port: p, holder: findPortHolder(p) }))
            .filter(h => h.holder !== null)
        const detail = holders
            .map(h => `:${h.port} pid ${h.holder?.pid} (${h.holder?.command})`)
            .join(', ')
        throw new Error(
            `dev: --port ${explicit} block (${block.proxy}/${block.pb}/${block.expo}) is in use${detail ? ` — ${detail}` : ''}`
        )
    }

    const preferred = blockAt(0)
    if (await isBlockFree(preferred)) return preferred

    // Default block taken — show the user who's holding it and what to do.
    const holder = findPortHolder(preferred.proxy)
    process.stdout.write(`\ndev: port ${preferred.proxy} is in use`)
    if (holder) {
        process.stdout.write(` by pid ${holder.pid} (${holder.command})`)
    }
    process.stdout.write('\n')

    const interactive = process.stdin.isTTY === true
    if (!interactive) {
        const fallback = await findFreeBlock(1)
        if (!fallback) {
            throw new Error(
                `dev: no free port block in range ${DEFAULT_PROXY_PORT}..${DEFAULT_PROXY_PORT + MAX_BLOCK_ATTEMPTS * BLOCK_SHIFT}`
            )
        }
        process.stdout.write(`dev: non-interactive shell, falling back to :${fallback.proxy}\n`)
        return fallback
    }

    const fallback = await findFreeBlock(1)
    const fallbackHint = fallback ? `:${fallback.proxy}` : 'none free'
    const canKill = holder !== null
    const choices = canKill ? '[k]ill, [u]se alternative, [q]uit' : '[u]se alternative, [q]uit'
    const answer = (
        await prompt(`Choose: ${choices} (alternative=${fallbackHint}): `)
    ).toLowerCase()

    if (answer === 'q' || answer === 'quit') {
        throw new Error('dev: aborted by user')
    }
    if (answer === 'k' || answer === 'kill') {
        if (!canKill) throw new Error('dev: no holder to kill (lsof returned nothing)')
        process.stdout.write(`dev: killing pid ${holder.pid}\n`)
        try {
            process.kill(holder.pid, 'SIGTERM')
        } catch (err) {
            throw new Error(
                `dev: failed to signal pid ${holder.pid}: ${err instanceof Error ? err.message : String(err)}`
            )
        }
        if (!(await waitForPortFree(preferred.proxy))) {
            // Escalate to SIGKILL if SIGTERM didn't free the port in time.
            process.stdout.write(
                `dev: pid ${holder.pid} still holding :${preferred.proxy}, sending SIGKILL\n`
            )
            try {
                process.kill(holder.pid, 'SIGKILL')
            } catch {
                // process may already be gone
            }
            if (!(await waitForPortFree(preferred.proxy))) {
                throw new Error(`dev: port ${preferred.proxy} still in use after SIGKILL`)
            }
        }
        if (await isBlockFree(preferred)) return preferred
        // Killing the proxy holder freed :proxy but :pb or :expo is still
        // taken — fall through to alternative.
        process.stdout.write(
            `dev: port ${preferred.proxy} freed, but the rest of the block isn't — using alternative\n`
        )
    }
    // Default branch (including 'u'/'use'/empty input): alternative block.
    if (!fallback) {
        throw new Error(
            `dev: no free port block in range ${DEFAULT_PROXY_PORT}..${DEFAULT_PROXY_PORT + MAX_BLOCK_ATTEMPTS * BLOCK_SHIFT}`
        )
    }
    return fallback
}

function withPrefix(prefix: string, color: string) {
    return (chunk: Buffer | string) => {
        const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8')
        for (const line of text.split('\n')) {
            if (line.length === 0) continue
            process.stdout.write(`${color}[${prefix}]\x1b[0m ${line}\n`)
        }
    }
}

function buildPbSync() {
    const buildResult = spawn('go', ['build', '-o', 'app', '.'], {
        cwd: path.join(ROOT, 'server'),
        stdio: 'inherit',
    })
    return new Promise<void>((resolve, reject) => {
        buildResult.on('exit', code => {
            if (code === 0) resolve()
            else reject(new Error(`go build exited with code ${code}`))
        })
        buildResult.on('error', reject)
    })
}

function spawnPbBinary(pbPort: number, publicUrl: string, dataDir: string | null): ChildProcess {
    const onPbOut = withPrefix('pb', '\x1b[36m') // cyan
    const onPbErr = withPrefix('pb', '\x1b[31m') // red
    const args = ['--dev', '--http', `127.0.0.1:${pbPort}`]
    if (dataDir) args.push('--dir', dataDir)
    args.push('--typesDir', path.join(ROOT, '..', 'core', 'types'), 'serve')
    const child = spawn(path.join(ROOT, 'server', 'app'), args, {
        cwd: ROOT,
        stdio: ['inherit', 'pipe', 'pipe'],
        // PB's first-run installer prints a /setup URL using the address
        // it bound to. Override with the public proxy URL so the printed
        // URL points where the user actually browses, not at PB's
        // internal port.
        env: { ...process.env, TINYCLD_PUBLIC_URL: publicUrl },
    })
    child.stdout?.on('data', onPbOut)
    child.stderr?.on('data', onPbErr)
    return child
}

function spawnExpo(expoPort: number, onReady: () => void): ChildProcess {
    const onOut = withPrefix('expo', '\x1b[35m') // magenta
    const onErr = withPrefix('expo', '\x1b[31m')
    // CI=1 forces Expo's non-interactive log stream (no curses-style TUI)
    // so its bundle/error messages land on stdout. Without it, Expo CLI
    // detects the non-TTY child stdio and falls back to a quiet mode that
    // suppresses everything except its initial banner — even errors stay
    // hidden, which makes debugging native bundler crashes impossible.
    const child = spawn('npx', ['expo', 'start', '--clear', '--port', String(expoPort)], {
        cwd: ROOT,
        stdio: ['inherit', 'pipe', 'pipe'],
        env: { ...process.env, CI: '1' },
    })
    // Expo prints "Logs for your project will appear …" once the dev server
    // is fully up. We use that as the signal to print the banner so it lands
    // at the bottom of the noisy startup output instead of being buried.
    let readyFired = false
    const watchForReady = (chunk: Buffer | string) => {
        const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8')
        if (!readyFired && text.includes('Logs for your project will appear')) {
            readyFired = true
            onReady()
        }
    }
    child.stdout?.on('data', chunk => {
        watchForReady(chunk)
        onOut(chunk)
    })
    child.stderr?.on('data', onErr)
    return child
}

// Path segments that belong to PocketBase, not Expo. Each entry matches
// the segment exactly or as a path prefix (i.e. followed by '/'), so
// '/api' catches '/api' and '/api/foo' but not '/apiv2'. Mirrors the
// Go-side list in coreserver/server.go::isDavPath plus PB's own /api and
// /_ surfaces so the same set bypasses Expo when tests hit them via the
// proxy.
//   /api                  REST + SSE realtime + custom routes
//   /_                    admin UI
//   /caldav               calendar package's CalDAV handler
//   /carddav              contacts package's CardDAV handler
//   /drive                drive package's WebDAV handler (the in-app
//                         /a/.../drive routes are caught by /a, which
//                         Expo owns)
//   /.well-known/caldav   service discovery (302s)
//   /.well-known/carddav
//   /.well-known/webdav
const PB_PREFIXES = [
    '/api',
    '/_',
    '/caldav',
    '/carddav',
    '/drive',
    '/.well-known/caldav',
    '/.well-known/carddav',
    '/.well-known/webdav',
]

function isPbPath(url: string): boolean {
    return PB_PREFIXES.some(prefix => url === prefix || url.startsWith(`${prefix}/`))
}

function startProxy(opts: { proxyPort: number; pbPort: number; expoPort: number; ssl: boolean }) {
    const log = withPrefix('proxy', '\x1b[33m') // yellow

    const handler: http.RequestListener = (req, res) => {
        const target = isPbPath(req.url ?? '/') ? opts.pbPort : opts.expoPort

        // Browsers and Playwright cancel in-flight requests aggressively.
        // Once the client socket goes away, any further write to req/res
        // surfaces as EPIPE/ECONNRESET on the underlying socket — and a bare
        // 'error' event on a Socket crashes Node. Attach handlers to swallow
        // those instead of taking the proxy down.
        req.on('error', err => log(`client req error: ${err.message}\n`))
        res.on('error', err => log(`client res error: ${err.message}\n`))

        const upstream = http.request(
            {
                host: '127.0.0.1',
                port: target,
                method: req.method,
                path: req.url,
                headers: { ...req.headers, host: `127.0.0.1:${target}` },
            },
            upstreamRes => {
                upstreamRes.on('error', err =>
                    log(`upstream res :${target} error: ${err.message}\n`)
                )
                if (!res.writableEnded)
                    res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers)
                upstreamRes.pipe(res)
            }
        )
        upstream.on('error', err => {
            log(`upstream :${target} error: ${err.message}\n`)
            if (!res.headersSent && !res.writableEnded) res.writeHead(502)
            if (!res.writableEnded) res.end('Bad Gateway')
        })
        // If the client disconnects mid-flight, abort the upstream so we
        // don't pile up half-open sockets to PB/Expo.
        res.on('close', () => upstream.destroy())
        req.pipe(upstream)
    }

    // WebSocket upgrades — Expo dev server uses WS for HMR. PB doesn't use WS
    // (its realtime is SSE, plain HTTP), but route by path anyway.
    const onUpgrade = (req: http.IncomingMessage, clientSocket: NodeJS.Socket, head: Buffer) => {
        const target = isPbPath(req.url ?? '/') ? opts.pbPort : opts.expoPort
        // Same EPIPE-class crash protection on the upgrade path.
        clientSocket.on('error', err => log(`client ws error: ${err.message}\n`))
        const upstreamSocket = net.connect(target, '127.0.0.1', () => {
            const headerLines = [
                `${req.method} ${req.url} HTTP/${req.httpVersion}`,
                ...Object.entries(req.headers).map(
                    ([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`
                ),
                '',
                '',
            ]
            upstreamSocket.write(headerLines.join('\r\n'))
            if (head.length > 0) upstreamSocket.write(head)
            upstreamSocket.pipe(clientSocket as unknown as NodeJS.WritableStream)
            ;(clientSocket as unknown as NodeJS.ReadableStream).pipe(upstreamSocket)
        })
        upstreamSocket.on('error', err => {
            log(`upgrade upstream :${target} error: ${err.message}\n`)
            ;(clientSocket as unknown as { destroy: () => void }).destroy()
        })
    }

    let server: http.Server | https.Server
    if (opts.ssl) {
        server = https.createServer(
            { cert: fs.readFileSync(CERT_PATH), key: fs.readFileSync(KEY_PATH) },
            handler
        )
    } else {
        server = http.createServer(handler)
    }
    server.on('upgrade', onUpgrade)
    server.listen(opts.proxyPort, '127.0.0.1')
    return server
}

function printBanner(block: PortBlock, ssl: boolean, suffix?: string) {
    const scheme = ssl ? 'https' : 'http'
    const lines = [
        '',
        `\x1b[1m  TinyCld dev\x1b[0m`,
        `  Open: \x1b[32m${scheme}://localhost:${block.proxy}\x1b[0m`,
        `  PB:    127.0.0.1:${block.pb} (proxied at /api, /_)`,
        `  Expo:  127.0.0.1:${block.expo}`,
    ]
    if (suffix) lines.push(`  \x1b[33m${suffix}\x1b[0m`)
    lines.push('')
    process.stdout.write(`${lines.join('\n')}\n`)
}

// Belt-and-suspenders: if any socket-class error escapes handler-level
// catch blocks, log and continue rather than letting Node tear down the
// whole proxy. EPIPE / ECONNRESET / ECONNABORTED happen routinely when a
// client (browser, Playwright) cancels a request mid-flight; they're
// transient by definition and there's nothing for us to do about them.
const TRANSIENT_SOCKET_ERRORS = new Set(['EPIPE', 'ECONNRESET', 'ECONNABORTED'])
process.on('uncaughtException', err => {
    const code = (err as NodeJS.ErrnoException).code
    if (code && TRANSIENT_SOCKET_ERRORS.has(code)) {
        process.stdout.write(`\x1b[33m[proxy]\x1b[0m transient socket ${code}, ignoring\n`)
        return
    }
    process.stderr.write(`uncaughtException: ${err.stack ?? String(err)}\n`)
    process.exit(1)
})

async function main() {
    const block = await pickBlock()

    // Run packages:generate before launching, mirroring the old `predev`
    // hook. Failing this should fail-fast so the user sees the error.
    // packages:generate also runs each linked package's one-shot build
    // script (e.g. text's webview-editor bundle), so the artifacts are
    // already on disk by the time Expo starts bundling.
    const gen = spawn('npx', ['tsx', 'scripts/generate.ts'], {
        cwd: ROOT,
        stdio: 'inherit',
    })
    await new Promise<void>((resolve, reject) => {
        gen.on('exit', code =>
            code === 0 ? resolve() : reject(new Error(`packages:generate exited ${code}`))
        )
        gen.on('error', reject)
    })

    await buildPbSync()

    // Defer the banner until Expo signals ready (or a 60s fallback fires)
    // so it doesn't get buried under bundling/migration logs.
    let bannerPrinted = false
    const printOnce = (suffix?: string) => {
        if (bannerPrinted) return
        bannerPrinted = true
        printBanner(block, useSsl, suffix)
    }

    const publicUrl = `${useSsl ? 'https' : 'http'}://localhost:${block.proxy}`
    const pbDataDir = resolvePbDataDir()
    const pb = spawnPbBinary(block.pb, publicUrl, pbDataDir)
    // With --no-expo we never spawn the Expo child; the user runs it in
    // a separate terminal so they get its TTY-bound logs + shortcuts.
    // The proxy still routes non-PB paths to block.expo, so once their
    // standalone `npx expo start --port <block.expo>` is up, everything
    // works exactly as if dev.ts had spawned Expo itself.
    const expo = skipExpo ? null : spawnExpo(block.expo, () => printOnce())

    // Wait for both upstreams to accept TCP connections before binding the
    // user-facing proxy. Otherwise the browser hits the proxy first, the
    // proxy forwards to a port that's not listening yet, and the user sees
    // 502s + ECONNREFUSED noise during cold start. A few seconds of
    // "connection refused" on :proxy is fine — browsers retry, and the
    // banner only prints once Expo signals ready anyway.
    // PB starts in seconds (no bundling). Expo can take 2-3 minutes on a
    // cold --clear start while it bundles the entire dependency graph, so
    // give it a longer rope.
    const upstreamWaits: Promise<void>[] = [waitForUpstream(block.pb, 'pb', 30_000)]
    if (!skipExpo) {
        upstreamWaits.push(waitForUpstream(block.expo, 'expo', 180_000))
    }
    await Promise.all(upstreamWaits)

    const server = startProxy({
        proxyPort: block.proxy,
        pbPort: block.pb,
        expoPort: block.expo,
        ssl: useSsl,
    })

    if (skipExpo) {
        // No Expo child means no 'ready' signal to gate the banner on —
        // print immediately so the user sees the proxy URL and knows to
        // start Expo themselves in another terminal.
        printOnce(`(--no-expo: run \`npx expo start --port ${block.expo}\` in another terminal)`)
    } else {
        const fallbackTimer: NodeJS.Timeout = setTimeout(() => {
            printOnce('(still bundling — open the URL once Expo is ready)')
        }, 60_000) as unknown as NodeJS.Timeout
        fallbackTimer.unref()
    }

    let shuttingDown = false
    const shutdown = (signal: NodeJS.Signals) => {
        if (shuttingDown) return
        shuttingDown = true
        process.stdout.write(`\nshutting down (${signal})\n`)
        server.close()
        pb.kill('SIGTERM')
        expo?.kill('SIGTERM')
        // give children a moment, then exit
        ;(
            setTimeout(() => {
                process.exit(0)
            }, 500) as unknown as NodeJS.Timeout
        ).unref()
    }

    process.on('SIGINT', shutdown)
    process.on('SIGTERM', shutdown)

    // If either child dies on its own, tear down the others. With
    // --no-expo we don't own the Expo process, so its lifetime is the
    // user's concern — we only watch pb here.
    pb.on('exit', code => {
        process.stdout.write(`pb exited (${code}); shutting down\n`)
        shutdown('SIGTERM')
    })
    expo?.on('exit', code => {
        process.stdout.write(`expo exited (${code}); shutting down\n`)
        shutdown('SIGTERM')
    })
}

void main().catch(err => {
    process.stderr.write(`dev: ${err instanceof Error ? err.stack : String(err)}\n`)
    process.exit(1)
})
