import { afterEach, describe, expect, it, vi } from 'vitest'

async function importFresh() {
    vi.resetModules()
    return await import('../core-config')
}

describe('core-config', () => {
    afterEach(() => {
        vi.unstubAllEnvs()
    })

    it('getCoreConfigOptional returns null before configureCore', async () => {
        const { getCoreConfigOptional } = await importFresh()
        expect(getCoreConfigOptional()).toBeNull()
    })

    it('getCoreConfig throws before configureCore', async () => {
        const { getCoreConfig } = await importFresh()
        expect(() => getCoreConfig()).toThrow(/configureCore must be called/)
    })

    it('stores and returns the registered config', async () => {
        const { configureCore, getCoreConfig, getCoreConfigOptional } = await importFresh()
        configureCore({ brandName: 'Acme', serverShortcuts: { app: 'https://acme.example' } })
        expect(getCoreConfig().brandName).toBe('Acme')
        expect(getCoreConfigOptional()?.serverShortcuts.app).toBe('https://acme.example')
    })

    it('throws when configureCore is called twice', async () => {
        const { configureCore } = await importFresh()
        configureCore({ brandName: 'One', serverShortcuts: {} })
        expect(() => configureCore({ brandName: 'Two', serverShortcuts: {} })).toThrow(/twice/)
    })

    it('fires listeners synchronously when configureCore runs', async () => {
        const { configureCore, registerConfigListener } = await importFresh()
        const spy = vi.fn()
        registerConfigListener(spy)
        expect(spy).not.toHaveBeenCalled()
        configureCore({ brandName: 'Acme', serverShortcuts: {} })
        expect(spy).toHaveBeenCalledOnce()
    })

    it('unsubscribed listeners do not fire', async () => {
        const { configureCore, registerConfigListener } = await importFresh()
        const spy = vi.fn()
        const unsub = registerConfigListener(spy)
        unsub()
        configureCore({ brandName: 'Acme', serverShortcuts: {} })
        expect(spy).not.toHaveBeenCalled()
    })

    it('__resetCoreConfigForTests lets a test re-run configureCore', async () => {
        const { configureCore, __resetCoreConfigForTests, getCoreConfigOptional } =
            await importFresh()
        configureCore({ brandName: 'First', serverShortcuts: {} })
        __resetCoreConfigForTests()
        expect(getCoreConfigOptional()).toBeNull()
        configureCore({ brandName: 'Second', serverShortcuts: {} })
        expect(getCoreConfigOptional()?.brandName).toBe('Second')
    })
})
