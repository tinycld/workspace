import { create } from '@tinycld/core/lib/store'

interface VersionStoreState {
    newVersionAvailable: boolean
    setNewVersionAvailable: (v: boolean) => void
}

export const useVersionStore = create<VersionStoreState>()(set => ({
    newVersionAvailable: false,
    setNewVersionAvailable: v => set({ newVersionAvailable: v }),
}))
