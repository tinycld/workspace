import { useOrgHref } from '@tinycld/core/lib/org-routes'
import { useRouter } from 'expo-router'
import { useCallback, useMemo } from 'react'

export function useThreadNavigation(threadIds: string[], currentThreadId: string) {
    const router = useRouter()
    const orgHref = useOrgHref()

    const currentIndex = useMemo(() => threadIds.indexOf(currentThreadId), [threadIds, currentThreadId])

    const hasPrevious = currentIndex > 0
    const hasNext = currentIndex >= 0 && currentIndex < threadIds.length - 1

    const goToPrevious = useCallback(() => {
        if (!hasPrevious) return
        router.replace(orgHref('mail/[id]', { id: threadIds[currentIndex - 1] }))
    }, [hasPrevious, currentIndex, threadIds, router, orgHref])

    const goToNext = useCallback(() => {
        if (!hasNext) return
        router.replace(orgHref('mail/[id]', { id: threadIds[currentIndex + 1] }))
    }, [hasNext, currentIndex, threadIds, router, orgHref])

    return { hasPrevious, hasNext, goToPrevious, goToNext }
}
