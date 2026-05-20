/// <reference path="../pb_data/types.d.ts" />
// Make `name` required on the users auth collection.
//
// PocketBase v0.36 default auth collections ship with `name` as an optional
// text field. Every TinyCld code path that creates a user already sets a
// non-empty name (signup via /setup, invite acceptance, demo bootstrap), but
// the schema didn't enforce it — which leaked into the generated TypeScript
// surface (`Users.name`) being treated as nullable downstream and made
// `useAuth().user.name` look optional.
//
// Backfill any existing rows with empty names from the email-prefix (or
// username) before flipping required=true so the constraint can be applied.
migrate(
    app => {
        const users = app.findCollectionByNameOrId('users')

        const rows = app.findAllRecords('users')
        for (const r of rows) {
            const current = r.get('name')
            if (current && String(current).trim() !== '') continue
            const email = r.get('email') || ''
            const at = email.indexOf('@')
            const fromEmail = at > 0 ? email.slice(0, at) : email
            const fallback = fromEmail || r.get('username') || 'User'
            r.set('name', String(fallback))
            app.save(r)
        }

        const nameField = users.fields.getByName('name')
        nameField.required = true
        app.save(users)
    },
    app => {
        const users = app.findCollectionByNameOrId('users')
        const nameField = users.fields.getByName('name')
        if (nameField) {
            nameField.required = false
            app.save(users)
        }
    }
)
