import { AuthGate } from '@tinycld/core/components/workspace/AuthGate'
import { SkeletonLayout } from '@tinycld/core/components/workspace/SkeletonLayout'
import { useAuth } from '@tinycld/core/lib/auth'
import { navigateToOrg } from '@tinycld/core/lib/org-url'
import { getResolvedAddress } from '@tinycld/core/lib/server-address'
import { router } from 'expo-router'
import { useEffect } from 'react'

export default function Index() {
    const auth = useAuth({ throwIfAnon: false })
    const targetOrg = auth.isLoggedIn ? auth.user.primaryOrgSlug : null
    const hasServer = !!getResolvedAddress()

    useEffect(() => {
        if (targetOrg) {
            navigateToOrg(targetOrg)
        } else if (!auth.isInitializing && !hasServer) {
            router.replace('/connect')
        }
    }, [targetOrg, hasServer, auth.isInitializing])

    if (auth.isInitializing || targetOrg || !hasServer) {
        return <SkeletonLayout />
    }

    return (
        <>
            <SkeletonLayout />
            <AuthGate />
        </>
    )
}
