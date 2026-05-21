import type { ContactSuggestion } from '@tinycld/core/lib/contacts/use-contact-suggestions'
import { useMemo } from 'react'

export type { ContactSuggestion }

export interface Recipient {
    name: string
    email: string
}

export interface ParsedRecipients {
    committed: Recipient[]
    committedEmails: Set<string>
    activeQuery: string
    committedRaw: string
}

const namedEmailPattern = /^(.+)\s*<([^\s@]+@[^\s@]+\.[^\s@]+)>$/

export function parseCommittedRecipients(formValue: string): ParsedRecipients {
    const lastCommaIndex = formValue.lastIndexOf(',')
    if (lastCommaIndex === -1) {
        return {
            committed: [],
            committedEmails: new Set(),
            activeQuery: formValue.trim(),
            committedRaw: '',
        }
    }

    const committedRaw = formValue.slice(0, lastCommaIndex + 1)
    const activeQuery = formValue.slice(lastCommaIndex + 1).trim()
    const segments = committedRaw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)

    const committed: Recipient[] = []
    const committedEmails = new Set<string>()
    for (const seg of segments) {
        const match = seg.match(namedEmailPattern)
        if (match) {
            committed.push({ name: match[1].trim(), email: match[2] })
            committedEmails.add(match[2].toLowerCase())
        } else {
            committed.push({ name: '', email: seg })
            committedEmails.add(seg.toLowerCase())
        }
    }

    return { committed, committedEmails, activeQuery, committedRaw }
}

// Parsing-only hook: pure, no collection access. Safe to call regardless
// of whether the @tinycld/contacts package is linked.
export function useParsedRecipients(formValue: string): ParsedRecipients {
    return useMemo(() => parseCommittedRecipients(formValue), [formValue])
}

// Filter a ready list of contacts against the active query and the set
// of already-committed emails. Kept as a plain function (not a hook) so
// it can be used inside a component that only mounts when contacts is
// available.
export function filterContactSuggestions(
    contacts: ContactSuggestion[] | undefined,
    activeQuery: string,
    committedEmails: Set<string>
): ContactSuggestion[] {
    if (!activeQuery || activeQuery.length < 1 || !contacts) return []
    const q = activeQuery.toLowerCase()
    return contacts.filter((c) => {
        if (committedEmails.has(c.email?.toLowerCase() ?? '')) return false
        const fullName = `${c.first_name} ${c.last_name}`.toLowerCase()
        return fullName.includes(q) || (c.email?.toLowerCase().includes(q) ?? false)
    })
}
