module.exports = function (api) {
    api.cache(true)
    return {
        presets: [['babel-preset-expo', { unstable_transformImportMeta: true }]],
        plugins: [
            stripImportMetaInNodeModules,
            'react-native-reanimated/plugin',
        ],
    }
}

// pdfjs-dist (and other ESM-only libs published with `import.meta.url` in
// Node-only code paths) lands in Metro's web chunks verbatim. Metro loads
// chunks with classic `<script>` tags, which cannot parse `import.meta`,
// throwing SyntaxError at load time even though the code path never runs.
// babel-preset-expo's import-meta transform does not reliably reach these
// files in production exports, so we inline a minimal replacement that
// rewrites `import.meta.url` → '' and `import.meta` → ({}) for files
// inside node_modules. App code is untouched and keeps the preset's
// behavior (so `import.meta.url` in our own modules still works).
function stripImportMetaInNodeModules({ types: t }) {
    return {
        name: 'strip-import-meta-in-node-modules',
        visitor: {
            MetaProperty(path, state) {
                const { node } = path
                if (node.meta.name !== 'import' || node.property.name !== 'meta') return
                if (!state.filename || !state.filename.includes('/node_modules/')) return
                const parent = path.parentPath
                if (
                    parent.isMemberExpression() &&
                    parent.node.object === node &&
                    !parent.node.computed &&
                    parent.node.property.name === 'url'
                ) {
                    parent.replaceWith(t.stringLiteral(''))
                    return
                }
                path.replaceWith(t.objectExpression([]))
            },
        },
    }
}
