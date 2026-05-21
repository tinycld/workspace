// Test-only stub for expo-router. The real package's CJS entry (build/index.js)
// follows source maps to src/exports.ts which contains JSX that Vite's SSR
// node environment cannot parse. This stub provides the minimal API used at
// module-top by package source files so the module graph can finish loading.

import { vi } from 'vitest'

const noop = () => {}
const ComponentStub = () => null

export const router = {
    push: vi.fn(noop),
    replace: vi.fn(noop),
    back: vi.fn(noop),
    canGoBack: vi.fn(() => true),
    setParams: vi.fn(noop),
    navigate: vi.fn(noop),
    dismissAll: vi.fn(noop),
    dismiss: vi.fn(noop),
}

export const Link = ComponentStub
export const Stack = Object.assign(ComponentStub, { Screen: ComponentStub })
export const Tabs = Object.assign(ComponentStub, { Screen: ComponentStub })
export const Slot = ComponentStub
export const Redirect = ComponentStub
export const Drawer = Object.assign(ComponentStub, { Screen: ComponentStub })

export const useRouter = () => router
export const usePathname = () => '/'
export const useSegments = () => []
export const useLocalSearchParams = () => ({})
export const useGlobalSearchParams = () => ({})
export const useFocusEffect = (_cb: () => void) => {}
export const useNavigation = () => ({})
export const useRootNavigationState = () => ({ key: 'test' })
export const Href = undefined
