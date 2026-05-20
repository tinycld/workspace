import { packageProviders } from '@tinycld/core/lib/packages/derive-components'
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
