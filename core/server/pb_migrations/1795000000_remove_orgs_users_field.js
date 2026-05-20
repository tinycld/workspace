/// <reference path="../pb_data/types.d.ts" />
migrate(
    app => {
        const orgMemberRule = 'org.user_org_via_org.user ?= @request.auth.id'
        const orgSelfMemberRule = 'user_org_via_org.user ?= @request.auth.id'

        const orgs = app.findCollectionByNameOrId('orgs')
        orgs.listRule = `@request.auth.id != "" && ${orgSelfMemberRule}`
        orgs.viewRule = `@request.auth.id != "" && ${orgSelfMemberRule}`
        orgs.updateRule = `@request.auth.id != "" && ${orgSelfMemberRule}`
        app.save(orgs)

        const labels = app.findCollectionByNameOrId('labels')
        labels.listRule = orgMemberRule
        labels.viewRule = orgMemberRule
        labels.createRule = orgMemberRule
        labels.updateRule = orgMemberRule
        labels.deleteRule = orgMemberRule
        app.save(labels)

        const settings = app.findCollectionByNameOrId('settings')
        settings.listRule = orgMemberRule
        settings.viewRule = orgMemberRule
        settings.createRule = orgMemberRule
        settings.updateRule = orgMemberRule
        app.save(settings)

        const auditLogs = app.findCollectionByNameOrId('audit_logs')
        auditLogs.listRule = `@request.auth.id != "" && ${orgMemberRule}`
        auditLogs.viewRule = `@request.auth.id != "" && ${orgMemberRule}`
        app.save(auditLogs)

        const orgPkgEnabled = app.findCollectionByNameOrId('org_pkg_enabled')
        orgPkgEnabled.listRule = orgMemberRule
        orgPkgEnabled.viewRule = orgMemberRule
        orgPkgEnabled.createRule = orgMemberRule
        orgPkgEnabled.updateRule = orgMemberRule
        orgPkgEnabled.deleteRule = orgMemberRule
        app.save(orgPkgEnabled)

        orgs.fields.removeById('orgs_users')
        app.save(orgs)
    },
    app => {
        const legacySelfRule = 'users.id ?= @request.auth.id'
        const legacyOrgRule = 'org.users.id ?= @request.auth.id'

        const orgs = app.findCollectionByNameOrId('orgs')
        orgs.fields.add(
            new Field({
                id: 'orgs_users',
                name: 'users',
                type: 'relation',
                collectionId: '_pb_users_auth_',
                maxSelect: 999,
            })
        )
        orgs.listRule = `@request.auth.id != "" && ${legacySelfRule}`
        orgs.viewRule = `@request.auth.id != "" && ${legacySelfRule}`
        orgs.updateRule = `@request.auth.id != "" && ${legacySelfRule}`
        app.save(orgs)

        const labels = app.findCollectionByNameOrId('labels')
        labels.listRule = legacyOrgRule
        labels.viewRule = legacyOrgRule
        labels.createRule = legacyOrgRule
        labels.updateRule = legacyOrgRule
        labels.deleteRule = legacyOrgRule
        app.save(labels)

        const settings = app.findCollectionByNameOrId('settings')
        settings.listRule = legacyOrgRule
        settings.viewRule = legacyOrgRule
        settings.createRule = legacyOrgRule
        settings.updateRule = legacyOrgRule
        app.save(settings)

        const auditLogs = app.findCollectionByNameOrId('audit_logs')
        auditLogs.listRule = `@request.auth.id != "" && ${legacyOrgRule}`
        auditLogs.viewRule = `@request.auth.id != "" && ${legacyOrgRule}`
        app.save(auditLogs)

        const orgPkgEnabled = app.findCollectionByNameOrId('org_pkg_enabled')
        orgPkgEnabled.listRule = legacyOrgRule
        orgPkgEnabled.viewRule = legacyOrgRule
        orgPkgEnabled.createRule = legacyOrgRule
        orgPkgEnabled.updateRule = legacyOrgRule
        orgPkgEnabled.deleteRule = legacyOrgRule
        app.save(orgPkgEnabled)
    }
)
