/// <reference path="../../../server/pb_data/types.d.ts" />
migrate(
    app => {
        const threadState = app.findCollectionByNameOrId('mail_thread_state')
        threadState.fields.removeById('mail_thr_state_labels')
        app.save(threadState)

        const mailLabels = app.findCollectionByNameOrId('mail_labels')
        app.delete(mailLabels)
    },
    app => {
        const mailLabels = new Collection({
            id: 'pbc_mail_labels_01',
            name: 'mail_labels',
            type: 'base',
            system: false,
            fields: [
                {
                    id: 'mail_labels_org',
                    name: 'org',
                    type: 'relation',
                    required: true,
                    collectionId: 'pbc_orgs_00001',
                    cascadeDelete: true,
                    maxSelect: 1,
                },
                {
                    id: 'mail_labels_name',
                    name: 'name',
                    type: 'text',
                    required: true,
                    min: 1,
                    max: 100,
                },
                {
                    id: 'mail_labels_color',
                    name: 'color',
                    type: 'text',
                    required: false,
                    max: 7,
                },
                {
                    id: 'mail_labels_created',
                    name: 'created',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: false,
                },
                {
                    id: 'mail_labels_updated',
                    name: 'updated',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: true,
                },
            ],
            indexes: [
                'CREATE UNIQUE INDEX `idx_mail_labels_org_name` ON `mail_labels` (`org`, `name`)',
                'CREATE INDEX `idx_mail_labels_org` ON `mail_labels` (`org`)',
            ],
        })
        app.save(mailLabels)

        const threadState = app.findCollectionByNameOrId('mail_thread_state')
        threadState.fields.add(
            new Field({
                id: 'mail_thr_state_labels',
                name: 'labels',
                type: 'relation',
                required: false,
                collectionId: 'pbc_mail_labels_01',
                cascadeDelete: false,
                maxSelect: 20,
            })
        )
        app.save(threadState)
    }
)
