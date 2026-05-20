import path from 'node:path'
import { mergeConfig } from 'vitest/config'
import appConfig from '../app/vitest.config'

// Package-scoped vitest: inherit the app shell's canonical aliases (so
// @tinycld/core/* etc. resolve identically), then add this package's own
// `~/*` source alias and scope the run to this package's tests/.
export default mergeConfig(appConfig, {
    resolve: {
        alias: [{ find: /^~\/(.+)$/, replacement: path.resolve(__dirname, '$1') }],
    },
    test: {
        root: __dirname,
        include: ['tests/**/*.test.{ts,tsx}'],
    },
})
