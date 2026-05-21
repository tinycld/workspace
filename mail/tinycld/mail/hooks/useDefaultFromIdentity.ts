import { useMemo } from 'react'
import { type FromIdentity, filterOwnAddresses, pickDefaultFrom } from './defaultFromIdentity'
import { useSendableIdentities } from './useSendableIdentities'

export type { FromIdentity } from './defaultFromIdentity'
export { filterOwnAddresses, pickDefaultFrom }

interface UseDefaultFromIdentityParams {
    mode: 'new' | 'reply' | 'forward'
    replyToAddresses?: string[]
}

export function useDefaultFromIdentity({ mode, replyToAddresses }: UseDefaultFromIdentityParams): FromIdentity {
    const identities = useSendableIdentities()
    const addresses = replyToAddresses ?? []
    const key = addresses.join('\x00').toLowerCase()
    // biome-ignore lint/correctness/useExhaustiveDependencies: `key` is a stable primitive derived from `addresses`; depending on `addresses` directly would re-memo on every render since callers typically pass a fresh array
    return useMemo(() => pickDefaultFrom({ mode, identities, replyToAddresses: addresses }), [mode, identities, key])
}
