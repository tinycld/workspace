/// <reference path="../pb_data/types.d.ts" />
migrate(
    app => {
        const auditLogs = new Collection({
            id: 'pbc_audit_logs_1',
            name: 'audit_logs',
            type: 'base',
            system: false,
            listRule: '@request.auth.id != "" && org.users.id ?= @request.auth.id',
            viewRule: '@request.auth.id != "" && org.users.id ?= @request.auth.id',
            createRule: null,
            updateRule: null,
            deleteRule: null,
            fields: [
                {
                    id: 'al_org',
                    name: 'org',
                    type: 'relation',
                    required: true,
                    collectionId: 'pbc_orgs_00001',
                    cascadeDelete: true,
                    maxSelect: 1,
                },
                {
                    id: 'al_actor',
                    name: 'actor',
                    type: 'relation',
                    collectionId: '_pb_users_auth_',
                    maxSelect: 1,
                },
                {
                    id: 'al_action',
                    name: 'action',
                    type: 'select',
                    required: true,
                    values: ['created', 'updated', 'deleted'],
                    maxSelect: 1,
                },
                {
                    id: 'al_resource_type',
                    name: 'resource_type',
                    type: 'text',
                    required: true,
                    max: 100,
                },
                {
                    id: 'al_resource_id',
                    name: 'resource_id',
                    type: 'text',
                    required: true,
                    max: 50,
                },
                {
                    id: 'al_resource_label',
                    name: 'resource_label',
                    type: 'text',
                    max: 500,
                },
                {
                    id: 'al_changes',
                    name: 'changes',
                    type: 'json',
                },
                {
                    id: 'al_snapshot',
                    name: 'snapshot',
                    type: 'json',
                },
                {
                    id: 'al_ip_address',
                    name: 'ip_address',
                    type: 'text',
                    max: 100,
                },
                {
                    id: 'al_user_agent',
                    name: 'user_agent',
                    type: 'text',
                    max: 500,
                },
                {
                    id: 'al_metadata',
                    name: 'metadata',
                    type: 'json',
                },
                {
                    id: 'al_created',
                    name: 'created',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: false,
                },
                {
                    id: 'al_updated',
                    name: 'updated',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: true,
                },
            ],
            indexes: [
                'CREATE INDEX `idx_audit_org_created` ON `audit_logs` (`org`, `created` DESC)',
                'CREATE INDEX `idx_audit_actor_created` ON `audit_logs` (`actor`, `created` DESC)',
                'CREATE INDEX `idx_audit_resource` ON `audit_logs` (`resource_type`, `resource_id`)',
            ],
        })
        app.save(auditLogs)
    },
    app => {
        try {
            const c = app.findCollectionByNameOrId('audit_logs')
            app.delete(c)
        } catch (e) {
            // may not exist
        }
    }
)
