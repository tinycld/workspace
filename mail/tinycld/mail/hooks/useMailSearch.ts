import { pb } from '@tinycld/core/lib/pocketbase'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { AdvancedSearchFilters } from './useSearchState'
import { hasActiveFilters } from './useSearchState'

export interface MailSearchResult {
    thread_id: string
    subject: string
    subject_highlight: string
    snippet_highlight: string
    latest_date: string
    participants: string
    message_count: number
    mailbox_id: string
    has_attachments: boolean
}

interface MailSearchResponse {
    items: MailSearchResult[]
    total: number
}

interface UseMailSearchReturn {
    results: MailSearchResult[]
    total: number
    isSearching: boolean
    error: string | null
}

const DEBOUNCE_MS = 300
const MIN_QUERY_LENGTH = 2

const SIZE_MULTIPLIERS: Record<string, number> = {
    bytes: 1,
    KB: 1024,
    MB: 1024 * 1024,
}

const SIMPLE_FILTER_MAP: [keyof AdvancedSearchFilters, string][] = [
    ['from', 'from'],
    ['to', 'to'],
    ['subject', 'subject'],
    ['hasWords', 'has_words'],
    ['doesntHave', 'not_words'],
]

function addSizeParams(filters: AdvancedSearchFilters, params: Record<string, string>) {
    if (!filters.sizeValue || !filters.sizeOp) return
    const numericSize = Number.parseFloat(filters.sizeValue)
    if (numericSize <= 0) return
    const unit = filters.sizeUnit ?? 'bytes'
    params.size_op = filters.sizeOp === 'greater_than' ? 'gt' : 'lt'
    params.size_bytes = String(Math.round(numericSize * (SIZE_MULTIPLIERS[unit] ?? 1)))
}

function addDateParams(filters: AdvancedSearchFilters, params: Record<string, string>) {
    if (!filters.dateWithin || !filters.dateAnchor) return
    const anchor = new Date(filters.dateAnchor)
    if (Number.isNaN(anchor.getTime())) return
    const ms = parseDuration(filters.dateWithin)
    if (ms <= 0) return
    params.date_after = new Date(anchor.getTime() - ms).toISOString()
    params.date_before = new Date(anchor.getTime() + ms).toISOString()
}

function filtersToQueryParams(filters: AdvancedSearchFilters): Record<string, string> {
    const params: Record<string, string> = {}
    for (const [filterKey, paramKey] of SIMPLE_FILTER_MAP) {
        const val = filters[filterKey]
        if (val && typeof val === 'string') params[paramKey] = val
    }
    addSizeParams(filters, params)
    addDateParams(filters, params)
    if (filters.folder && filters.folder !== 'all') params.folder = filters.folder
    if (filters.hasAttachment) params.has_attachment = 'true'
    return params
}

function parseDuration(value: string): number {
    const DAY = 86400000
    switch (value) {
        case '1d':
            return DAY
        case '3d':
            return 3 * DAY
        case '1w':
            return 7 * DAY
        case '2w':
            return 14 * DAY
        case '1m':
            return 30 * DAY
        case '2m':
            return 60 * DAY
        case '6m':
            return 180 * DAY
        case '1y':
            return 365 * DAY
        default:
            return 0
    }
}

export function useMailSearch(query: string, filters: AdvancedSearchFilters = {}): UseMailSearchReturn {
    const [results, setResults] = useState<MailSearchResult[]>([])
    const [total, setTotal] = useState(0)
    const [isSearching, setIsSearching] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const abortRef = useRef<AbortController | null>(null)

    const search = useCallback(async (q: string, f: AdvancedSearchFilters) => {
        abortRef.current?.abort()
        const controller = new AbortController()
        abortRef.current = controller

        setIsSearching(true)
        setError(null)

        try {
            const queryParams: Record<string, string> = {
                ...filtersToQueryParams(f),
            }
            if (q.length >= MIN_QUERY_LENGTH) {
                queryParams.q = q
            }

            const response: MailSearchResponse = await pb.send('/api/mail/search', {
                method: 'GET',
                query: queryParams,
                signal: controller.signal,
            })
            if (!controller.signal.aborted) {
                setResults(response.items)
                setTotal(response.total)
            }
        } catch (err: unknown) {
            if (err instanceof DOMException && err.name === 'AbortError') return
            if (!controller.signal.aborted) {
                setError(err instanceof Error ? err.message : 'Search failed')
                setResults([])
                setTotal(0)
            }
        } finally {
            if (!controller.signal.aborted) {
                setIsSearching(false)
            }
        }
    }, [])

    const filtersJSON = JSON.stringify(filters)

    useEffect(() => {
        if (timerRef.current) clearTimeout(timerRef.current)

        const parsedFilters: AdvancedSearchFilters = JSON.parse(filtersJSON)
        const hasFilters = hasActiveFilters(parsedFilters)

        if (query.length < MIN_QUERY_LENGTH && !hasFilters) {
            setResults([])
            setTotal(0)
            setIsSearching(false)
            setError(null)
            abortRef.current?.abort()
            return
        }

        timerRef.current = setTimeout(() => search(query, parsedFilters), DEBOUNCE_MS)

        return () => {
            if (timerRef.current) clearTimeout(timerRef.current)
        }
    }, [query, filtersJSON, search])

    useEffect(() => {
        return () => {
            abortRef.current?.abort()
        }
    }, [])

    return { results, total, isSearching, error }
}
