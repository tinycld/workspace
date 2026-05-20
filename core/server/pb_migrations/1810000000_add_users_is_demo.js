/// <reference path="../pb_data/types.d.ts" />
// Add is_demo flag to users. When true, every outbound effect that would
// normally leave the box (mail send, invite emails, share emails, Expo push)
// is suppressed at the server-side chokepoint, and the rest of the local
// persistence path runs unchanged so the user still sees the message in
// Sent / Notifications etc. Used for App Review and prospect demos.
migrate(
    app => {
        const users = app.findCollectionByNameOrId('users')
        users.fields.addAt(
            users.fields.length,
            new Field({
                id: 'users_is_demo',
                name: 'is_demo',
                type: 'bool',
            })
        )

        // Loosen the updateRule from the previous self-only restriction so a
        // user who shares an org with the target can attempt an update. The
        // RegisterUsersFieldGuard hook in coreserver narrows from there: it
        // enforces an allowlist of admin-editable fields (name, avatar,
        // is_demo) and verifies the caller is an admin/owner of a shared
        // org. Sensitive fields (password, tokenKey, email, emailVisibility,
        // verified) stay owner-only because PB collection rules can't
        // constrain *which* fields a write touches.
        users.updateRule =
            '@request.auth.id != "" && (' +
            'id = @request.auth.id || ' +
            'user_org_via_user.org.user_org_via_org.user ?= @request.auth.id' +
            ')'

        app.save(users)

        // Track which user invited this membership so the invite-email
        // lifecycle hook can skip the outbound mailer call when the inviter
        // is a demo account. Optional — system-created memberships (e.g.
        // first-org bootstrap) leave it empty.
        const userOrg = app.findCollectionByNameOrId('user_org')
        userOrg.fields.addAt(
            userOrg.fields.length,
            new Field({
                id: 'user_org_created_by',
                name: 'created_by',
                type: 'relation',
                collectionId: '_pb_users_auth_',
                cascadeDelete: false,
                maxSelect: 1,
            })
        )
        app.save(userOrg)
    },
    app => {
        const users = app.findCollectionByNameOrId('users')
        users.fields.removeById('users_is_demo')
        users.updateRule = '@request.auth.id != "" && users.id ?= @request.auth.id'
        app.save(users)

        const userOrg = app.findCollectionByNameOrId('user_org')
        userOrg.fields.removeById('user_org_created_by')
        app.save(userOrg)
    }
)
