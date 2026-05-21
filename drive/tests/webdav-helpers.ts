import { TEST_USER_EMAIL, TEST_USER_PASSWORD } from '../../../../tests/e2e/helpers'

// PB owns /drive (WebDAV handler); dev.ts's proxy fans /drive to PB,
// so we can hit the public proxy port instead of PB directly.
const WEBDAV_BASE = 'http://127.0.0.1:7200/drive'

export interface WebDAVResponse {
    href: string
    displayname?: string
    isCollection: boolean
    contentLength?: number
}

function authHeader(user = TEST_USER_EMAIL, pass = TEST_USER_PASSWORD): string {
    return `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`
}

interface FetchOpts {
    body?: string | Buffer
    contentType?: string
    depth?: string
    destination?: string
    auth?: string
}

export async function webdavFetch(
    method: string,
    path: string,
    init: FetchOpts = {}
): Promise<Response> {
    const headers: Record<string, string> = {
        Authorization: init.auth ?? authHeader(),
    }
    if (init.depth !== undefined) headers.Depth = init.depth
    if (init.contentType) headers['Content-Type'] = init.contentType
    if (init.destination) headers.Destination = init.destination

    return fetch(`${WEBDAV_BASE}${path}`, {
        method,
        headers,
        body: init.body,
    })
}

const PROPFIND_BODY = `<?xml version="1.0" encoding="utf-8" ?>
<propfind xmlns="DAV:">
    <prop>
        <displayname/>
        <resourcetype/>
        <getcontentlength/>
    </prop>
</propfind>`

// Lightweight multistatus parser modeled on caldav-helpers.ts. The go-webdav
// response is shallow enough that regex over <response> blocks is sufficient.
function parseMultistatusResponses(xml: string): WebDAVResponse[] {
    const responses: WebDAVResponse[] = []
    const responseRe = /<(?:\w+:)?response\b[^>]*>([\s\S]*?)<\/(?:\w+:)?response>/g
    for (const m of xml.matchAll(responseRe)) {
        const block = m[1]
        const hrefMatch = /<(?:\w+:)?href\b[^>]*>([\s\S]*?)<\/(?:\w+:)?href>/.exec(block)
        if (!hrefMatch) continue
        const href = decodeURIComponent(hrefMatch[1].trim())
        const dnMatch = /<(?:\w+:)?displayname\b[^>]*>([\s\S]*?)<\/(?:\w+:)?displayname>/.exec(
            block
        )
        const isCollection = /<(?:\w+:)?collection\b[^>]*\/?>/i.test(block)
        const lenMatch =
            /<(?:\w+:)?getcontentlength\b[^>]*>([\s\S]*?)<\/(?:\w+:)?getcontentlength>/.exec(block)
        responses.push({
            href,
            displayname: dnMatch?.[1].trim(),
            isCollection,
            contentLength: lenMatch ? Number.parseInt(lenMatch[1].trim(), 10) : undefined,
        })
    }
    return responses
}

// propfind issues a Depth: 1 PROPFIND against a collection and returns the
// parsed children. The collection itself is included in the response set per
// WebDAV convention; callers filter as needed.
export async function propfind(path: string, depth = '1'): Promise<WebDAVResponse[]> {
    const res = await webdavFetch('PROPFIND', path, {
        depth,
        contentType: 'application/xml; charset=utf-8',
        body: PROPFIND_BODY,
    })
    if (res.status !== 207) {
        throw new Error(`PROPFIND ${path} expected 207, got ${res.status}: ${await res.text()}`)
    }
    return parseMultistatusResponses(await res.text())
}

export async function putFile(
    path: string,
    body: string | Buffer,
    contentType = 'application/octet-stream'
): Promise<Response> {
    const res = await webdavFetch('PUT', path, { body, contentType })
    if (res.status !== 201 && res.status !== 204) {
        throw new Error(`PUT ${path} expected 201 or 204, got ${res.status}: ${await res.text()}`)
    }
    return res
}

export async function mkcol(path: string): Promise<Response> {
    const res = await webdavFetch('MKCOL', path)
    if (res.status !== 201) {
        throw new Error(`MKCOL ${path} expected 201, got ${res.status}: ${await res.text()}`)
    }
    return res
}

export async function deleteResource(path: string): Promise<number> {
    const res = await webdavFetch('DELETE', path)
    // Tolerate 404 so afterEach cleanup is idempotent.
    if (res.status !== 204 && res.status !== 200 && res.status !== 404) {
        throw new Error(`DELETE ${path} expected 200/204/404, got ${res.status}`)
    }
    return res.status
}

// rawWebdavRequest issues a request without any of the helpers' status
// guards. Used to assert error paths (401, 404).
export async function rawWebdavRequest(
    method: string,
    path: string,
    auth?: string
): Promise<number> {
    const res = await fetch(`${WEBDAV_BASE.replace(/\/drive$/, '')}${path}`, {
        method,
        headers: auth ? { Authorization: auth } : { Authorization: authHeader() },
    })
    return res.status
}

// nameFromHref pulls the last path segment from a WebDAV href, decoding
// percent-escapes. Trailing slashes (collections) are stripped so callers
// can compare names regardless of resource type.
export function nameFromHref(href: string): string {
    const trimmed = href.replace(/\/$/, '')
    const last = trimmed.split('/').pop() ?? ''
    return decodeURIComponent(last)
}
