const path = require('node:path')
const { getDefaultConfig } = require('expo/metro-config')
const { withUniwindConfig } = require('uniwind/metro')

const config = getDefaultConfig(__dirname)

// `@tinycld/app-generated/*` — package-generator output written to
// lib/generated/. This is a build-time contract (not a symlink artifact):
// @tinycld/core imports these virtual modules by name and the app supplies
// the concrete files. Metro doesn't read tsconfig paths, so alias here.
const APP_GENERATED_DIR = path.join(__dirname, 'lib', 'generated')
const originalResolveRequest = config.resolver.resolveRequest
config.resolver.resolveRequest = (context, moduleName, platform) => {
    if (moduleName.startsWith('@tinycld/app-generated/')) {
        const subpath = moduleName.slice('@tinycld/app-generated/'.length)
        return context.resolveRequest(context, path.join(APP_GENERATED_DIR, subpath), platform)
    }
    return (originalResolveRequest ?? context.resolveRequest)(context, moduleName, platform)
}

module.exports = withUniwindConfig(config, {
    cssEntryFile: './global.css',
    dtsFile: './uniwind-types.d.ts',
    extraThemes: ['dark'],
})
