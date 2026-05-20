import { useQuery, useQueryClient, useMutation as useTanStackMutation } from '@tanstack/react-query'
import { useAuth } from '@tinycld/core/lib/auth'
import { captureException } from '@tinycld/core/lib/errors'
import { pb } from '@tinycld/core/lib/pocketbase'
import { isPushSupported, subscribeToPush, unsubscribeFromPush } from '@tinycld/core/lib/web-push'

export function usePushSubscription() {
    const { user, isLoggedIn } = useAuth({ throwIfAnon: false })
    const userId = isLoggedIn ? user.id : ''
    const queryClient = useQueryClient()
    const queryKey = ['push_subscriptions', userId]

    const { data: subscriptions } = useQuery({
        queryKey,
        queryFn: () =>
            pb.collection('push_subscriptions').getFullList({
                filter: `user = "${userId}"`,
            }),
        enabled: !!userId,
    })

    const isSupported = isPushSupported()
    const isSubscribed = (subscriptions?.length ?? 0) > 0

    const subscribe = useTanStackMutation({
        mutationFn: async () => {
            if (!userId) throw new Error('Not logged in')
            await subscribeToPush(userId)
        },
        onSuccess: () => queryClient.invalidateQueries({ queryKey }),
        onError: err => captureException('Push subscribe failed', err),
    })

    const unsubscribe = useTanStackMutation({
        mutationFn: async () => {
            if (!userId) throw new Error('Not logged in')
            await unsubscribeFromPush(userId)
        },
        onSuccess: () => queryClient.invalidateQueries({ queryKey }),
        onError: err => captureException('Push unsubscribe failed', err),
    })

    return {
        isSupported,
        isSubscribed,
        subscribe: subscribe.mutate,
        unsubscribe: unsubscribe.mutate,
        isPending: subscribe.isPending || unsubscribe.isPending,
    }
}
