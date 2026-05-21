import { describe, expect, it } from 'vitest'
import { buildConfigSource, buildSeedsSource, type ConfigPkg } from '../gen-config'

const contacts: ConfigPkg = {
    packageName: '@tinycld/contacts',
    slug: 'contacts',
    schemaType: 'ContactsSchema',
    hasRegister: true,
    hasSidebar: true,
    hasProvider: false,
    hasSeed: true,
    settings: [],
    manifest: { name: 'Contacts', slug: 'contacts', version: '0.1.0', description: 'd' },
}
const takeout: ConfigPkg = {
    packageName: '@tinycld/google-takeout-import',
    slug: 'google-takeout-import',
    schemaType: '',
    hasRegister: false,
    hasSidebar: false,
    hasProvider: false,
    hasSeed: false,
    settings: [{ slug: 'google-takeout', label: 'Import', component: 'settings/takeout' }],
    manifest: {
        name: 'Takeout',
        slug: 'google-takeout-import',
        version: '0.1.0',
        description: 'd',
    },
}

describe('buildConfigSource', () => {
    it('emits a definePackageEntry array with imports and a MergedPackageSchema', () => {
        const src = buildConfigSource([contacts])
        expect(src).toContain(
            "import { definePackageEntry } from '@tinycld/core/lib/packages/config-types'"
        )
        expect(src).toContain(
            "import { registerCollections as contactsRegister } from '@tinycld/contacts/collections'"
        )
        expect(src).toContain("import type { ContactsSchema } from '@tinycld/contacts/types'")
        expect(src).toContain('definePackageEntry<ContactsSchema>()({')
        expect(src).toContain('registerCollections: contactsRegister,')
        expect(src).toContain("sidebar: lazy(() => import('@tinycld/contacts/sidebar')),")
        expect(src).toContain('export type MergedPackageSchema = ContactsSchema')
    })

    it('handles settings-only packages (no register) with Record<string, never>', () => {
        const src = buildConfigSource([takeout])
        expect(src).toContain('definePackageEntry<Record<string, never>>()({')
        expect(src).toContain(
            "Component: lazy(() => import('@tinycld/google-takeout-import/settings/takeout'))"
        )
        // No schema in the merge → MergedPackageSchema falls back to Record<string, never>
        expect(src).toContain('export type MergedPackageSchema = Record<string, never>')
    })

    it('camelCases slugs for identifiers', () => {
        const src = buildConfigSource([
            {
                ...contacts,
                slug: 'google-takeout-import',
                schemaType: 'GtiSchema',
                packageName: '@tinycld/google-takeout-import',
            },
        ])
        expect(src).toContain('as googleTakeoutImportRegister')
    })

    it('emits provider import + entry for hasProvider packages', () => {
        const withProvider: ConfigPkg = {
            packageName: '@tinycld/drive',
            slug: 'drive',
            schemaType: 'DriveSchema',
            hasRegister: true,
            hasSidebar: false,
            hasProvider: true,
            hasSeed: false,
            settings: [],
            manifest: { name: 'Drive', slug: 'drive', version: '0.1.0', description: 'd' },
        }
        const src = buildConfigSource([withProvider])
        expect(src).toContain("import driveProvider from '@tinycld/drive/provider'")
        expect(src).toContain('provider: driveProvider,')
    })

    it('joins multiple package schemas into the MergedPackageSchema intersection', () => {
        const mail: ConfigPkg = {
            packageName: '@tinycld/mail',
            slug: 'mail',
            schemaType: 'MailSchema',
            hasRegister: true,
            hasSidebar: false,
            hasProvider: false,
            hasSeed: false,
            settings: [],
            manifest: { name: 'Mail', slug: 'mail', version: '0.1.0', description: 'd' },
        }
        const src = buildConfigSource([contacts, mail])
        expect(src).toContain('export type MergedPackageSchema = ContactsSchema & MailSchema')
    })

    it('throws when hasRegister is true but schemaType is empty', () => {
        const bad: ConfigPkg = { ...contacts, schemaType: '' }
        expect(() => buildConfigSource([bad])).toThrow(/schemaType is empty/)
    })
})

describe('buildSeedsSource', () => {
    it('emits only packages with seeds, carrying dependencies', () => {
        const src = buildSeedsSource([contacts, takeout])
        expect(src).toContain("import contactsSeed from '@tinycld/contacts/seed'")
        expect(src).not.toContain('takeout')
        expect(src).toContain(
            '{ manifest: { slug: "contacts", dependencies: [] }, seed: contactsSeed },'
        )
    })
})
