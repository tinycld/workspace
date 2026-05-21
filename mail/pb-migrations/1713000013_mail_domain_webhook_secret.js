/// <reference path="../../../server/pb_data/types.d.ts" />
migrate(
    app => {
        const domains = app.findCollectionByNameOrId('mail_domains')

        domains.fields.add(
            new Field({
                id: 'mail_domains_webhook_secret',
                name: 'webhook_secret',
                type: 'text',
                max: 64,
                hidden: true,
            })
        )

        app.save(domains)

        // Backfill existing domains with a random secret
        const records = app.findRecordsByFilter('mail_domains', '1=1')
        for (const record of records) {
            if (!record.get('webhook_secret')) {
                record.set(
                    'webhook_secret',
                    $security.randomStringWithAlphabet(32, 'abcdef0123456789')
                )
                app.save(record)
            }
        }
    },
    app => {
        const domains = app.findCollectionByNameOrId('mail_domains')
        domains.fields.removeById('mail_domains_webhook_secret')
        app.save(domains)
    }
)
