/// <reference path="../pb_data/types.d.ts" />
// user_org's list/view rules used to be `user = @request.auth.id`, which
// meant a member could only ever see their own membership row. Org members
// need to see each other in the Members settings page, so loosen the rules:
// any authed user who is a member of the same org can list/view that org's
// user_org rows. Create/update/delete remain locked down (null = superuser
// only; mutations still flow through core endpoints).
migrate(
    app => {
        const orgMemberRule =
            '@request.auth.id != "" && org.user_org_via_org.user ?= @request.auth.id'

        const col = app.findCollectionByNameOrId('user_org')
        col.listRule = orgMemberRule
        col.viewRule = orgMemberRule
        app.save(col)
    },
    app => {
        const selfOnlyRule = 'user = @request.auth.id'

        const col = app.findCollectionByNameOrId('user_org')
        col.listRule = selfOnlyRule
        col.viewRule = selfOnlyRule
        app.save(col)
    }
)
