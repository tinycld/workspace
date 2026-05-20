/// <reference path="../pb_data/types.d.ts" />
migrate(
    app => {
        // 1. pkg_registry — global package catalog (superuser-managed)
        const pkgRegistry = new Collection({
            id: 'pbc_pkg_reg_01',
            name: 'pkg_registry',
            type: 'base',
            system: false,
            listRule: '@request.auth.id != ""',
            viewRule: '@request.auth.id != ""',
            createRule: null,
            updateRule: null,
            deleteRule: null,
            fields: [
                {
                    id: 'pr_name',
                    name: 'name',
                    type: 'text',
                    required: true,
                    min: 1,
                    max: 200,
                },
                {
                    id: 'pr_slug',
                    name: 'slug',
                    type: 'text',
                    required: true,
                    min: 1,
                    max: 100,
                    pattern: '^[a-z0-9][a-z0-9-]*$',
                },
                {
                    id: 'pr_npm_package',
                    name: 'npm_package',
                    type: 'text',
                    max: 500,
                },
                {
                    id: 'pr_version',
                    name: 'version',
                    type: 'text',
                    max: 50,
                },
                {
                    id: 'pr_status',
                    name: 'status',
                    type: 'select',
                    required: true,
                    values: ['bundled', 'available', 'installed', 'disabled'],
                    maxSelect: 1,
                },
                {
                    id: 'pr_manifest_json',
                    name: 'manifest_json',
                    type: 'json',
                },
                {
                    id: 'pr_has_server',
                    name: 'has_server',
                    type: 'bool',
                },
                {
                    id: 'pr_icon',
                    name: 'icon',
                    type: 'text',
                    max: 100,
                },
                {
                    id: 'pr_description',
                    name: 'description',
                    type: 'text',
                    max: 1000,
                },
                {
                    id: 'pr_nav_order',
                    name: 'nav_order',
                    type: 'number',
                },
                {
                    id: 'pr_created',
                    name: 'created',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: false,
                },
                {
                    id: 'pr_updated',
                    name: 'updated',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: true,
                },
            ],
            indexes: [
                'CREATE UNIQUE INDEX `idx_pkg_registry_slug` ON `pkg_registry` (`slug`)',
            ],
        })
        app.save(pkgRegistry)

        // 2. org_pkg_enabled — org-level package toggle
        const orgPkgEnabled = new Collection({
            id: 'pbc_org_pkg_en_01',
            name: 'org_pkg_enabled',
            type: 'base',
            system: false,
            listRule: 'org.users.id ?= @request.auth.id',
            viewRule: 'org.users.id ?= @request.auth.id',
            createRule: null,
            updateRule: null,
            deleteRule: null,
            fields: [
                {
                    id: 'ope_org',
                    name: 'org',
                    type: 'relation',
                    required: true,
                    collectionId: 'pbc_orgs_00001',
                    cascadeDelete: true,
                    maxSelect: 1,
                },
                {
                    id: 'ope_pkg',
                    name: 'pkg',
                    type: 'text',
                    required: true,
                    max: 100,
                },
                {
                    id: 'ope_enabled',
                    name: 'enabled',
                    type: 'bool',
                },
                {
                    id: 'ope_created',
                    name: 'created',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: false,
                },
                {
                    id: 'ope_updated',
                    name: 'updated',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: true,
                },
            ],
            indexes: [
                'CREATE UNIQUE INDEX `idx_org_pkg_enabled_pair` ON `org_pkg_enabled` (`org`, `pkg`)',
            ],
        })
        app.save(orgPkgEnabled)
    },
    app => {
        const names = ['org_pkg_enabled', 'pkg_registry']
        for (const name of names) {
            try {
                const c = app.findCollectionByNameOrId(name)
                app.delete(c)
            } catch (e) {
                // may not exist
            }
        }
    }
)
