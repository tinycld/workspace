import { useApiSearch } from '@tinycld/core/lib/use-api-search'
import { useMemo } from 'react'

export interface DriveSearchResult {
    id: string
    name: string
    is_folder: boolean
    mime_type: string
    size: number
    description: string
    highlight: string
}

interface DriveSearchResponse {
    items: DriveSearchResult[]
    total: number
}

const extractResults = (response: unknown) => (response as DriveSearchResponse).items
const extractTotal = (response: unknown) => (response as DriveSearchResponse).total

export function useDriveSearch(query: string, orgId: string) {
    const buildQueryParams = useMemo(() => (q: string) => ({ q, org: orgId }), [orgId])

    const options = useMemo(
        () => ({
            endpoint: '/api/drive/search',
            buildQueryParams,
            extractResults,
            extractTotal,
        }),
        [buildQueryParams]
    )

    return useApiSearch<DriveSearchResult>(query, options)
}
