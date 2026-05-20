import { describe, expect, it } from 'vitest'
import { buildPackageStores } from '../derive-stores'

describe('buildPackageStores', () => {
    it('spreads each entry registerCollections return into one map', () => {
        const entries = [
            { registerCollections: () => ({ contacts: 'C' }) },
            { registerCollections: () => ({ mail_messages: 'M' }) },
        ]
        const stores = buildPackageStores(entries, {}, {} as never)
        expect(stores).toEqual({ contacts: 'C', mail_messages: 'M' })
    })

    it('skips entries without registerCollections', () => {
        const entries = [{ registerCollections: () => ({ a: 1 }) }, {} as never]
        const stores = buildPackageStores(entries, {}, {} as never)
        expect(stores).toEqual({ a: 1 })
    })
})
