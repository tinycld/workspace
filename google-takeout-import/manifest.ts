const manifest = {
    name: 'Google Takeout Import',
    slug: 'google-takeout-import',
    version: '0.1.0',
    description: 'Import data from Google Takeout .zip files.',
    settings: [
        {
            slug: 'google-takeout',
            component: 'settings/takeout',
            label: 'Import from Google',
        },
    ],
}

export default manifest
