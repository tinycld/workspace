import { useApiSearch } from '@tinycld/core/lib/use-api-search'
import { useMemo } from 'react'

export interface ContactSearchResult {
    id: string
    first_name: string
    last_name: string
    email: string
    company: string
    phone: string
    favorite: boolean
    highlight: string
}

interface ContactSearchResponse {
    items: ContactSearchResult[]
    total: number
}

interface UseContactSearchReturn {
    results: ContactSearchResult[]
    isSearching: boolean
}

const extractResults = (response: unknown) => (response as ContactSearchResponse).items

export function useContactSearch(query: string): UseContactSearchReturn {
    const options = useMemo(
        () => ({
            endpoint: '/api/contacts/search',
            extractResults,
        }),
        []
    )

    const { results, isSearching } = useApiSearch<ContactSearchResult>(query, options)

    return { results, isSearching }
}
