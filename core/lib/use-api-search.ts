import { pb } from '@tinycld/core/lib/pocketbase'
import { useCallback, useEffect, useRef, useState } from 'react'

interface UseApiSearchOptions<TResult> {
    endpoint: string
    buildQueryParams?: (query: string) => Record<string, string>
    extractResults: (response: unknown) => TResult[]
    extractTotal?: (response: unknown) => number
    minQueryLength?: number
    debounceMs?: number
}

interface UseApiSearchReturn<TResult> {
    results: TResult[]
    total: number
    isSearching: boolean
    error: string | null
}

function isAbortError(err: unknown): boolean {
    return err instanceof DOMException && err.name === 'AbortError'
}

function toErrorMessage(err: unknown): string {
    return err instanceof Error ? err.message : 'Search failed'
}

export function useApiSearch<TResult>(
    query: string,
    options: UseApiSearchOptions<TResult>
): UseApiSearchReturn<TResult> {
    const {
        endpoint,
        buildQueryParams,
        extractResults,
        extractTotal,
        minQueryLength = 2,
        debounceMs = 300,
    } = options

    const [results, setResults] = useState<TResult[]>([])
    const [total, setTotal] = useState(0)
    const [isSearching, setIsSearching] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const abortRef = useRef<AbortController | null>(null)

    const search = useCallback(
        async (q: string) => {
            abortRef.current?.abort()
            const controller = new AbortController()
            abortRef.current = controller

            setIsSearching(true)
            setError(null)

            try {
                const queryParams = buildQueryParams ? buildQueryParams(q) : { q }
                const response: unknown = await pb.send(endpoint, {
                    method: 'GET',
                    query: queryParams,
                    signal: controller.signal,
                })
                if (controller.signal.aborted) return
                setResults(extractResults(response))
                setTotal(extractTotal ? extractTotal(response) : 0)
            } catch (err: unknown) {
                if (isAbortError(err) || controller.signal.aborted) return
                setError(toErrorMessage(err))
                setResults([])
                setTotal(0)
            } finally {
                if (!controller.signal.aborted) {
                    setIsSearching(false)
                }
            }
        },
        [endpoint, buildQueryParams, extractResults, extractTotal]
    )

    useEffect(() => {
        if (timerRef.current) clearTimeout(timerRef.current)

        if (query.length < minQueryLength) {
            setResults([])
            setTotal(0)
            setIsSearching(false)
            setError(null)
            abortRef.current?.abort()
            return
        }

        timerRef.current = setTimeout(() => search(query), debounceMs)

        return () => {
            if (timerRef.current) clearTimeout(timerRef.current)
        }
    }, [query, search, minQueryLength, debounceMs])

    useEffect(() => {
        return () => {
            abortRef.current?.abort()
        }
    }, [])

    return { results, total, isSearching, error }
}
