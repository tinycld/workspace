import type { SendableIdentity } from './flattenSendableIdentities'

export interface FromIdentity {
    mailboxId: string
    aliasId: string | null
}

/**
 * Accepts either a bare email ("alice@acme.com") or a display-name-prefixed
 * address ('"Alice" <alice@acme.com>') and returns the lowercase bare address,
 * or null if not extractable.
 */
export function extractBareAddress(raw: string): string | null {
    const trimmed = raw.trim()
    if (!trimmed) return null
    const angleMatch = trimmed.match(/<([^>]+)>/)
    if (angleMatch) return angleMatch[1].trim().toLowerCase()
    return trimmed.toLowerCase()
}

interface PickDefaultFromParams {
    mode: 'new' | 'reply' | 'forward'
    identities: SendableIdentity[]
    replyToAddresses: string[]
}

/**
 * Pure: choose which identity the compose form should default to.
 *  - mode=new: personal (identities[0]) primary
 *  - mode=reply or mode=forward: scan replyToAddresses for a match against any
 *    identity's primary address first (any mailbox wins), then its aliases.
 *  - if no match, fall back to identities[0] primary.
 *  - returns { mailboxId: '', aliasId: null } when identities is empty.
 */
export function pickDefaultFrom({ mode, identities, replyToAddresses }: PickDefaultFromParams): FromIdentity {
    if (identities.length === 0) return { mailboxId: '', aliasId: null }
    const fallback: FromIdentity = { mailboxId: identities[0].mailboxId, aliasId: null }

    if (mode === 'new' || replyToAddresses.length === 0) return fallback

    const normalized = new Set<string>()
    for (const raw of replyToAddresses) {
        const bare = extractBareAddress(raw)
        if (bare) normalized.add(bare)
    }
    if (normalized.size === 0) return fallback

    for (const id of identities) {
        if (normalized.has(id.primaryAddress.toLowerCase())) {
            return { mailboxId: id.mailboxId, aliasId: null }
        }
    }
    for (const id of identities) {
        for (const a of id.aliases) {
            if (normalized.has(a.address.toLowerCase())) {
                return { mailboxId: id.mailboxId, aliasId: a.id }
            }
        }
    }
    return fallback
}

interface FilterOwnAddressesParams {
    identity: SendableIdentity
    recipients: { name: string; email: string }[]
}

/**
 * Pure: strip out the selected identity's primary + all aliases from a
 * recipient list, so reply-all from support@ doesn't include support@.
 */
export function filterOwnAddresses({
    identity,
    recipients,
}: FilterOwnAddressesParams): { name: string; email: string }[] {
    const own = new Set<string>([
        identity.primaryAddress.toLowerCase(),
        ...identity.aliases.map((a) => a.address.toLowerCase()),
    ])
    return recipients.filter((r) => !own.has(r.email.toLowerCase()))
}
