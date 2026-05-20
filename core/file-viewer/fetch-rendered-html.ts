import { useQuery, useQueryClient } from '@tanstack/react-query'
import { pb } from '@tinycld/core/lib/pocketbase'
import { useMemo } from 'react'
import type { FilePreviewSource } from './types'

// MIME → endpoint mapping. Lives here so callers don't need to know
// which package owns which type — they just pass the source.
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

// Image-asset transport mode for the render call.
//   - 'url':   <img src> points at a drive file URL with a short-lived
//              auth token. Used by previews; the browser fetches the
//              image alongside the iframe doc with the same auth.
//   - 'embed': image bytes are inlined as data: URIs by the server.
//              Required by native print (expo-print can't fetch
//              external assets) and useful for web print reliability.
export type RenderedImageMode = 'url' | 'embed'

export interface CalcRenderOpts {
    /** Sheet ID to render (default: first sheet). */
    sheet?: string
    /** A1 range string (default: full content range). */
    range?: string
    /** Sheet selection scope ('all' or 'selection'). */
    scope?: 'all' | 'selection'
    /** Image transport mode. Default 'url'. */
    images?: RenderedImageMode
}

export interface TextRenderOpts {
    images?: RenderedImageMode
}

export type RenderOpts = CalcRenderOpts | TextRenderOpts

export interface RenderedHtml {
    /** The server-emitted content fragment (no <html>/<body>). */
    html: string
    /**
     * The server-issued ETag for the request, or undefined when the
     * server didn't emit one. Pass it back as `ifNoneMatch` to
     * revalidate cheaply.
     */
    etag?: string
}

interface DispatchedEndpoint {
    base: string
    isCalc: boolean
}

function resolveEndpoint(source: FilePreviewSource): DispatchedEndpoint {
    if (source.mimeType === DOCX_MIME) {
        return { base: `/api/text/render/${source.recordId}`, isCalc: false }
    }
    if (source.mimeType === XLSX_MIME) {
        return { base: `/api/calc/render/${source.recordId}`, isCalc: true }
    }
    throw new Error(`fetchRenderedHtml: unsupported mime type "${source.mimeType}"`)
}

function buildQueryString(endpoint: DispatchedEndpoint, opts: RenderOpts | undefined): string {
    const params = new URLSearchParams()
    if (endpoint.isCalc) {
        const calcOpts = (opts ?? {}) as CalcRenderOpts
        if (calcOpts.sheet) params.set('sheet', calcOpts.sheet)
        if (calcOpts.range) params.set('range', calcOpts.range)
        if (calcOpts.scope) params.set('scope', calcOpts.scope)
        if (calcOpts.images) params.set('images', calcOpts.images)
    } else {
        const textOpts = (opts ?? {}) as TextRenderOpts
        if (textOpts.images) params.set('images', textOpts.images)
    }
    const q = params.toString()
    return q ? `?${q}` : ''
}

export interface FetchRenderedHtmlOptions extends Partial<CalcRenderOpts> {
    /**
     * If supplied, sent as the request's `If-None-Match` header. The
     * imperative helper returns `{ html: '', etag: ifNoneMatch }` on
     * 304 — callers that want the *previous* body preserved should
     * use `useRenderedHtml`, which threads its own cached etag and
     * body through React Query rather than asking the caller to do
     * the bookkeeping.
     */
    ifNoneMatch?: string
}

// fetchRenderedHtml issues a single GET to the package-specific render
// endpoint and returns the body + ETag. Authentication uses the
// PocketBase auth token directly (same scheme as other API endpoints
// in this codebase).
//
// 304 responses return an empty body — the imperative API is
// stateless; it has no notion of the prior body to revive. Use
// useRenderedHtml when you want transparent revalidation.
export async function fetchRenderedHtml(
    source: FilePreviewSource,
    opts?: FetchRenderedHtmlOptions
): Promise<RenderedHtml> {
    const endpoint = resolveEndpoint(source)
    const query = buildQueryString(endpoint, opts)
    const url = `${pb.baseURL.replace(/\/$/, '')}${endpoint.base}${query}`

    const headers: Record<string, string> = { Accept: 'text/html' }
    if (pb.authStore.token) {
        headers.Authorization = `Bearer ${pb.authStore.token}`
    }
    if (opts?.ifNoneMatch) {
        headers['If-None-Match'] = opts.ifNoneMatch
    }

    const response = await fetch(url, { method: 'GET', headers })

    if (response.status === 304) {
        return { html: '', etag: opts?.ifNoneMatch }
    }
    if (!response.ok) {
        throw new Error(`fetchRenderedHtml: HTTP ${response.status} ${response.statusText}`)
    }
    const html = await response.text()
    const etag = response.headers.get('ETag') ?? undefined
    return { html, etag }
}

// UseRenderedHtmlOptions is the *public* hook surface. Note the
// deliberate omission of `ifNoneMatch`: revalidation is internal —
// the hook reads the prior etag from React Query's cache and threads
// it through on its own. Exposing `ifNoneMatch` here would mutate
// the query key on every render and defeat caching.
export interface UseRenderedHtmlOptions {
    /** A1 range to clip to (calc only). */
    range?: string
    /** Sheet identifier to render (calc only). */
    sheet?: string
    /** Selection scope (calc only). */
    scope?: 'all' | 'selection'
    /** Image transport mode. Default 'url'. */
    images?: RenderedImageMode
    /** When false, the query is paused (e.g. while the source resolves). */
    enabled?: boolean
}

// fetchShapingKey derives a stable string key from the subset of
// options that actually change the server response — *not* including
// React Query plumbing (`enabled`) or revalidation hints
// (`ifNoneMatch`). Hashing the fields into a single string also
// stabilizes the cache key against the inline-object pattern
// (`useRenderedHtml(source, { images: 'embed' })`) where every render
// creates a fresh `opts` object reference.
function fetchShapingKey(opts: UseRenderedHtmlOptions | undefined): string {
    if (!opts) return ''
    return [opts.sheet ?? '', opts.range ?? '', opts.scope ?? '', opts.images ?? ''].join('|')
}

// useRenderedHtml is the React Query wrapper for preview consumers.
// Cache key is `('rendered-html', recordId, fetchShapingKey)` — stable
// across re-renders and across revalidation passes. The hook reads
// the prior cached body + etag inside its queryFn, threads the etag
// as `If-None-Match`, and on 304 returns the prior body intact (not
// an empty string).
//
// Print consumers should use the imperative fetchRenderedHtml directly
// — they're one-shot from a button click and don't need the cache
// machinery.
export function useRenderedHtml(
    source: FilePreviewSource | undefined,
    opts?: UseRenderedHtmlOptions
) {
    const queryClient = useQueryClient()
    const enabled = (opts?.enabled ?? true) && !!source?.recordId
    const shapingKey = fetchShapingKey(opts)
    const queryKey = useMemo(
        () => ['rendered-html', source?.recordId, shapingKey] as const,
        [source?.recordId, shapingKey]
    )
    // Capture the shaping subset into a stable object so the queryFn
    // closure doesn't need to depend on `opts` directly (which is a
    // fresh reference on every render).
    const shapingOpts = useMemo<FetchRenderedHtmlOptions>(
        () => ({
            sheet: opts?.sheet,
            range: opts?.range,
            scope: opts?.scope,
            images: opts?.images,
        }),
        [opts?.sheet, opts?.range, opts?.scope, opts?.images]
    )
    return useQuery<RenderedHtml>({
        queryKey,
        queryFn: async () => {
            if (!source) throw new Error('useRenderedHtml: missing source')
            const prior = queryClient.getQueryData<RenderedHtml>(queryKey)
            const next = await fetchRenderedHtml(source, {
                ...shapingOpts,
                ifNoneMatch: prior?.etag,
            })
            if (prior?.etag && next.etag === prior.etag && next.html === '') {
                // 304 — fetchRenderedHtml echoed the prior etag with an
                // empty body. Restore the prior body so consumers see
                // continuous content across revalidations.
                return { html: prior.html, etag: prior.etag }
            }
            return next
        },
        enabled,
        staleTime: 60_000,
    })
}
