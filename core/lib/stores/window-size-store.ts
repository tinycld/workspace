import { create } from '@tinycld/core/lib/store'
import { Dimensions } from 'react-native'

export interface WindowSizeState {
    width: number
    height: number
    setSize: (width: number, height: number) => void
}

// Each call to RN Web's `useWindowDimensions` registers its own
// `Dimensions.addEventListener`. With useBreakpoint() consumed in 26+
// places across the app, every resize fanned out N parallel state updates.
// Centralize on a single Zustand store + one module-level listener; the
// useBreakpoint hook re-derives 'desktop'/'tablet'/'mobile' via a primitive
// selector so consumers re-render only when the bucket actually flips.
function readInitialSize(): { width: number; height: number } {
    if (typeof Dimensions?.get === 'function') {
        const w = Dimensions.get('window')
        return { width: w.width, height: w.height }
    }
    return { width: 0, height: 0 }
}

const initial = readInitialSize()

export const useWindowSizeStore = create<WindowSizeState>()(set => ({
    width: initial.width,
    height: initial.height,
    setSize: (width, height) => set({ width, height }),
}))

// One subscription for the entire app. Skipped under unit tests where
// react-native is shimmed (no Dimensions.addEventListener).
if (typeof Dimensions?.addEventListener === 'function') {
    Dimensions.addEventListener('change', ({ window }) => {
        useWindowSizeStore.getState().setSize(window.width, window.height)
    })
}
