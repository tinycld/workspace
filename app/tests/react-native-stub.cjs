'use strict'

// Stub for react-native in unit tests. Vite/Rollup cannot parse react-native's
// Flow type syntax or its CJS/ESM hybrid internals. This provides the minimal
// surface that tests reference transitively via core hooks.
module.exports = {
    Platform: { OS: 'web' },
    Dimensions: {
        get: () => ({ width: 1024, height: 768 }),
        addEventListener: () => ({ remove: () => {} }),
    },
    StyleSheet: { create: (s) => s },
    View: 'View',
    Text: 'Text',
    Pressable: 'Pressable',
    ScrollView: 'ScrollView',
}
