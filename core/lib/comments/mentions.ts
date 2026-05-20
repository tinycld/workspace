// Mention tokens inside a comment body. The wire format is
// `[[@<user_org_id>]]` — a literal user_org record id wrapped in
// double brackets. The token survives copy/paste, is grep-friendly,
// and side-steps the ambiguity of bare @-handles (display names
// aren't unique). Display rendering is the consumer's job; this
// module only parses.

const TOKEN = /\[\[@([A-Za-z0-9_-]+)\]\]/g

export interface ParsedMention {
    userOrgId: string
    range: { from: number; to: number }
}

// Returns one entry per distinct userOrgId, ordered by first
// appearance. The (from, to) range points at the *first* occurrence
// in the body — repeating the same mention later doesn't add a
// second range, because downstream consumers (`comment_mentions`
// inserts, notify hook) treat one mention per user per comment as
// the unit. A reply that re-mentions the same user *does* notify them
// — that's a per-row decision and lives in the mutations factory.
export function parseMentions(body: string): ParsedMention[] {
    const seen = new Set<string>()
    const out: ParsedMention[] = []
    for (const match of body.matchAll(TOKEN)) {
        const userOrgId = match[1]
        if (!userOrgId) continue
        if (seen.has(userOrgId)) continue
        seen.add(userOrgId)
        const from = match.index ?? 0
        out.push({
            userOrgId,
            range: { from, to: from + match[0].length },
        })
    }
    return out
}
