import { and, eq, not } from '@tanstack/db'
import { useMutation } from '@tinycld/core/lib/mutations'
import { pb, useStore } from '@tinycld/core/lib/pocketbase'
import { useOrgLiveQuery } from '@tinycld/core/lib/use-org-live-query'

export function useVersionHistory(itemId: string) {
    const [versionsCollection] = useStore('drive_item_versions')

    const { data: versions } = useOrgLiveQuery(
        (query) =>
            query
                .from({ v: versionsCollection })
                .where(({ v }) => and(eq(v.item, itemId), not(eq(v.source, 'system'))))
                .orderBy(({ v }) => v.version_number, 'desc'),
        [itemId]
    )

    const restoreMutation = useMutation({
        mutationFn: async (versionId: string) => {
            await pb.send('/api/drive/versions/restore', {
                method: 'POST',
                body: JSON.stringify({ item: itemId, version: versionId }),
                headers: { 'Content-Type': 'application/json' },
            })
        },
    })

    return {
        versions: versions ?? [],
        restoreVersion: restoreMutation.mutate,
        isRestoring: restoreMutation.isPending,
    }
}
