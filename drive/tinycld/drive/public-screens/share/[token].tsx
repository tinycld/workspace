import { useQuery } from '@tanstack/react-query'
import { PublicShareError, PublicShareLayout, type PublicShareMetadata } from '@tinycld/core/components/public-share'
import { useAuth } from '@tinycld/core/lib/auth'
import { PB_SERVER_ADDR } from '@tinycld/core/lib/pocketbase'
import { Redirect, useLocalSearchParams } from 'expo-router'
import { ActivityIndicator, View } from 'react-native'

const shareLinkUrl = (token: string) => `${PB_SERVER_ADDR}/api/drive/share-link/${token}`

function useShareLinkRouting(token: string) {
    const auth = useAuth({ throwIfAnon: false })

    const query = useQuery<{ org_slug: string; item_id: string }>({
        queryKey: ['share-link-routing', token],
        queryFn: async () => {
            const resp = await fetch(shareLinkUrl(token))
            if (!resp.ok) throw new Error('Failed to load share link')
            return resp.json()
        },
        enabled: !!token && auth.isLoggedIn && !auth.isInitializing,
    })

    return { ...query, auth }
}

async function fetchShareMetadata(token: string): Promise<PublicShareMetadata> {
    const resp = await fetch(shareLinkUrl(token))
    if (!resp.ok) {
        const body = await resp.json().catch(() => ({}))
        throw new PublicShareError(resp.status, body.error ?? 'Failed to load')
    }
    return resp.json()
}

export default function ShareTokenPage() {
    const { token = '' } = useLocalSearchParams<{ token: string }>()
    const { data, auth } = useShareLinkRouting(token)

    if (auth.isInitializing) {
        return (
            <View className="flex-1 items-center justify-center">
                <ActivityIndicator size="large" />
            </View>
        )
    }

    // Logged-in viewers with org access bypass the public preview and land
    // directly on the drive workspace with the file's preview pane open.
    if (auth.isLoggedIn && data?.org_slug && data?.item_id) {
        return <Redirect href={`/a/${data.org_slug}/drive?file=${data.item_id}&preview=1`} />
    }

    if (auth.isLoggedIn && !data) {
        return (
            <View className="flex-1 items-center justify-center">
                <ActivityIndicator size="large" />
            </View>
        )
    }

    return (
        <PublicShareLayout
            queryKey={['drive-share-link', token]}
            fetchMetadata={() => fetchShareMetadata(token)}
        />
    )
}
