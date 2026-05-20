import { tinycldConfig } from '@tinycld/app-generated/tinycld-config'
import type { ComponentType, LazyExoticComponent, ReactNode } from 'react'
import type { PackageSettingsPanel } from './config-types'

interface SidebarProps {
    isCollapsed: boolean
}
interface ProviderProps {
    children: ReactNode
}
type SidebarComp = ComponentType<SidebarProps> | LazyExoticComponent<ComponentType<SidebarProps>>
type ProviderComp = ComponentType<ProviderProps>

type ComponentEntryLike = {
    manifest: { slug: string }
    sidebar?: SidebarComp | null
    provider?: ProviderComp | null
}

/** slug → sidebar component (null when the package contributes none). */
export function deriveSidebars(
    entries: readonly ComponentEntryLike[]
): Record<string, SidebarComp | null> {
    const out: Record<string, SidebarComp | null> = {}
    for (const e of entries) out[e.manifest.slug] = e.sidebar ?? null
    return out
}

/** slug → context provider component (null when the package contributes none). */
export function deriveProviders(
    entries: readonly ComponentEntryLike[]
): Record<string, ProviderComp | null> {
    const out: Record<string, ProviderComp | null> = {}
    for (const e of entries) out[e.manifest.slug] = e.provider ?? null
    return out
}

export interface PackageSettingsGroup {
    packageName: string
    pkgSlug: string
    panels: PackageSettingsPanel[]
}

type SettingsEntryLike = {
    manifest: { name: string; slug: string }
    settings?: PackageSettingsPanel[]
}

/** Settings panels grouped by package, omitting packages that contribute none. */
export function deriveSettings(entries: readonly SettingsEntryLike[]): PackageSettingsGroup[] {
    const out: PackageSettingsGroup[] = []
    for (const e of entries) {
        if (e.settings && e.settings.length > 0) {
            out.push({ packageName: e.manifest.name, pkgSlug: e.manifest.slug, panels: e.settings })
        }
    }
    return out
}

export const packageSidebars = deriveSidebars(tinycldConfig)
export const packageProviders = deriveProviders(tinycldConfig)
export const packageSettings = deriveSettings(tinycldConfig)
