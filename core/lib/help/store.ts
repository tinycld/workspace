import { create } from '../store'
import type { HelpTopicId } from './types'

type HelpMode = 'topic' | 'package'

interface HelpState {
    isOpen: boolean
    mode: HelpMode
    topicId: HelpTopicId | null
    pkgSlug: string | null
    // cameFrom records the package the user was browsing when they
    // clicked a topic, so topic mode can render a back arrow only when
    // it makes sense (i.e. NOT when the user opened a topic from the
    // ⌘/ palette or a deep link).
    cameFrom: string | null
    open: (id: HelpTopicId) => void
    openPackage: (slug: string) => void
    // navigateToTopic is called by the package-index rows; it switches
    // mode to 'topic' but preserves cameFrom = current pkgSlug so the
    // back arrow shows.
    navigateToTopic: (id: HelpTopicId) => void
    // Used by the back arrow in topic mode.
    back: () => void
    close: () => void
}

export const useHelpStore = create<HelpState>((set, get) => ({
    isOpen: false,
    mode: 'topic',
    topicId: null,
    pkgSlug: null,
    cameFrom: null,
    open: id =>
        set({
            isOpen: true,
            mode: 'topic',
            topicId: id,
            pkgSlug: null,
            cameFrom: null,
        }),
    openPackage: slug =>
        set({
            isOpen: true,
            mode: 'package',
            pkgSlug: slug,
            topicId: null,
            cameFrom: null,
        }),
    navigateToTopic: id =>
        set({
            isOpen: true,
            mode: 'topic',
            topicId: id,
            cameFrom: get().pkgSlug,
        }),
    back: () => {
        const { cameFrom } = get()
        if (!cameFrom) return
        set({
            mode: 'package',
            pkgSlug: cameFrom,
            topicId: null,
            cameFrom: null,
        })
    },
    // close() intentionally keeps mode/topicId/pkgSlug/cameFrom intact
    // so the drawer's ~200 ms slide-out animation can continue rendering
    // the just-viewed title and body. Without this, the title flashes
    // to 'Help' and the body to the empty placeholder during the
    // exit slide. The next open()/openPackage() call overwrites these
    // fields anyway, so there's no leak between sessions.
    close: () => set({ isOpen: false }),
}))
