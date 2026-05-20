/// <reference path="../pb_data/types.d.ts" />
// The Members settings page expands user_org.user to show each member's
// name and email, but the default `users` auth-collection view rule is
// self-only (`id = @request.auth.id`), so expand returns an empty user
// for everyone except the current user — rows render blank.
//
// Loosen users.listRule / users.viewRule so an authed user can see any
// other user who shares at least one org with them. PocketBase never
// exposes `password` / `tokenKey` via the record API, so this only
// reveals the same fields already shown in the members table (name,
// email, verified, avatar).
migrate(
    app => {
        const sharedOrgRule =
            '@request.auth.id != "" && user_org_via_user.org.user_org_via_org.user ?= @request.auth.id'

        const col = app.findCollectionByNameOrId('users')
        col.listRule = sharedOrgRule
        col.viewRule = sharedOrgRule
        app.save(col)
    },
    app => {
        const selfOnlyRule = 'id = @request.auth.id'

        const col = app.findCollectionByNameOrId('users')
        col.listRule = selfOnlyRule
        col.viewRule = selfOnlyRule
        app.save(col)
    }
)
