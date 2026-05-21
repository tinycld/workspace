// Vitest stub for lucide-react-native.
// Lucide's ESM bundle (v1.16+) loads individual icon .mjs files that contain
// Flow-style `typeof` syntax Vite/Rollup cannot parse. Returning a generic
// React component avoids the parse error while keeping the import shape valid
// for unit tests that don't assert icon rendering.
'use strict'

const React = require('react')

function Icon({ children, ...props }) {
    return null
}

const handler = {
    get(target, prop) {
        if (prop === '__esModule') return true
        if (prop === 'default') return Icon
        if (prop === 'LucideProvider') {
            return function LucideProvider({ children }) {
                return children
            }
        }
        if (prop === 'useLucideContext') {
            return function useLucideContext() {
                return { size: 24, color: 'currentColor', strokeWidth: 2, absoluteStrokeWidth: false }
            }
        }
        if (prop === 'createLucideIcon') {
            return function createLucideIcon(_name, _iconNode) {
                return Icon
            }
        }
        // Any named icon export (ChevronDown, Plus, etc.)
        return Icon
    },
}

module.exports = new Proxy({}, handler)
