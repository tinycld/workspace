import { describe, expect, it } from 'vitest'
import { deriveProviders, deriveSettings, deriveSidebars } from '../derive-components'
import { deriveSeeds } from '../derive-seeds'

const SB = () => null
const PV = () => null

describe('deriveSidebars / deriveProviders', () => {
    it('maps slug → component, null when absent', () => {
        const entries = [
            { manifest: { slug: 'contacts' }, sidebar: SB },
            { manifest: { slug: 'mail' } },
        ]
        expect(deriveSidebars(entries)).toEqual({ contacts: SB, mail: null })
        expect(deriveProviders([{ manifest: { slug: 'x' }, provider: PV }])).toEqual({ x: PV })
    })
})

describe('deriveSettings', () => {
    it('groups panels by package, omitting packages with none', () => {
        const panels = [{ slug: 'p', label: 'P', Component: PV }]
        const entries = [
            { manifest: { name: 'Mail', slug: 'mail' }, settings: panels },
            { manifest: { name: 'Contacts', slug: 'contacts' } },
        ]
        const groups = deriveSettings(entries)
        expect(groups).toHaveLength(1)
        expect(groups[0]).toMatchObject({ packageName: 'Mail', pkgSlug: 'mail', panels })
    })
})

describe('deriveSeeds', () => {
    it('orders by dependency (deps first), skips entries without a seed', () => {
        const seed = async () => {}
        const entries = [
            { manifest: { slug: 'calc', dependencies: ['drive'] }, seed },
            { manifest: { slug: 'drive', dependencies: [] }, seed },
            { manifest: { slug: 'nodeps' } },
        ]
        const ordered = deriveSeeds(entries).map(s => s.slug)
        expect(ordered).toEqual(['drive', 'calc'])
    })
})
