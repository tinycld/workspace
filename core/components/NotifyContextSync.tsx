import { useAuth } from '@tinycld/core/lib/auth'
import { clearNotifyContext, setNotifyContext } from '@tinycld/core/lib/notify/context'
import { useOrgInfo } from '@tinycld/core/lib/use-org-info'
import { useEffect } from 'react'

/**
 * Syncs the current user + org identifiers into the module-level notify context
 * so non-hook callers (e.g. notify.emit) can reach them. Mounted once inside
 * the org layout.
 */
export function NotifyContextSync() {
    const auth = useAuth({ throwIfAnon: false })
    const { orgId } = useOrgInfo()
    const userId = auth.isLoggedIn ? auth.user.id : null

    useEffect(() => {
        if (!userId || !orgId) return
        setNotifyContext({ orgId, userId })
        return () => clearNotifyContext()
    }, [userId, orgId])

    return null
}
