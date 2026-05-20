/**
 * `@tinycld/core` root entry — re-exports the app-facing surface of core.
 *
 * The upcoming tinycld/ sibling imports from here to assemble the app:
 *
 *   import { configureCore, Providers } from '@tinycld/core'
 *   import type { CoreConfig } from '@tinycld/core'
 *
 * More granular subpaths remain available via the exports map
 * (`@tinycld/core/lib/*`, `@tinycld/core/components/*`, etc.) for consumers
 * that only need one hook or component.
 */

export { Providers } from './components/Providers'
export type { CoreConfig } from './lib/core-config'
export {
    configureCore,
    getCoreConfig,
    getCoreConfigOptional,
    registerConfigListener,
} from './lib/core-config'
