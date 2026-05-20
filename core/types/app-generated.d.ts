/**
 * Ambient declaration for the app-sibling-provided generated modules.
 *
 * The runnable app shell generates these files at build time via
 * `scripts/generate-packages.ts` and exposes them through a
 * `@tinycld/app-generated/*` path alias in its own tsconfig. Core consumes
 * them by name; the actual contents are only visible to the app shell.
 *
 * The minimal shapes here let core typecheck standalone (without needing
 * the app's generated files on disk). Concrete types come from the app's
 * tsconfig path mapping when core is consumed as a linked sibling.
 */
declare module '@tinycld/app-generated/package-registry' {
    import type { PackageManifest } from '@tinycld/core/lib/packages/types'
    export const packageRegistry: (PackageManifest & { packageName: string })[]
}

declare module '@tinycld/app-generated/package-collections' {
    import type { CoreStores } from '@tinycld/core/lib/pocketbase'
    import type { Schema } from '@tinycld/core/types/pbSchema'
    import type { createCollection } from 'pbtsdb/core'
    export type MergedSchema = Schema
    type NewCollection = ReturnType<typeof createCollection<MergedSchema>>
    export function packageStores(
        newCollection: NewCollection,
        coreStores: CoreStores
    ): Record<string, unknown>
}

declare module '@tinycld/app-generated/package-providers' {
    import type { ComponentType, ReactNode } from 'react'

    interface PackageProviderProps {
        children: ReactNode
    }
    export const packageProviders: Record<string, ComponentType<PackageProviderProps> | null>
}

declare module '@tinycld/app-generated/package-sidebars' {
    import type { ComponentType, LazyExoticComponent } from 'react'

    interface PackageSidebarProps {
        isCollapsed: boolean
    }
    type SidebarComponent =
        | ComponentType<PackageSidebarProps>
        | LazyExoticComponent<ComponentType<PackageSidebarProps>>
    export const packageSidebars: Record<string, SidebarComponent | null>
}

declare module '@tinycld/app-generated/package-settings' {
    import type { ComponentType, LazyExoticComponent } from 'react'
    export interface PackageSettingsPanel {
        slug: string
        label: string
        Component: ComponentType | LazyExoticComponent<ComponentType>
    }
    export interface PackageSettingsGroup {
        packageName: string
        pkgSlug: string
        panels: PackageSettingsPanel[]
    }
    export const packageSettings: PackageSettingsGroup[]
}

declare module '@tinycld/app-generated/package-help' {
    export interface HelpTopicEntry {
        id: string
        pkgSlug: string
        topicId: string
        title: string
        summary: string
        tags: string[]
        body: string
    }
    export interface HelpGroup {
        packageName: string
        pkgSlug: string
        topics: HelpTopicEntry[]
    }
    export const packageHelp: HelpGroup[]
}

declare module '@tinycld/app-generated/package-seeds' {
    import type PocketBase from 'pocketbase'
    export interface SeedContext {
        user: { id: string; email: string; name: string }
        org: { id: string }
        userOrg: { id: string }
    }
    export type PackageSeedFn = (pb: PocketBase, context: SeedContext) => Promise<void>
    export const packageSeeds: Record<string, PackageSeedFn>
}
