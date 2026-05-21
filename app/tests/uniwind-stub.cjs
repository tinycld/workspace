// Vitest stub for the `uniwind` package.
// Uniwind's react-native export condition points to TypeScript source files
// that import react-native internals — those cannot be parsed by Vite's node
// environment without a full React Native transform pipeline. This minimal
// stub exposes the hooks used by unit-test import chains without triggering
// the react-native native-module loading.
'use strict'

const noop = () => {}
const emptyObj = {}

module.exports = {
    useCSSVariable: () => '',
    useResolveClassNames: () => '',
    useUniwind: () => emptyObj,
    Uniwind: function Uniwind({ children }) {
        return children
    },
    withUniwind: (Component) => Component,
}
