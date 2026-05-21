import { describe, expect, it } from 'vitest'
import { mergeSharedFolderStates } from '../tinycld/mail/hooks/mergeSharedFolderStates'
import type { MailThreadState } from '../tinycld/mail/types'

function st(overrides: Partial<MailThreadState>): MailThreadState {
    return {
        id: 's',
        thread: 't',
        user_org: 'uo',
        folder: 'sent',
        is_read: false,
        is_starred: false,
        created: '',
        updated: '',
        ...overrides,
    }
}

describe('mergeSharedFolderStates', () => {
    it('keeps states whose user_org is a co-member', () => {
        const states = [
            st({ id: 's1', thread: 't1', user_org: 'uo1' }),
            st({ id: 's2', thread: 't2', user_org: 'uo_other' }),
        ]
        const got = mergeSharedFolderStates(states, ['uo1', 'uo2'])
        expect(got.map(s => s.id)).toEqual(['s1'])
    })

    it('dedupes by thread id — first wins', () => {
        const states = [
            st({ id: 's1', thread: 't1', user_org: 'uo1' }),
            st({ id: 's2', thread: 't1', user_org: 'uo2' }),
        ]
        const got = mergeSharedFolderStates(states, ['uo1', 'uo2'])
        expect(got.map(s => s.id)).toEqual(['s1'])
    })

    it('returns empty for empty co-member set', () => {
        const states = [st({ id: 's1', thread: 't1', user_org: 'uo1' })]
        const got = mergeSharedFolderStates(states, [])
        expect(got).toEqual([])
    })
})
