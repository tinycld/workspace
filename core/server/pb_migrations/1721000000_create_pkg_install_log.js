/// <reference path="../pb_data/types.d.ts" />
migrate(
    app => {
        const pkgInstallLog = new Collection({
            id: 'pbc_pkg_ilog_01',
            name: 'pkg_install_log',
            type: 'base',
            system: false,
            listRule: null,
            viewRule: null,
            createRule: null,
            updateRule: null,
            deleteRule: null,
            fields: [
                {
                    id: 'pil_action',
                    name: 'action',
                    type: 'select',
                    required: true,
                    values: ['install', 'uninstall', 'enable', 'disable'],
                    maxSelect: 1,
                },
                {
                    id: 'pil_pkg_slug',
                    name: 'pkg_slug',
                    type: 'text',
                    required: true,
                    max: 100,
                },
                {
                    id: 'pil_npm_package',
                    name: 'npm_package',
                    type: 'text',
                    max: 500,
                },
                {
                    id: 'pil_version',
                    name: 'version',
                    type: 'text',
                    max: 50,
                },
                {
                    id: 'pil_status',
                    name: 'status',
                    type: 'select',
                    required: true,
                    values: ['pending', 'running', 'success', 'failed', 'rolled_back'],
                    maxSelect: 1,
                },
                {
                    id: 'pil_log',
                    name: 'log',
                    type: 'editor',
                },
                {
                    id: 'pil_error',
                    name: 'error',
                    type: 'text',
                    max: 5000,
                },
                {
                    id: 'pil_initiated_by',
                    name: 'initiated_by',
                    type: 'relation',
                    collectionId: '_pb_users_auth_',
                    maxSelect: 1,
                },
                {
                    id: 'pil_started_at',
                    name: 'started_at',
                    type: 'date',
                },
                {
                    id: 'pil_completed_at',
                    name: 'completed_at',
                    type: 'date',
                },
                {
                    id: 'pil_created',
                    name: 'created',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: false,
                },
                {
                    id: 'pil_updated',
                    name: 'updated',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: true,
                },
            ],
            indexes: [
                'CREATE INDEX `idx_pkg_install_log_slug` ON `pkg_install_log` (`pkg_slug`)',
                'CREATE INDEX `idx_pkg_install_log_status` ON `pkg_install_log` (`status`)',
            ],
        })
        app.save(pkgInstallLog)
    },
    app => {
        try {
            const c = app.findCollectionByNameOrId('pkg_install_log')
            app.delete(c)
        } catch (e) {
            // may not exist
        }
    }
)
