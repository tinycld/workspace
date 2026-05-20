import { packageProviders } from '@tinycld/app-generated/package-providers'
import type { ComponentType, ReactNode } from 'react'

const stableProviderChain: ComponentType<{ children: ReactNode }>[] = Object.values(
    packageProviders
).filter((p): p is ComponentType<{ children: ReactNode }> => p != null)

export function PackageProviderWrapper({ children }: { children: ReactNode }) {
    return stableProviderChain.reduceRight<ReactNode>(
        (acc, Provider) => <Provider key={Provider.displayName || Provider.name}>{acc}</Provider>,
        children
    )
}
