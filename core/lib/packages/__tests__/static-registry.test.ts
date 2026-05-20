import { describe, expect, it } from 'vitest'
import { toStaticRegistry } from '../static-registry'

describe('toStaticRegistry', () => {
    it('flattens manifests, defaulting packageName to @tinycld/<slug>', () => {
        const entries = [
            { manifest: { name: 'Contacts', slug: 'contacts', version: '1', description: 'd' } },
            {
                manifest: {
                    name: 'X',
                    slug: 'x',
                    version: '1',
                    description: 'd',
                    packageName: '@acme/x',
                },
            },
        ]
        const reg = toStaticRegistry(entries)
        expect(reg[0].packageName).toBe('@tinycld/contacts')
        expect(reg[1].packageName).toBe('@acme/x')
    })
})
