import { notify } from '@tinycld/core/lib/notify'
import { useTakeoutImportStore } from '@tinycld/core/lib/stores/takeout-import-store'
import { useOrgSlug } from '@tinycld/core/lib/use-org-slug'
import { useEffect, useRef } from 'react'

export function ImportNotifier() {
    const phase = useTakeoutImportStore(s => s.phase)
    const progress = useTakeoutImportStore(s => s.progress)
    const overallError = useTakeoutImportStore(s => s.overallError)
    const prevPhaseRef = useRef(phase)
    const orgSlug = useOrgSlug()

    useEffect(() => {
        const prev = prevPhaseRef.current
        prevPhaseRef.current = phase

        if (prev !== 'importing') return

        if (phase === 'complete') {
            const totals = Object.values(progress).reduce(
                (acc, p) => ({
                    imported: acc.imported + p.imported,
                    skipped: acc.skipped + p.skipped,
                    errors: acc.errors + p.errors,
                }),
                { imported: 0, skipped: 0, errors: 0 }
            )
            const parts = [`Imported ${totals.imported} records`]
            if (totals.skipped) parts.push(`skipped ${totals.skipped}`)
            if (totals.errors) parts.push(`${totals.errors} errors`)

            notify.emit({
                event: 'import.complete',
                title: 'Google Takeout import complete',
                body: `${parts.join(', ')}.`,
                url: `/a/${orgSlug}/settings/personal`,
                data: { source: 'google-takeout', count: totals.imported },
            })
        }

        if (phase === 'error') {
            const body = overallError ?? 'The import encountered an error.'
            notify.emit({
                event: 'import.failed',
                title: 'Google Takeout import failed',
                body,
                url: `/a/${orgSlug}/settings/personal`,
                data: { source: 'google-takeout', error: body },
            })
        }
    }, [phase, progress, overallError, orgSlug])

    return null
}
