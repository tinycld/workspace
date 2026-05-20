import type PocketBase from 'pocketbase'
import type { SeedContext } from './config-types'

type SeedFn = (pb: PocketBase, ctx: SeedContext) => Promise<void>
type SeedEntryLike = {
    manifest: { slug: string; dependencies?: readonly string[] }
    seed?: SeedFn
}

export interface OrderedSeed {
    slug: string
    seed: SeedFn
}

/**
 * Return each config entry's seed in dependency order: for any package P, every
 * package listed in P.manifest.dependencies (by slug) runs before P. Falls back
 * to insertion order where there's no dependency relation; cycles fall back to
 * insertion order without throwing (seed ordering is best-effort). Entries
 * without a seed are skipped. Ports topologicallyOrderForSeeds from the old
 * generator into a runtime derivation over tinycld.config.ts.
 */
export function deriveSeeds(entries: readonly SeedEntryLike[]): OrderedSeed[] {
    const bySlug = new Map(entries.map(e => [e.manifest.slug, e]))
    const visited = new Set<string>()
    const inProgress = new Set<string>()
    const ordered: SeedEntryLike[] = []

    const visit = (slug: string) => {
        if (visited.has(slug)) return
        if (inProgress.has(slug)) return // cycle — bail, leave to insertion order
        const entry = bySlug.get(slug)
        if (!entry) return
        inProgress.add(slug)
        for (const dep of entry.manifest.dependencies ?? []) visit(dep)
        inProgress.delete(slug)
        visited.add(slug)
        ordered.push(entry)
    }

    for (const e of entries) visit(e.manifest.slug)

    return ordered.flatMap(e => (e.seed ? [{ slug: e.manifest.slug, seed: e.seed }] : []))
}
