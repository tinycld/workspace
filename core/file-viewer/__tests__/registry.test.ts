import {
    __resetRegistryForTests,
    getPreviewEntry,
    registerPreview,
} from '@tinycld/core/file-viewer/registry'
import type { PreviewProps } from '@tinycld/core/file-viewer/types'
import { beforeEach, describe, expect, it } from 'vitest'

const StubViewer = (_props: PreviewProps) => null

describe('preview registry', () => {
    beforeEach(__resetRegistryForTests)

    it('returns undefined for an empty registry with no fallback', () => {
        expect(getPreviewEntry('application/pdf')).toBeUndefined()
    })

    it('returns the exact-match entry when one is registered', () => {
        registerPreview('application/pdf', { preview: StubViewer })
        expect(getPreviewEntry('application/pdf')?.preview).toBe(StubViewer)
    })

    it('falls back to a `<type>/*` wildcard entry', () => {
        registerPreview('image/*', { preview: StubViewer })
        expect(getPreviewEntry('image/png')?.preview).toBe(StubViewer)
        expect(getPreviewEntry('image/jpeg')?.preview).toBe(StubViewer)
    })

    it('prefers an exact match over a wildcard', () => {
        const ExactViewer = (_p: PreviewProps) => null
        registerPreview('image/*', { preview: StubViewer })
        registerPreview('image/svg+xml', { preview: ExactViewer })
        expect(getPreviewEntry('image/svg+xml')?.preview).toBe(ExactViewer)
        expect(getPreviewEntry('image/png')?.preview).toBe(StubViewer)
    })

    it('falls back to the `*` catch-all when nothing else matches', () => {
        const Generic = (_p: PreviewProps) => null
        registerPreview('*', { preview: Generic })
        expect(getPreviewEntry('application/x-shockwave-flash')?.preview).toBe(Generic)
    })
})
