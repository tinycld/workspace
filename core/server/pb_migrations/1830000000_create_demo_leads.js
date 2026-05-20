/// <reference path="../pb_data/types.d.ts" />
// demo_leads stores prospects who provide their email via the demo welcome
// modal or the demo banner's follow-up link. The demo identity itself is a
// shared singleton account, so we cannot attach this info to the user record;
// it lives in its own collection. All API rules are admin-only — submissions
// flow through POST /api/demo/lead, not direct collection writes.
migrate(
    app => {
        const collection = new Collection({
            id: 'pbc_demo_leads_01',
            name: 'demo_leads',
            type: 'base',
            system: false,
            listRule: null,
            viewRule: null,
            createRule: null,
            updateRule: null,
            deleteRule: null,
            fields: [
                {
                    id: 'dl_email',
                    name: 'email',
                    type: 'email',
                    required: true,
                },
                {
                    id: 'dl_reason',
                    name: 'reason',
                    type: 'text',
                    max: 2000,
                },
                {
                    id: 'dl_source',
                    name: 'source',
                    type: 'select',
                    required: true,
                    values: ['intro_modal', 'banner_link'],
                    maxSelect: 1,
                },
                {
                    id: 'dl_user_agent',
                    name: 'user_agent',
                    type: 'text',
                    max: 1000,
                },
                {
                    id: 'dl_ip',
                    name: 'ip',
                    type: 'text',
                    max: 100,
                },
                {
                    id: 'dl_created',
                    name: 'created',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: false,
                },
            ],
            indexes: [
                'CREATE INDEX `idx_demo_leads_email` ON `demo_leads` (`email`)',
                'CREATE INDEX `idx_demo_leads_created` ON `demo_leads` (`created`)',
            ],
        })
        app.save(collection)
    },
    app => {
        try {
            const c = app.findCollectionByNameOrId('demo_leads')
            app.delete(c)
        } catch (e) {
            // may not exist
        }
    }
)
