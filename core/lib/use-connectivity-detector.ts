// Base module for TypeScript resolution. Metro picks .web.ts on web and
// .native.ts on iOS/Android at bundle time.
export function useConnectivityDetector(): void {
    throw new Error(
        'useConnectivityDetector base module should never run — Metro should resolve a .web or .native override'
    )
}
