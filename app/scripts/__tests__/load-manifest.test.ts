import { describe, expect, it } from 'vitest'
import { loadManifest } from '../load-manifest'
import { memberDir } from '../paths'

describe('loadManifest', () => {
    it('loads the contacts manifest from the linked member', async () => {
        const m = await loadManifest(memberDir('@tinycld/contacts'))
        expect(m.slug).toBe('contacts')
        expect(m.name).toBe('Contacts')
        expect(m.collections).toMatchObject({ register: 'collections', types: 'types' })
    })
})
