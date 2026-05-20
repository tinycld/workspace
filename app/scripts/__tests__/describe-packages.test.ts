import { describe, expect, it } from 'vitest'
import { manifestToConfigPkg, schemaTypeName } from '../describe-packages'

describe('schemaTypeName', () => {
    it('PascalCases the slug + Schema', () => {
        expect(schemaTypeName('contacts')).toBe('ContactsSchema')
        expect(schemaTypeName('google-takeout-import')).toBe('GoogleTakeoutImportSchema')
    })
})

describe('manifestToConfigPkg', () => {
    it('derives flags from manifest presence', () => {
        const cp = manifestToConfigPkg('@tinycld/contacts', {
            name: 'Contacts',
            slug: 'contacts',
            version: '0.1.0',
            description: 'd',
            collections: { register: 'collections', types: 'types' },
            sidebar: { component: 'sidebar' },
            seed: { script: 'seed' },
            routes: { directory: 'screens' },
        })
        expect(cp.hasRegister).toBe(true)
        expect(cp.schemaType).toBe('ContactsSchema')
        expect(cp.hasSidebar).toBe(true)
        expect(cp.hasProvider).toBe(false)
        expect(cp.hasSeed).toBe(true)
        expect(cp.settings).toEqual([])
    })

    it('settings-only package has no register and empty schemaType', () => {
        const cp = manifestToConfigPkg('@tinycld/google-takeout-import', {
            name: 'T',
            slug: 'google-takeout-import',
            version: '0.1.0',
            description: 'd',
            settings: [{ slug: 'g', component: 'settings/takeout', label: 'Import' }],
        })
        expect(cp.hasRegister).toBe(false)
        expect(cp.schemaType).toBe('')
        expect(cp.settings).toEqual([{ slug: 'g', component: 'settings/takeout', label: 'Import' }])
    })
})
