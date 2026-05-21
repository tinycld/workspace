/// <reference path="../../../server/pb_data/types.d.ts" />
migrate(
    app => {
        const mailboxes = app.findCollectionByNameOrId('mail_mailboxes')

        mailboxes.fields.add(
            new Field({
                id: 'mail_mailboxes_name',
                name: 'name',
                type: 'text',
                required: false,
                max: 100,
            })
        )

        app.save(mailboxes)

        // Back-fill existing mailboxes: set name to the org's name via domain → org lookup
        const allMailboxes = app.findRecordsByFilter('mail_mailboxes', '1=1', '', 0, 0)
        for (const mb of allMailboxes) {
            if (mb.getString('name')) continue
            try {
                const domain = app.findRecordById('mail_domains', mb.getString('domain'))
                const org = app.findRecordById('orgs', domain.getString('org'))
                mb.set('name', org.getString('name'))
                app.save(mb)
            } catch (_) {
                // skip if domain/org lookup fails
            }
        }
    },
    app => {
        const mailboxes = app.findCollectionByNameOrId('mail_mailboxes')
        mailboxes.fields.removeById('mail_mailboxes_name')
        app.save(mailboxes)
    }
)
