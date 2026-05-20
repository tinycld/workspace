import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('build-mode', () => {
    beforeEach(() => {
        vi.resetModules()
    })

    it('returns "production" when no config has been registered', async () => {
        const { getBuildMode } = await import('../build-mode')
        expect(getBuildMode()).toBe('production')
    })

    it('returns "production" when config.reviewMode is false', async () => {
        const config = await import('../core-config')
        config.configureCore({ brandName: 'Test', serverShortcuts: {}, reviewMode: false })
        const { getBuildMode } = await import('../build-mode')
        expect(getBuildMode()).toBe('production')
    })

    it('returns "review" when config.reviewMode is true', async () => {
        const config = await import('../core-config')
        config.configureCore({ brandName: 'Test', serverShortcuts: {}, reviewMode: true })
        const { getBuildMode } = await import('../build-mode')
        expect(getBuildMode()).toBe('review')
    })

    it('isReviewBuild reflects the same logic', async () => {
        const config = await import('../core-config')
        config.configureCore({ brandName: 'Test', serverShortcuts: {}, reviewMode: true })
        const { isReviewBuild } = await import('../build-mode')
        expect(isReviewBuild()).toBe(true)
    })
})
