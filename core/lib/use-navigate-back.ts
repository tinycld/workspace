import { type Href, useRouter } from 'expo-router'

/**
 * Returns a callback that navigates the user back. Prefers router.back()
 * when there's a history entry to consume; falls back to router.replace()
 * with the caller-supplied Href when the back-stack is empty.
 *
 * Why a hook instead of plain router.back(): Expo Router's back() throws
 * "The action 'GO_BACK' was not handled by any navigator" when the user
 * arrives via deep link, refresh, or notification — anywhere there's no
 * prior in-app navigation. The screen then appears stuck because the
 * onPress handler silently no-ops.
 *
 * Pass `getFallback` as a function (not a precomputed Href) so it reads
 * the latest refs/state at call time. For the common case of returning
 * to the package root, do `useNavigateBack(() => orgHref('mail'))`.
 */
export function useNavigateBack(getFallback: () => Href): () => void {
    const router = useRouter()
    return () => {
        if (router.canGoBack()) {
            router.back()
            return
        }
        router.replace(getFallback())
    }
}
