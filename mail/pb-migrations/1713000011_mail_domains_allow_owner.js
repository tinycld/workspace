/// <reference path="../../../server/pb_data/types.d.ts" />
// NOTE: the adminOrOwnerRule here is mirrored in 1713000000_create_mail_collections.js
// (orgAdminRule, applied to fresh installs). Any change to the mail_domains
// write-rule must be reflected in BOTH files — fresh installs run phase-2 of
// 1713000000 exclusively, while upgrades run 1713000011 on top.
migrate(
    app => {
        const memberRule = 'org.user_org_via_org.user ?= @request.auth.id'
        const adminOrOwnerRule =
            'org.user_org_via_org.user ?= @request.auth.id && (org.user_org_via_org.role ?= "admin" || org.user_org_via_org.role ?= "owner")'

        const domains = app.findCollectionByNameOrId('mail_domains')
        domains.listRule = memberRule
        domains.viewRule = memberRule
        domains.createRule = adminOrOwnerRule
        domains.updateRule = adminOrOwnerRule
        domains.deleteRule = adminOrOwnerRule
        app.save(domains)
    },
    app => {
        const adminOnlyRule =
            'org.user_org_via_org.user ?= @request.auth.id && org.user_org_via_org.role ?= "admin"'

        const domains = app.findCollectionByNameOrId('mail_domains')
        domains.createRule = adminOnlyRule
        domains.updateRule = adminOnlyRule
        domains.deleteRule = adminOnlyRule
        app.save(domains)
    }
)
