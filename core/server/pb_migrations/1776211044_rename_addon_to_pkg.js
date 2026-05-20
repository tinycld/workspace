/// <reference path="../pb_data/types.d.ts" />
// Rename "addon" terminology to "pkg" across collections and data.
migrate(
    app => {
        // 1. Rename org_addon_access → org_pkg_access and field addon → pkg
        //    On fresh databases the collection is already created as org_pkg_access,
        //    so skip if the old name doesn't exist.
        let oaa
        try {
            oaa = app.findCollectionByNameOrId('org_addon_access')
        } catch {
            // Already renamed (or created as org_pkg_access on a fresh DB) — nothing to do.
        }
        if (oaa) {
            oaa.name = 'org_pkg_access'
            for (const field of oaa.fields) {
                if (field.name === 'addon') {
                    field.name = 'pkg'
                }
            }
            app.save(oaa)
        }

        // 2. Migrate user_preferences rows: addon_order → pkg_order
        const prefs = app.findRecordsByFilter(
            'user_preferences',
            'app = "core" && key = "addon_order"'
        )
        for (const pref of prefs) {
            pref.set('key', 'pkg_order')
            app.save(pref)
        }
    },
    app => {
        // Reverse: rename back
        const opa = app.findCollectionByNameOrId('org_pkg_access')
        opa.name = 'org_addon_access'
        for (const field of opa.fields) {
            if (field.name === 'pkg') {
                field.name = 'addon'
            }
        }
        app.save(opa)

        const prefs = app.findRecordsByFilter(
            'user_preferences',
            'app = "core" && key = "pkg_order"'
        )
        for (const pref of prefs) {
            pref.set('key', 'addon_order')
            app.save(pref)
        }
    }
)
