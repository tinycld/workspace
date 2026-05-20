/// <reference path="../pb_data/types.d.ts" />
// PocketBase hides the `email` field from API responses unless the record
// has `emailVisibility = true` (or the viewer is a superuser / the record
// owner). New users created via /setup and /api/invite-member already set
// this flag, but seeded users (from scripts/seed-db.ts) and any users
// created outside those flows default to `emailVisibility = false`, so
// other org members see a blank email column on the Members page.
//
// Backfill: set emailVisibility = true for every existing user. Workspace
// members are expected to see each other's emails — it's the same address
// they use for invites.
migrate(
    app => {
        const users = app.findAllRecords('users')
        for (const user of users) {
            if (!user.getBool('emailVisibility')) {
                user.set('emailVisibility', true)
                app.save(user)
            }
        }
    },
    _app => {
        // No-op down: we don't want to re-hide emails that other callers may
        // have already come to rely on being visible.
    }
)
