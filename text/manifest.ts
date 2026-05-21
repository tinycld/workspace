const manifest = {
    name: 'Text',
    slug: 'text',
    version: '0.1.0',
    description: 'Plain-text and rich-text documents.',
    routes: { directory: 'screens' },
    nav: {
        label: 'Text',
        icon: 'file-text',
        order: 15,
        shortcut: 't',
    },
    provider: { component: 'provider' },
    migrations: { directory: 'pb-migrations' },
    collections: { register: 'collections', types: 'types' },
    help: { directory: 'help' },
    server: { package: 'server', module: 'tinycld.org/packages/text' },
    seed: { script: 'seed' },
    // The WebView editor (used by native screens via TenTap's
    // customSource) is bundled from tinycld/text/webview-editor/source/
    // into a single self-contained HTML string at
    // tinycld/text/webview-editor/build/editorHtml.ts. That output is
    // gitignored — the orchestrator in scripts/generate-packages.ts
    // runs this build at dev startup and as part of `packages:generate`,
    // which the Dockerfile build also runs before `expo export`.
    build: { script: 'tinycld/text/webview-editor/build' },
    dependencies: ['drive'],
}

export default manifest
