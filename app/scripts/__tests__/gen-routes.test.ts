import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { emitRoutes } from '../gen-routes'

describe('emitRoutes', () => {
    let tmp: string
    let pkgDir: string
    let routesBase: string
    beforeEach(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tcld-routes-'))
        pkgDir = path.join(tmp, 'contacts')
        fs.mkdirSync(path.join(pkgDir, 'tinycld', 'contacts', 'screens'), { recursive: true })
        fs.writeFileSync(path.join(pkgDir, 'tinycld', 'contacts', 'screens', 'index.tsx'), '')
        fs.writeFileSync(path.join(pkgDir, 'tinycld', 'contacts', 'screens', '[id].tsx'), '')
        routesBase = path.join(tmp, 'app', 'a', '[orgSlug]')
    })
    afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }))

    it('emits one re-export per screen file under routesBase/<slug>/', () => {
        const written = emitRoutes({
            packageName: '@tinycld/contacts',
            slug: 'contacts',
            packageDir: pkgDir,
            routesDir: 'tinycld/contacts/screens', // resolved path relative to pkgDir
            importSubpath: 'screens', // the exports-map subpath
            routesBase,
        })
        const indexFile = path.join(routesBase, 'contacts', 'index.tsx')
        expect(fs.existsSync(indexFile)).toBe(true)
        expect(fs.readFileSync(indexFile, 'utf8')).toBe(
            "export { default } from '@tinycld/contacts/screens/index'\n"
        )
        const idFile = path.join(routesBase, 'contacts', '[id].tsx')
        expect(fs.readFileSync(idFile, 'utf8')).toBe(
            "export { default } from '@tinycld/contacts/screens/[id]'\n"
        )
        expect(written).toHaveLength(2)
    })
})
