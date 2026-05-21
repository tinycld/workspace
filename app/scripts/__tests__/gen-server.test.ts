import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
    buildGoWork,
    buildPackageExtensionsGo,
    replaceSymlink,
    type ServerPkg,
} from '../gen-server'

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

describe('replaceSymlink', () => {
    it('creates a symlink pointing at the target', () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tcld-symlink-'))
        try {
            const target = path.join(tmp, 'real.js')
            fs.writeFileSync(target, 'export {}')
            const link = path.join(tmp, 'sub', 'link.js')
            replaceSymlink(target, link)
            expect(fs.lstatSync(link).isSymbolicLink()).toBe(true)
            expect(fs.readFileSync(link, 'utf8')).toBe('export {}')
        } finally {
            fs.rmSync(tmp, { recursive: true, force: true })
        }
    })

    it('replaces an existing symlink (idempotent re-link)', () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tcld-symlink-'))
        try {
            const a = path.join(tmp, 'a.js')
            const b = path.join(tmp, 'b.js')
            fs.writeFileSync(a, 'A')
            fs.writeFileSync(b, 'B')
            const link = path.join(tmp, 'link.js')
            replaceSymlink(a, link)
            expect(fs.readFileSync(link, 'utf8')).toBe('A')
            // re-link to a different target — must not throw, must repoint
            replaceSymlink(b, link)
            expect(fs.readFileSync(link, 'utf8')).toBe('B')
        } finally {
            fs.rmSync(tmp, { recursive: true, force: true })
        }
    })

    it('removes a broken symlink (target deleted between runs)', () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tcld-symlink-'))
        try {
            const target = path.join(tmp, 'will-disappear.js')
            const newTarget = path.join(tmp, 'replacement.js')
            fs.writeFileSync(target, 'OLD')
            fs.writeFileSync(newTarget, 'NEW')
            const link = path.join(tmp, 'link.js')
            replaceSymlink(target, link)
            fs.unlinkSync(target) // target disappears — link is now broken
            // should not throw and should repoint to newTarget
            replaceSymlink(newTarget, link)
            expect(fs.readFileSync(link, 'utf8')).toBe('NEW')
        } finally {
            fs.rmSync(tmp, { recursive: true, force: true })
        }
    })
})
