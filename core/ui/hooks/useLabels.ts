import { and, eq, or } from '@tanstack/db'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { useOrgLiveQuery } from '@tinycld/core/lib/use-org-live-query'
import { useCallback, useMemo } from 'react'

type LabelInfo = { id: string; name: string; color: string }

export function useLabels() {
    const [labelsCollection] = useStore('labels')

    const { data: allLabels } = useOrgLiveQuery((query, { orgId, userOrgId }) =>
        query
            .from({ labels: labelsCollection })
            .where(({ labels }) =>
                and(
                    eq(labels.org, orgId),
                    or(eq(labels.user_org, ''), eq(labels.user_org, userOrgId))
                )
            )
    )

    const labels = allLabels ?? []

    const labelMap = useMemo(() => {
        const map = new Map<string, LabelInfo>()
        for (const l of labels) map.set(l.id, l)
        return map
    }, [labels])

    const labelsForIds = useCallback(
        (ids: string[]) => ids.map(id => labelMap.get(id)).filter((l): l is LabelInfo => l != null),
        [labelMap]
    )

    return { labels, labelMap, labelsForIds }
}

export function useLabelsForRecord(recordId: string, collection: string) {
    const [assignmentsCollection, labelsCollection] = useStore('label_assignments', 'labels')

    const { data: assignments } = useOrgLiveQuery(
        (query, { userOrgId }) =>
            query
                .from({ label_assignments: assignmentsCollection })
                .where(({ label_assignments }) =>
                    and(
                        eq(label_assignments.record_id, recordId),
                        eq(label_assignments.collection, collection),
                        eq(label_assignments.user_org, userOrgId)
                    )
                ),
        [recordId, collection]
    )

    const { data: allLabels } = useOrgLiveQuery((query, { orgId }) =>
        query.from({ labels: labelsCollection }).where(({ labels }) => eq(labels.org, orgId))
    )

    const labels = useMemo(() => {
        if (!assignments || !allLabels) return []
        const labelMap = new Map<string, LabelInfo>()
        for (const l of allLabels) labelMap.set(l.id, l)
        return assignments.map(a => labelMap.get(a.label)).filter((l): l is LabelInfo => l != null)
    }, [assignments, allLabels])

    const labelIds = useMemo(
        () => new Set<string>(assignments?.map(a => a.label) ?? []),
        [assignments]
    )

    return { labels, labelIds }
}
