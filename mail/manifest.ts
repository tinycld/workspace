const manifest = {
    name: 'Mail',
    slug: 'mail',
    version: '0.1.0',
    description: 'Gmail-style email client for your organization',
    routes: { directory: 'screens' },
    nav: { label: 'Mail', icon: 'mail', order: 5, shortcut: 'm' },
    sidebar: { component: 'sidebar' },
    settings: [
        { slug: 'provider', label: 'Provider', component: 'settings/provider' },
        { slug: 'mailboxes', label: 'Mailboxes', component: 'settings/mailboxes' },
    ],
    migrations: { directory: 'pb-migrations' },
    collections: { register: 'collections', types: 'types' },
    help: { directory: 'help' },
    seed: { script: 'seed' },
    server: { package: 'server', module: 'tinycld.org/packages/mail' },
}

export default manifest
