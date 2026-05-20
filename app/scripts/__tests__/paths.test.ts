import * as path from 'node:path'
import { describe, expect, it } from 'vitest'
import { APP_DIR, GENERATED_DIR, ROUTES_BASE, SERVER_DIR, WS_ROOT } from '../paths'

describe('generator paths', () => {
    it('APP_DIR is the app member dir', () => {
        expect(path.basename(APP_DIR)).toBe('app')
    })
    it('WS_ROOT is the parent of APP_DIR', () => {
        expect(WS_ROOT).toBe(path.resolve(APP_DIR, '..'))
    })
    it('GENERATED_DIR is app/lib/generated', () => {
        expect(GENERATED_DIR).toBe(path.join(APP_DIR, 'lib', 'generated'))
    })
    it('ROUTES_BASE is app/app/a/[orgSlug]', () => {
        expect(ROUTES_BASE).toBe(path.join(APP_DIR, 'app', 'a', '[orgSlug]'))
    })
    it('SERVER_DIR is app/server', () => {
        expect(SERVER_DIR).toBe(path.join(APP_DIR, 'server'))
    })
})
