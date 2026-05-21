'use strict'

// Stub for @sentry/react-native in unit tests.
// The real package requires react-native/Libraries/Promise (a CJS require
// that bypasses Vite aliases) causing parse failures in SSR mode.
const noop = () => {}
const captureException = () => {}
const init = noop
const withScope = (cb) => cb({ setExtras: noop, setTag: noop })

module.exports = {
    default: { init, captureException, withScope },
    init,
    captureException,
    withScope,
    setUser: noop,
    configureScope: noop,
    addBreadcrumb: noop,
}
