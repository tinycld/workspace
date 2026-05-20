import { describe, expect, it } from 'vitest'
import { buildGoWork, buildPackageExtensionsGo, type ServerPkg } from '../gen-server'

const contacts: ServerPkg = {
    slug: 'contacts',
    module: 'tinycld.org/packages/contacts',
    serverRelPath: '../../contacts/server',
}

describe('buildPackageExtensionsGo', () => {
    it('emits a no-op when no packages have servers', () => {
        const go = buildPackageExtensionsGo([])
        expect(go).toContain('func registerPackageExtensions(_ *pocketbase.PocketBase) {}')
    })
    it('imports + registers each server package by slug identifier', () => {
        const go = buildPackageExtensionsGo([contacts])
        expect(go).toContain('contacts "tinycld.org/packages/contacts"')
        expect(go).toContain('contacts.Register(app)')
        expect(go).toContain('func registerPackageExtensions(app *pocketbase.PocketBase)')
    })
})

describe('buildGoWork', () => {
    it('includes ., core, and each server package use', () => {
        const work = buildGoWork('../../core/server', [contacts])
        expect(work).toContain('use (')
        expect(work).toContain('    .')
        expect(work).toContain('    ../../core/server')
        expect(work).toContain('    ../../contacts/server')
    })
})
