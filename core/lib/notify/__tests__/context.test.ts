import {
    clearNotifyContext,
    getNotifyContext,
    setNotifyContext,
} from '@tinycld/core/lib/notify/context'
import { afterEach, describe, expect, it } from 'vitest'

describe('notify/context', () => {
    afterEach(() => {
        clearNotifyContext()
    })

    it('returns null when nothing is set', () => {
        expect(getNotifyContext()).toBeNull()
    })

    it('round-trips a context snapshot', () => {
        setNotifyContext({ orgId: 'o1', userId: 'u1' })
        expect(getNotifyContext()).toEqual({
            orgId: 'o1',
            userId: 'u1',
        })
    })

    it('clearNotifyContext resets to null', () => {
        setNotifyContext({ orgId: 'o1', userId: 'u1' })
        clearNotifyContext()
        expect(getNotifyContext()).toBeNull()
    })
})
