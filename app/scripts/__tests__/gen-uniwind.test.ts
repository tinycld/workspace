import { describe, expect, it } from 'vitest'
import { buildUniwindSources } from '../gen-uniwind'

describe('buildUniwindSources', () => {
    it('emits one @source per package real path', () => {
        const css = buildUniwindSources([
            { packageName: '@tinycld/contacts', packageDir: '/abs/contacts' },
            { packageName: '@tinycld/core', packageDir: '/abs/core' },
        ])
        expect(css).toContain('@source "/abs/contacts";  /* @tinycld/contacts */')
        expect(css).toContain('@source "/abs/core";  /* @tinycld/core */')
    })
})
