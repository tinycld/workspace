export type MailboxType = 'shared' | 'personal'
export type TypeFilter = 'all' | MailboxType

export interface MailboxListItem {
    id: string
    address: string
    domainName: string
    displayName: string
    type: string
    memberCount: number
    aliasCount: number
    memberNames: string[]
    memberEmails: string[]
    aliasAddresses: string[]
}

export interface FilterInput {
    query: string
    type: TypeFilter
}

export interface GroupedMailboxes {
    shared: MailboxListItem[]
    personal: MailboxListItem[]
    totals: { all: number; shared: number; personal: number }
}

function matchesQuery(item: MailboxListItem, q: string): boolean {
    if (!q) return true
    const needle = q.toLowerCase().trim()
    if (!needle) return true
    if (item.address.toLowerCase().includes(needle)) return true
    if (item.displayName.toLowerCase().includes(needle)) return true
    for (const n of item.memberNames) {
        if (n.toLowerCase().includes(needle)) return true
    }
    for (const e of item.memberEmails) {
        if (e.toLowerCase().includes(needle)) return true
    }
    for (const a of item.aliasAddresses) {
        if (a.toLowerCase().includes(needle)) return true
    }
    return false
}

function byAddress(a: MailboxListItem, b: MailboxListItem): number {
    return a.address.localeCompare(b.address)
}

export function filterAndGroupMailboxes(items: MailboxListItem[], input: FilterInput): GroupedMailboxes {
    const totals = {
        all: items.length,
        shared: items.filter((i) => i.type === 'shared').length,
        personal: items.filter((i) => i.type === 'personal').length,
    }

    const typeFiltered = items.filter((i) => {
        if (input.type === 'all') return true
        return i.type === input.type
    })

    const queryFiltered = typeFiltered.filter((i) => matchesQuery(i, input.query))

    const shared = queryFiltered.filter((i) => i.type === 'shared').sort(byAddress)
    const personal = queryFiltered.filter((i) => i.type === 'personal').sort(byAddress)

    return { shared, personal, totals }
}
