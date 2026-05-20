import { and, eq, not } from '@tanstack/db'
import { mutation, useMutation } from '@tinycld/core/lib/mutations'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { useOrgLiveQuery } from '@tinycld/core/lib/use-org-live-query'
import { useMemo } from 'react'
import { type SortField, useContactsUIStore } from '../stores/contacts-ui-store'
import type { ContactSearchResult } from './useContactSearch'

function sortAccessor(contacts: Record<SortField, unknown>, field: SortField) {
    switch (field) {
        case 'first_name':
            return contacts.first_name
        case 'last_name':
            return contacts.last_name
        case 'email':
            return contacts.email
        case 'phone':
            return contacts.phone
        case 'company':
            return contacts.company
    }
}

export function useContactList(params: {
    filter?: string
    activeLabelId?: string
    searchQuery: string
    serverSearchResults?: ContactSearchResult[]
}) {
    const { filter, activeLabelId, searchQuery, serverSearchResults } = params
    const [contactsCollection] = useStore('contacts')
    const [assignmentsCollection] = useStore('label_assignments')

    const isDeleted = filter === 'deleted'

    // Sort applies to the client list query. The server-search path returns
    // results in its own ranked order; we don't reorder those.
    const sortField = useContactsUIStore((s) => s.sortField)
    const sortDirection = useContactsUIStore((s) => s.sortDirection)

    const { data: contacts, isLoading } = useOrgLiveQuery(
        (query, { userOrgId }) =>
            query
                .from({ contacts: contactsCollection })
                .where(({ contacts }) =>
                    and(
                        eq(contacts.owner, userOrgId),
                        isDeleted ? not(eq(contacts.deleted_at, '')) : eq(contacts.deleted_at, '')
                    )
                )
                .orderBy(({ contacts }) => sortAccessor(contacts, sortField), sortDirection),
        [isDeleted, sortField, sortDirection]
    )

    const { data: contactAssignments } = useOrgLiveQuery((query, { userOrgId }) =>
        query
            .from({ label_assignments: assignmentsCollection })
            .where(({ label_assignments }) =>
                and(eq(label_assignments.collection, 'contacts'), eq(label_assignments.user_org, userOrgId))
            )
    )

    const toggleFavorite = useMutation({
        mutationFn: mutation(function* ({ id, currentFavorite }: { id: string; currentFavorite: boolean }) {
            yield contactsCollection.update(id, (draft) => {
                draft.favorite = !currentFavorite
            })
        }),
    })

    const deleteContact = useMutation({
        mutationFn: mutation(function* (id: string) {
            yield contactsCollection.update(id, (draft) => {
                draft.deleted_at = new Date().toISOString()
            })
        }),
    })

    const restoreContact = useMutation({
        mutationFn: mutation(function* (id: string) {
            yield contactsCollection.update(id, (draft) => {
                draft.deleted_at = ''
            })
        }),
    })

    const permanentlyDeleteContact = useMutation({
        mutationFn: mutation(function* (id: string) {
            yield contactsCollection.delete(id)
        }),
    })

    const assignmentsByContact = useMemo(() => {
        const map = new Map<string, Set<string>>()
        for (const a of contactAssignments ?? []) {
            const existing = map.get(a.record_id)
            if (existing) {
                existing.add(a.label)
            } else {
                map.set(a.record_id, new Set([a.label]))
            }
        }
        return map
    }, [contactAssignments])

    const contactIdsForLabel = useMemo(() => {
        if (!activeLabelId) return null
        const ids = new Set<string>()
        for (const a of contactAssignments ?? []) {
            if (a.label === activeLabelId) ids.add(a.record_id)
        }
        return ids
    }, [activeLabelId, contactAssignments])

    const useServerSearch = searchQuery.length >= 2
    const filteredContacts = useMemo(() => {
        if (useServerSearch) return serverSearchResults

        let list = contacts ?? []

        if (filter === 'favorites') {
            list = list.filter((c) => c.favorite)
        }

        if (contactIdsForLabel) {
            list = list.filter((c) => contactIdsForLabel.has(c.id))
        }

        const q = searchQuery.toLowerCase()
        if (q) {
            list = list.filter((c) => {
                const fullName = `${c.first_name} ${c.last_name}`.toLowerCase()
                return (
                    fullName.includes(q) || c.email?.toLowerCase().includes(q) || c.company?.toLowerCase().includes(q)
                )
            })
        }

        return list
    }, [useServerSearch, serverSearchResults, searchQuery, contacts, filter, contactIdsForLabel])

    return {
        contacts,
        filteredContacts,
        isLoading,
        isDeleted,
        assignmentsByContact,
        toggleFavorite,
        deleteContact,
        restoreContact,
        permanentlyDeleteContact,
    }
}
