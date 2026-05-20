import { useGlobalSearchParams } from 'expo-router'
import type { ReactNode } from 'react'
import { createContext, createElement, useContext } from 'react'

export const OrgSlugContext = createContext<string>('')

export function OrgSlugProvider({ slug, children }: { slug: string; children: ReactNode }) {
    return createElement(OrgSlugContext.Provider, { value: slug }, children)
}

export function useOrgSlug(): string {
    const contextSlug = useContext(OrgSlugContext)
    const { orgSlug: paramSlug } = useGlobalSearchParams<{ orgSlug: string }>()
    return contextSlug || paramSlug || ''
}
