// Test-only stub for expo-router. The real package's CJS entry
// (build/index.js) does `require("./global")` at module top, which
// Node's CJS resolver can't satisfy when the calling file is reached
// through a sibling-symlink path (Vite SSR's preserveSymlinks=false
// means imports under packages/@tinycld/<sibling>/... resolve via the
// sibling's real filesystem location, where node_modules don't reach
// expo-router).
//
// Tests that need to load a real screen, hook, or side-effect module
// from a sibling package import this stub instead. It surfaces the
// minimal API actually used at module-top by sibling source — the
// `router` object plus a few component shells. Tests that care about
// hook behavior should still mock those hooks individually with
// vi.mock; this stub only exists so the module graph can finish
// loading.

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
