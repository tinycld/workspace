import { asyncStorage, create, persist } from '@tinycld/core/lib/store'

interface SidebarState {
    /**
     * Per-mailbox expanded flag. Absence means "use the caller's default"
     * (personal defaults expanded, shared default collapsed).
     */
    expanded: Record<string, boolean>
    toggle: (mailboxId: string, defaultExpanded: boolean) => void
    isExpanded: (mailboxId: string, defaultExpanded: boolean) => boolean
}

export const useMailSidebarStore = create<SidebarState>()(
    persist(
        (set, get) => ({
            expanded: {},
            toggle: (mailboxId, defaultExpanded) => {
                const current = get().expanded[mailboxId] ?? defaultExpanded
                set({ expanded: { ...get().expanded, [mailboxId]: !current } })
            },
            isExpanded: (mailboxId, defaultExpanded) => get().expanded[mailboxId] ?? defaultExpanded,
        }),
        {
            name: 'tinycld_mail_sidebar',
            storage: asyncStorage,
            partialize: (s) => ({ expanded: s.expanded }),
        }
    )
)
