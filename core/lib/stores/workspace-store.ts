import { asyncStorage, create, persist } from '@tinycld/core/lib/store'

interface WorkspaceStoreState {
    isSidebarOpen: boolean
    isDrawerOpen: boolean
    isMoreOpen: boolean
    isNotificationsOpen: boolean
    activePkgSlug: string | null
    toggleSidebar: () => void
    setSidebarOpen: (open: boolean) => void
    toggleDrawer: () => void
    setDrawerOpen: (open: boolean) => void
    setMoreOpen: (open: boolean) => void
    setNotificationsOpen: (open: boolean) => void
    setActivePkgSlug: (slug: string | null) => void
}

export const useWorkspaceStore = create<WorkspaceStoreState>()(
    persist(
        set => ({
            isSidebarOpen: true,
            isDrawerOpen: false,
            isMoreOpen: false,
            isNotificationsOpen: false,
            activePkgSlug: null,

            toggleSidebar: () => set(s => ({ isSidebarOpen: !s.isSidebarOpen })),
            setSidebarOpen: open => set({ isSidebarOpen: open }),
            toggleDrawer: () => set(s => ({ isDrawerOpen: !s.isDrawerOpen })),
            setDrawerOpen: open => set({ isDrawerOpen: open }),
            setMoreOpen: open => set({ isMoreOpen: open }),
            setNotificationsOpen: open => set({ isNotificationsOpen: open }),
            setActivePkgSlug: slug => set({ activePkgSlug: slug }),
        }),
        {
            name: 'tinycld_sidebar_open',
            storage: asyncStorage,
            partialize: s => ({ isSidebarOpen: s.isSidebarOpen }),
        }
    )
)
