import { createContext, useContext } from 'react'
import type { MailSearchResult } from './useMailSearch'

export interface AdvancedSearchFilters {
    from?: string
    to?: string
    subject?: string
    hasWords?: string
    doesntHave?: string
    sizeOp?: 'greater_than' | 'less_than'
    sizeValue?: string
    sizeUnit?: 'MB' | 'KB' | 'bytes'
    dateWithin?: '' | '1d' | '3d' | '1w' | '2w' | '1m' | '2m' | '6m' | '1y'
    dateAnchor?: string
    folder?: 'all' | 'inbox' | 'sent' | 'drafts' | 'trash' | 'spam' | 'starred'
    hasAttachment?: boolean
}

export function hasActiveFilters(filters: AdvancedSearchFilters): boolean {
    return !!(
        filters.from ||
        filters.to ||
        filters.subject ||
        filters.hasWords ||
        filters.doesntHave ||
        filters.sizeValue ||
        filters.dateWithin ||
        (filters.folder && filters.folder !== 'all') ||
        filters.hasAttachment
    )
}

export function countActiveFilters(filters: AdvancedSearchFilters): number {
    let count = 0
    if (filters.from) count++
    if (filters.to) count++
    if (filters.subject) count++
    if (filters.hasWords) count++
    if (filters.doesntHave) count++
    if (filters.sizeValue) count++
    if (filters.dateWithin) count++
    if (filters.folder && filters.folder !== 'all') count++
    if (filters.hasAttachment) count++
    return count
}

export interface SearchState {
    query: string
    results: MailSearchResult[]
    total: number
    isSearching: boolean
    isActive: boolean
    filters: AdvancedSearchFilters
}

export const SearchContext = createContext<SearchState>({
    query: '',
    results: [],
    total: 0,
    isSearching: false,
    isActive: false,
    filters: {},
})

export function useMailSearchState() {
    return useContext(SearchContext)
}
