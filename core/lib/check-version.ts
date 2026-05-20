interface CheckVersionOpts {
    bootReleaseId: string
    setNewVersionAvailable: (v: boolean) => void
    fetch?: typeof fetch
}

// checkVersion polls /api/version and sets newVersionAvailable=true if the
// server reports a different release id than the one this client booted on.
// Network errors and unexpected responses are swallowed: a transient server
// blip should never spuriously prompt the user to refresh.
export async function checkVersion({
    bootReleaseId,
    setNewVersionAvailable,
    fetch: fetchFn = fetch,
}: CheckVersionOpts): Promise<void> {
    try {
        const res = await fetchFn('/api/version', { cache: 'no-store' })
        if (!res.ok) return
        const body = (await res.json()) as { releaseId?: string }
        if (body.releaseId && body.releaseId !== bootReleaseId) {
            setNewVersionAvailable(true)
        }
    } catch {
        // Transient network/parse failure — leave the flag as-is; the next
        // interval (or visibility-change) will retry.
    }
}
