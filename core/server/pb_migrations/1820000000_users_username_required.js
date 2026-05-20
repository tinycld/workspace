/// <reference path="../pb_data/types.d.ts" />
// Add a username field to the users auth collection so login can use either
// username or email as the identifier.
//
// PocketBase v0.36 auth collections do NOT include `username` by default —
// only `id` and `email`. We add it as a regular text field with a unique
// index, then list it alongside `email` in passwordAuth.identityFields so
// authWithPassword(...) accepts either.
//
// Existing rows are backfilled from the email-prefix with collision-resolution.
// The JS and Go (coreserver/usernames.go::BackfillUsernames) implementations
// share TestBackfillUsernames as a parity check.

migrate(
    app => {
        const users = app.findCollectionByNameOrId('users')

        // Add the username field if not already present (idempotent).
        if (!users.fields.getByName('username')) {
            users.fields.add(
                new TextField({
                    id: 'users_username',
                    name: 'username',
                    required: true,
                    pattern: '^[a-z0-9][a-z0-9_-]{2,31}$',
                    min: 3,
                    max: 32,
                })
            )
        }

        // Email becomes optional. PB exposes it via fields.getByName('email').
        const emailField = users.fields.getByName('email')
        if (emailField) {
            emailField.required = false
        }

        // Save the collection first so the new column exists, then backfill.
        // We can't enable required=true on a fresh column with empty rows, so
        // we add the column with required=false initially, backfill, then
        // upgrade to required=true.
        const usernameField = users.fields.getByName('username')
        usernameField.required = false
        app.save(users)

        // Backfill.
        const NON = /[^a-z0-9_-]/g
        const taken = new Set()
        const rows = app.findAllRecords('users')
        for (const r of rows) {
            const u = r.get('username')
            if (u) taken.add(u)
        }
        // Mirror coreserver/usernames.go::DeriveUsername: strip non-username
        // chars, lowercase, fall back to "user" if too short. Collision
        // resolution below handles the resulting duplicates.
        const derive = email => {
            const at = email.indexOf('@')
            const prefix = (at >= 0 ? email.slice(0, at) : email).toLowerCase()
            const cleaned = prefix.replace(NON, '')
            return cleaned.length >= 3 ? cleaned : 'user'
        }
        for (const r of rows) {
            if (r.get('username')) continue
            const base = derive(r.get('email') || '')
            let candidate = base
            let i = 2
            while (taken.has(candidate)) {
                candidate = base + i
                i++
            }
            r.set('username', candidate)
            taken.add(candidate)
            app.save(r)
        }

        // Now flip to required=true and add unique index, then enable
        // username as an identity field for password auth.
        usernameField.required = true
        users.indexes = (users.indexes || []).concat([
            'CREATE UNIQUE INDEX `idx_users_username` ON `users` (`username`)',
        ])

        const opts = users.passwordAuth || {}
        opts.enabled = true
        opts.identityFields = ['username', 'email']
        users.passwordAuth = opts

        app.save(users)
    },
    app => {
        const users = app.findCollectionByNameOrId('users')

        const opts = users.passwordAuth || {}
        opts.identityFields = ['email']
        users.passwordAuth = opts

        users.indexes = (users.indexes || []).filter(
            i => !i.includes('idx_users_username')
        )

        const emailField = users.fields.getByName('email')
        if (emailField) {
            emailField.required = true
        }

        const usernameField = users.fields.getByName('username')
        if (usernameField) {
            users.fields.removeByName('username')
        }

        app.save(users)
    }
)
