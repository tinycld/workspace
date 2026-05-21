/// <reference path="../../../server/pb_data/types.d.ts" />
migrate(
    app => {
        const domains = app.findCollectionByNameOrId('mail_domains')

        const newFields = [
            { id: 'mail_domains_mx_verified', name: 'mx_verified', type: 'bool' },
            {
                id: 'mail_domains_inbound_domain_verified',
                name: 'inbound_domain_verified',
                type: 'bool',
            },
            { id: 'mail_domains_spf_verified', name: 'spf_verified', type: 'bool' },
            { id: 'mail_domains_dkim_verified', name: 'dkim_verified', type: 'bool' },
            {
                id: 'mail_domains_return_path_verified',
                name: 'return_path_verified',
                type: 'bool',
            },
            {
                id: 'mail_domains_last_checked_at',
                name: 'last_checked_at',
                type: 'text',
                max: 40,
            },
            {
                id: 'mail_domains_verification_details',
                name: 'verification_details',
                type: 'json',
                maxSize: 10000,
            },
        ]

        for (const spec of newFields) {
            domains.fields.add(new Field(spec))
        }

        app.save(domains)
    },
    app => {
        const domains = app.findCollectionByNameOrId('mail_domains')
        const removed = [
            'mail_domains_mx_verified',
            'mail_domains_inbound_domain_verified',
            'mail_domains_spf_verified',
            'mail_domains_dkim_verified',
            'mail_domains_return_path_verified',
            'mail_domains_last_checked_at',
            'mail_domains_verification_details',
        ]
        for (const id of removed) {
            domains.fields.removeById(id)
        }
        app.save(domains)
    }
)
