// Vitest stub for lucide-react-native.
// Lucide's ESM bundle (v1.16+) loads individual icon .mjs files that contain
// Flow-style `typeof` syntax Vite/Rollup cannot parse. Returning a generic
// React component avoids the parse error while keeping the import shape valid
// for unit tests that don't assert icon rendering.
//
// The stub uses a Proxy so unknown icons resolve to the Icon function at runtime
// via get-trap. However, Vite's ESM interop for CJS modules uses property
// enumeration (not the get trap) to bind named imports — a Proxy with an empty
// target {} produces no enumerable properties, so named imports resolve to
// undefined in tests that check the value directly. We work around this by
// seeding the Proxy target with every icon name that any test file checks by
// value (not just renders as JSX). Add new names here when a test directly
// asserts the icon reference is non-null.
'use strict'

const React = require('react')

function Icon({ children, ...props }) {
    return null
}

// Seed target with all icon names that unit tests reference by value (not just render).
// The Proxy's get-trap still handles any unknown name so JSX rendering always works.
const knownIcons = {
    // lucide-react-native named exports used by slash-menu-icon-lookup.ts and similar
    Code2: Icon,
    Heading1: Icon,
    Heading2: Icon,
    Heading3: Icon,
    Image: Icon,
    List: Icon,
    ListOrdered: Icon,
    Minus: Icon,
    Quote: Icon,
    Table: Icon,
    // Additional icons imported by text components
    AlertCircle: Icon,
    AlertTriangle: Icon,
    AlignJustify: Icon,
    Ban: Icon,
    Check: Icon,
    ChevronDown: Icon,
    ChevronUp: Icon,
    CloudOff: Icon,
    ExternalLink: Icon,
    FilePlus2: Icon,
    FileSpreadsheet: Icon,
    FileText: Icon,
    LayoutTemplate: Icon,
    Mail: Icon,
    MessageSquare: Icon,
    MessageSquarePlus: Icon,
    Replace: Icon,
    ReplaceAll: Icon,
    RotateCcw: Icon,
    Rows3: Icon,
    ScrollText: Icon,
    Upload: Icon,
    WrapText: Icon,
    X: Icon,
    // calc and other package icons
    FilePlus: Icon,
    Plus: Icon,
    // drive icons (if any are value-checked)
    FolderOpen: Icon,
    Folder: Icon,
    File: Icon,
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

module.exports = new Proxy(knownIcons, handler)
