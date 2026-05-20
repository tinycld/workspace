import type { CoreStores } from '@tinycld/core/lib/pocketbase'
import type { Schema } from '@tinycld/core/types/pbSchema'
import type { createCollection, SchemaDeclaration } from 'pbtsdb/core'
import type PocketBase from 'pocketbase'
import type { ComponentType, LazyExoticComponent, ReactNode } from 'react'
import type { PackageManifest } from './types'

// --- Spike-2-proven helpers (see ~/code/tinycld/new/spike2/sim.ts) ----------
export type UnionToIntersection<U> = (U extends unknown ? (k: U) => void : never) extends (
    k: infer I
) => void
    ? I
    : never

interface PackageSidebarProps {
    isCollapsed: boolean
}
interface PackageProviderProps {
    children: ReactNode
}
export interface PackageSettingsPanel {
    slug: string
    label: string
    Component: ComponentType | LazyExoticComponent<ComponentType>
}
export interface SeedContext {
    user: { id: string; email: string; name: string }
    org: { id: string }
    userOrg: { id: string }
}

// pbtsdb's collection factory, typed over the broadest schema. Each package's
// registerCollections declares its OWN narrower factory type (over
// `Schema & PkgSchema`); we accept the broad form here so any concrete package
// factory is assignable through the entry without fighting pbtsdb's invariant
// generic. This is sound because:
//   (1) the runtime call passes the real full-MergedSchema factory, and
//   (2) the type fidelity we depend on (useStore) is on the RETURN side (R),
//       which stays precisely inferred per entry — NOT this parameter.
//   (3) each package's registerCollections is already type-checked in its own
//       file against its own MergedSchema.
type AnyNewCollectionFn = ReturnType<typeof createCollection<SchemaDeclaration>>

// One entry in tinycld.config.ts. S = this package's schema type; R = its
// registerCollections return type. Both are captured for the derivations below.
// registerCollections is OPTIONAL — settings-only packages (e.g.
// google-takeout-import) contribute no collections; a missing one contributes
// {} to MergedSchema/packageStores. For those, pass S = Record<string, never>.
export interface PackageEntry<S extends SchemaDeclaration, R> {
    manifest: PackageManifest & { packageName?: string }
    registerCollections?: (newCollection: AnyNewCollectionFn, coreStores: CoreStores) => R
    schema?: S // covariant phantom carrier (plain S — see spike2/FINDINGS.md)
    sidebar?:
        | ComponentType<PackageSidebarProps>
        | LazyExoticComponent<ComponentType<PackageSidebarProps>>
        | null
    provider?: ComponentType<PackageProviderProps> | null
    settings?: PackageSettingsPanel[]
    seed?: (pb: PocketBase, ctx: SeedContext) => Promise<void>
}

// Entry constructor: schema type S given explicitly, register return R inferred.
// (R defaults to Record<string, never> when registerCollections is omitted.)
//
// The accepted `registerCollections` types its `newCollection` param as the
// caller's OWN factory (`Reg` — each package declares
// `ReturnType<typeof createCollection<Schema & PkgSchema>>`). We DON'T constrain
// that param to a single factory type, because pbtsdb's factory generic is
// invariant and a narrow per-package factory won't unify with a shared one
// (TS2322). We only care about inferring the RETURN type R (which feeds
// MergeSchemas/useStore). The stored entry widens the param to AnyNewCollectionFn.
export function definePackageEntry<S extends SchemaDeclaration>() {
    return <R = Record<string, never>, Reg = AnyNewCollectionFn>(entry: {
        manifest: PackageEntry<S, R>['manifest']
        registerCollections?: (newCollection: Reg, coreStores: CoreStores) => R
        sidebar?: PackageEntry<S, R>['sidebar']
        provider?: PackageEntry<S, R>['provider']
        settings?: PackageEntry<S, R>['settings']
        seed?: PackageEntry<S, R>['seed']
    }): PackageEntry<S, R> => entry as unknown as PackageEntry<S, R>
}

// --- derivations over a config array (the as-const tuple) --------------------
// Extract STRUCTURALLY (via the `schema` phantom property and the register
// RETURN type), NOT by matching `PackageEntry<...>`. Matching the full
// PackageEntry would force TS to resolve registerCollections' `coreStores:
// CoreStores` param — and CoreStores = typeof coreStores in pocketbase.ts,
// which is built from createCollection<MergeSchemas<typeof tinycldConfig>>.
// That round-trip is a circular type reference (TS2456/TS2502). Pulling only
// the `schema` carrier and the return type breaks the cycle: neither touches
// the param types.
export type SchemaOf<E> = E extends { schema?: infer S }
    ? S extends SchemaDeclaration
        ? S
        : Record<string, never>
    : Record<string, never>
export type RegisterReturnOf<E> = E extends {
    registerCollections?: (...args: never[]) => infer R
}
    ? R
    : Record<string, never>

export type MergeSchemas<Entries extends readonly unknown[]> = Schema &
    UnionToIntersection<SchemaOf<Entries[number]>>
export type PackageStoresReturn<Entries extends readonly unknown[]> = UnionToIntersection<
    RegisterReturnOf<Entries[number]>
>
