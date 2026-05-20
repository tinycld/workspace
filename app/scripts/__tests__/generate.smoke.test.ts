import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'

const APP_DIR = path.resolve(import.meta.dirname, '..', '..')

describe('generate.ts (smoke, real workspace)', () => {
    it('produces tinycld.config.ts, routes, help, uniwind', () => {
        execFileSync('node_modules/.bin/tsx', ['app/scripts/generate.ts'], {
            cwd: path.resolve(APP_DIR, '..'),
            stdio: 'pipe',
        })
        const config = fs.readFileSync(path.join(APP_DIR, 'tinycld.config.ts'), 'utf8')
        expect(config).toContain('export const tinycldConfig')
        expect(config).toContain('@tinycld/contacts')
        expect(config).toContain('export type MergedPackageSchema')

        const routeIndex = path.join(APP_DIR, 'app', 'a', '[orgSlug]', 'contacts', 'index.tsx')
        expect(fs.existsSync(routeIndex)).toBe(true)
        expect(fs.readFileSync(routeIndex, 'utf8')).toContain(
            "from '@tinycld/contacts/screens/index'"
        )

        expect(fs.existsSync(path.join(APP_DIR, 'lib', 'generated', 'package-help.ts'))).toBe(true)
        const css = fs.readFileSync(
            path.join(APP_DIR, 'lib', 'generated', 'uniwind-sources.css'),
            'utf8'
        )
        expect(css).toContain('@source')
        expect(css).toContain('contacts')
    })
})
