/// <reference path="../../../server/pb_data/types.d.ts" />
migrate(
    app => {
        // Phase 1: Create all collections without access rules (avoids back-relation ordering issues)

        // 1. mail_domains
        const domains = new Collection({
            id: 'pbc_mail_domains_01',
            name: 'mail_domains',
            type: 'base',
            system: false,
            fields: [
                {
                    id: 'mail_domains_org',
                    name: 'org',
                    type: 'relation',
                    required: true,
                    collectionId: 'pbc_orgs_00001',
                    cascadeDelete: true,
                    maxSelect: 1,
                },
                {
                    id: 'mail_domains_domain',
                    name: 'domain',
                    type: 'text',
                    required: true,
                    min: 3,
                    max: 253,
                },
                {
                    id: 'mail_domains_verified',
                    name: 'verified',
                    type: 'bool',
                },
                {
                    id: 'mail_domains_created',
                    name: 'created',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: false,
                },
                {
                    id: 'mail_domains_updated',
                    name: 'updated',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: true,
                },
            ],
            indexes: [
                'CREATE UNIQUE INDEX `idx_mail_domains_org_domain` ON `mail_domains` (`org`, `domain`)',
                'CREATE INDEX `idx_mail_domains_org` ON `mail_domains` (`org`)',
            ],
        })
        app.save(domains)

        // 2. mail_mailboxes
        const mailboxes = new Collection({
            id: 'pbc_mail_mailboxes_01',
            name: 'mail_mailboxes',
            type: 'base',
            system: false,
            fields: [
                {
                    id: 'mail_mailboxes_address',
                    name: 'address',
                    type: 'text',
                    required: true,
                    min: 1,
                    max: 64,
                },
                {
                    id: 'mail_mailboxes_domain',
                    name: 'domain',
                    type: 'relation',
                    required: true,
                    collectionId: 'pbc_mail_domains_01',
                    cascadeDelete: true,
                    maxSelect: 1,
                },
                {
                    id: 'mail_mailboxes_display_name',
                    name: 'display_name',
                    type: 'text',
                    required: false,
                    max: 200,
                },
                {
                    id: 'mail_mailboxes_type',
                    name: 'type',
                    type: 'select',
                    required: true,
                    values: ['personal', 'shared'],
                    maxSelect: 1,
                },
                {
                    id: 'mail_mailboxes_created',
                    name: 'created',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: false,
                },
                {
                    id: 'mail_mailboxes_updated',
                    name: 'updated',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: true,
                },
            ],
            indexes: [
                'CREATE UNIQUE INDEX `idx_mail_mailboxes_addr_domain` ON `mail_mailboxes` (`address`, `domain`)',
                'CREATE INDEX `idx_mail_mailboxes_domain` ON `mail_mailboxes` (`domain`)',
            ],
        })
        app.save(mailboxes)

        // 3. mail_mailbox_members
        const mbMembers = new Collection({
            id: 'pbc_mail_mb_members_01',
            name: 'mail_mailbox_members',
            type: 'base',
            system: false,
            fields: [
                {
                    id: 'mail_mb_members_mailbox',
                    name: 'mailbox',
                    type: 'relation',
                    required: true,
                    collectionId: 'pbc_mail_mailboxes_01',
                    cascadeDelete: true,
                    maxSelect: 1,
                },
                {
                    id: 'mail_mb_members_user_org',
                    name: 'user_org',
                    type: 'relation',
                    required: true,
                    collectionId: 'pbc_user_org_01',
                    cascadeDelete: true,
                    maxSelect: 1,
                },
                {
                    id: 'mail_mb_members_role',
                    name: 'role',
                    type: 'select',
                    required: true,
                    values: ['owner', 'member'],
                    maxSelect: 1,
                },
                {
                    id: 'mail_mb_members_created',
                    name: 'created',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: false,
                },
                {
                    id: 'mail_mb_members_updated',
                    name: 'updated',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: true,
                },
            ],
            indexes: [
                'CREATE UNIQUE INDEX `idx_mail_mb_members_unique` ON `mail_mailbox_members` (`mailbox`, `user_org`)',
                'CREATE INDEX `idx_mail_mb_members_user_org` ON `mail_mailbox_members` (`user_org`)',
                'CREATE INDEX `idx_mail_mb_members_mailbox` ON `mail_mailbox_members` (`mailbox`)',
            ],
        })
        app.save(mbMembers)

        // 4. mail_labels
        const labels = new Collection({
            id: 'pbc_mail_labels_01',
            name: 'mail_labels',
            type: 'base',
            system: false,
            fields: [
                {
                    id: 'mail_labels_org',
                    name: 'org',
                    type: 'relation',
                    required: true,
                    collectionId: 'pbc_orgs_00001',
                    cascadeDelete: true,
                    maxSelect: 1,
                },
                {
                    id: 'mail_labels_name',
                    name: 'name',
                    type: 'text',
                    required: true,
                    min: 1,
                    max: 100,
                },
                {
                    id: 'mail_labels_color',
                    name: 'color',
                    type: 'text',
                    required: false,
                    max: 7,
                },
                {
                    id: 'mail_labels_created',
                    name: 'created',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: false,
                },
                {
                    id: 'mail_labels_updated',
                    name: 'updated',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: true,
                },
            ],
            indexes: [
                'CREATE UNIQUE INDEX `idx_mail_labels_org_name` ON `mail_labels` (`org`, `name`)',
                'CREATE INDEX `idx_mail_labels_org` ON `mail_labels` (`org`)',
            ],
        })
        app.save(labels)

        // 5. mail_threads
        const threads = new Collection({
            id: 'pbc_mail_threads_01',
            name: 'mail_threads',
            type: 'base',
            system: false,
            fields: [
                {
                    id: 'mail_threads_mailbox',
                    name: 'mailbox',
                    type: 'relation',
                    required: true,
                    collectionId: 'pbc_mail_mailboxes_01',
                    cascadeDelete: true,
                    maxSelect: 1,
                },
                {
                    id: 'mail_threads_subject',
                    name: 'subject',
                    type: 'text',
                    required: true,
                    max: 998,
                },
                {
                    id: 'mail_threads_snippet',
                    name: 'snippet',
                    type: 'text',
                    required: false,
                    max: 300,
                },
                {
                    id: 'mail_threads_message_count',
                    name: 'message_count',
                    type: 'number',
                    required: false,
                    min: 0,
                },
                {
                    id: 'mail_threads_latest_date',
                    name: 'latest_date',
                    type: 'date',
                    required: false,
                },
                {
                    id: 'mail_threads_participants',
                    name: 'participants',
                    type: 'json',
                    required: false,
                },
                {
                    id: 'mail_threads_created',
                    name: 'created',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: false,
                },
                {
                    id: 'mail_threads_updated',
                    name: 'updated',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: true,
                },
            ],
            indexes: [
                'CREATE INDEX `idx_mail_threads_mailbox_date` ON `mail_threads` (`mailbox`, `latest_date`)',
                'CREATE INDEX `idx_mail_threads_mailbox` ON `mail_threads` (`mailbox`)',
            ],
        })
        app.save(threads)

        // 6. mail_messages
        const messages = new Collection({
            id: 'pbc_mail_messages_01',
            name: 'mail_messages',
            type: 'base',
            system: false,
            fields: [
                {
                    id: 'mail_messages_thread',
                    name: 'thread',
                    type: 'relation',
                    required: true,
                    collectionId: 'pbc_mail_threads_01',
                    cascadeDelete: true,
                    maxSelect: 1,
                },
                {
                    id: 'mail_messages_message_id',
                    name: 'message_id',
                    type: 'text',
                    required: false,
                    max: 995,
                },
                {
                    id: 'mail_messages_in_reply_to',
                    name: 'in_reply_to',
                    type: 'text',
                    required: false,
                    max: 995,
                },
                {
                    id: 'mail_messages_sender_name',
                    name: 'sender_name',
                    type: 'text',
                    required: false,
                    max: 200,
                },
                {
                    id: 'mail_messages_sender_email',
                    name: 'sender_email',
                    type: 'text',
                    required: true,
                    max: 320,
                },
                {
                    id: 'mail_messages_recipients_to',
                    name: 'recipients_to',
                    type: 'json',
                    required: false,
                },
                {
                    id: 'mail_messages_recipients_cc',
                    name: 'recipients_cc',
                    type: 'json',
                    required: false,
                },
                {
                    id: 'mail_messages_date',
                    name: 'date',
                    type: 'date',
                    required: true,
                },
                {
                    id: 'mail_messages_subject',
                    name: 'subject',
                    type: 'text',
                    required: false,
                    max: 998,
                },
                {
                    id: 'mail_messages_snippet',
                    name: 'snippet',
                    type: 'text',
                    required: false,
                    max: 300,
                },
                {
                    id: 'mail_messages_has_attachments',
                    name: 'has_attachments',
                    type: 'bool',
                },
                {
                    id: 'mail_messages_body_html',
                    name: 'body_html',
                    type: 'file',
                    required: false,
                    maxSelect: 1,
                    maxSize: 5242880,
                    mimeTypes: ['text/html'],
                },
                {
                    id: 'mail_messages_attachments',
                    name: 'attachments',
                    type: 'file',
                    required: false,
                    maxSelect: 20,
                    maxSize: 26214400,
                },
                {
                    id: 'mail_messages_created',
                    name: 'created',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: false,
                },
                {
                    id: 'mail_messages_updated',
                    name: 'updated',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: true,
                },
            ],
            indexes: [
                'CREATE INDEX `idx_mail_messages_thread` ON `mail_messages` (`thread`)',
                'CREATE INDEX `idx_mail_messages_thread_date` ON `mail_messages` (`thread`, `date`)',
                'CREATE INDEX `idx_mail_messages_message_id` ON `mail_messages` (`message_id`)',
            ],
        })
        app.save(messages)

        // 7. mail_thread_state
        const threadState = new Collection({
            id: 'pbc_mail_thr_state_01',
            name: 'mail_thread_state',
            type: 'base',
            system: false,
            fields: [
                {
                    id: 'mail_thr_state_thread',
                    name: 'thread',
                    type: 'relation',
                    required: true,
                    collectionId: 'pbc_mail_threads_01',
                    cascadeDelete: true,
                    maxSelect: 1,
                },
                {
                    id: 'mail_thr_state_user_org',
                    name: 'user_org',
                    type: 'relation',
                    required: true,
                    collectionId: 'pbc_user_org_01',
                    cascadeDelete: true,
                    maxSelect: 1,
                },
                {
                    id: 'mail_thr_state_folder',
                    name: 'folder',
                    type: 'select',
                    required: true,
                    values: ['inbox', 'sent', 'drafts', 'trash', 'spam', 'archive'],
                    maxSelect: 1,
                },
                {
                    id: 'mail_thr_state_is_read',
                    name: 'is_read',
                    type: 'bool',
                },
                {
                    id: 'mail_thr_state_is_starred',
                    name: 'is_starred',
                    type: 'bool',
                },
                {
                    id: 'mail_thr_state_labels',
                    name: 'labels',
                    type: 'relation',
                    required: false,
                    collectionId: 'pbc_mail_labels_01',
                    cascadeDelete: false,
                    maxSelect: 20,
                },
                {
                    id: 'mail_thr_state_snoozed_until',
                    name: 'snoozed_until',
                    type: 'date',
                    required: false,
                },
                {
                    id: 'mail_thr_state_created',
                    name: 'created',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: false,
                },
                {
                    id: 'mail_thr_state_updated',
                    name: 'updated',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: true,
                },
            ],
            indexes: [
                'CREATE UNIQUE INDEX `idx_mail_thr_state_unique` ON `mail_thread_state` (`thread`, `user_org`)',
                'CREATE INDEX `idx_mail_thr_state_user_folder` ON `mail_thread_state` (`user_org`, `folder`)',
                'CREATE INDEX `idx_mail_thr_state_user_starred` ON `mail_thread_state` (`user_org`, `is_starred`)',
            ],
        })
        app.save(threadState)

        // Phase 2: Apply access rules now that all collections exist and back-relations resolve
        const orgMemberRule = 'org.user_org_via_org.user ?= @request.auth.id'
        // Mirrored in 1713000011_mail_domains_allow_owner.js (adminOrOwnerRule).
        // Update both when changing the mail_domains write-rule.
        const orgAdminRule =
            'org.user_org_via_org.user ?= @request.auth.id && (org.user_org_via_org.role ?= "admin" || org.user_org_via_org.role ?= "owner")'
        const mbMemberRule = 'mail_mailbox_members_via_mailbox.user_org.user ?= @request.auth.id'
        const mbOwnerRule =
            'mail_mailbox_members_via_mailbox.user_org.user ?= @request.auth.id && mail_mailbox_members_via_mailbox.role ?= "owner"'
        const mbMemberViaMailboxRule =
            'mailbox.mail_mailbox_members_via_mailbox.user_org.user ?= @request.auth.id'
        const mbMemberViaThreadRule =
            'thread.mailbox.mail_mailbox_members_via_mailbox.user_org.user ?= @request.auth.id'
        const userOrgRule = 'user_org.user = @request.auth.id'
        const threadStateCreateRule =
            'user_org.user = @request.auth.id && thread.mailbox.mail_mailbox_members_via_mailbox.user_org.user ?= @request.auth.id'

        function setRules(collection, { list, view, create, update, del }) {
            collection.listRule = list
            collection.viewRule = view
            collection.createRule = create
            collection.updateRule = update
            collection.deleteRule = del
        }

        // mail_domains: any org member can read, only admins can mutate
        const domainsCol = app.findCollectionByNameOrId('mail_domains')
        setRules(domainsCol, {
            list: orgMemberRule,
            view: orgMemberRule,
            create: orgAdminRule,
            update: orgAdminRule,
            del: orgAdminRule,
        })
        app.save(domainsCol)

        // mail_mailboxes: members can read, org members can create, owners can mutate
        const mailboxesCol = app.findCollectionByNameOrId('mail_mailboxes')
        setRules(mailboxesCol, {
            list: mbMemberRule,
            view: mbMemberRule,
            create: 'domain.org.user_org_via_org.user ?= @request.auth.id',
            update: mbOwnerRule,
            del: mbOwnerRule,
        })
        app.save(mailboxesCol)

        // mail_mailbox_members: own records readable, only mailbox owners can add/modify members.
        // Two paths permit a create:
        //   (1) ownerCanAdd — an existing owner of the mailbox adds any user_org from the
        //       owning org. Cross-org adds are blocked by `user_org.org = mailbox.domain.org`.
        //   (2) bootstrapFirstOwner — when a mailbox has no members yet, an org member may
        //       self-insert as the first owner. Without this, the very first owner could never
        //       be added because the owner-check chain resolves to an empty set on a freshly
        //       created mailbox.
        // Mirrored in 1713000017_mail_mailbox_members_owner_adds_member.js.
        const mbMembersCol = app.findCollectionByNameOrId('mail_mailbox_members')
        const ownerCanAdd =
            'mailbox.mail_mailbox_members_via_mailbox.user_org.user ?= @request.auth.id && mailbox.mail_mailbox_members_via_mailbox.role ?= "owner" && user_org.org = mailbox.domain.org'
        const bootstrapFirstOwner =
            'user_org.user = @request.auth.id && role = "owner" && mailbox.mail_mailbox_members_via_mailbox.id = "" && mailbox.domain.org.user_org_via_org.user ?= @request.auth.id'
        setRules(mbMembersCol, {
            list: userOrgRule,
            view: userOrgRule,
            create: `(${ownerCanAdd}) || (${bootstrapFirstOwner})`,
            update: 'mailbox.mail_mailbox_members_via_mailbox.user_org.user ?= @request.auth.id && mailbox.mail_mailbox_members_via_mailbox.role ?= "owner"',
            del: userOrgRule,
        })
        app.save(mbMembersCol)

        const labelsCol = app.findCollectionByNameOrId('mail_labels')
        setRules(labelsCol, {
            list: orgMemberRule,
            view: orgMemberRule,
            create: orgMemberRule,
            update: orgMemberRule,
            del: orgMemberRule,
        })
        app.save(labelsCol)

        const threadsCol = app.findCollectionByNameOrId('mail_threads')
        setRules(threadsCol, {
            list: mbMemberViaMailboxRule,
            view: mbMemberViaMailboxRule,
            create: mbMemberViaMailboxRule,
            update: mbMemberViaMailboxRule,
            del: mbMemberViaMailboxRule,
        })
        app.save(threadsCol)

        const messagesCol = app.findCollectionByNameOrId('mail_messages')
        setRules(messagesCol, {
            list: mbMemberViaThreadRule,
            view: mbMemberViaThreadRule,
            create: mbMemberViaThreadRule,
            update: mbMemberViaThreadRule,
            del: mbMemberViaThreadRule,
        })
        app.save(messagesCol)

        // mail_thread_state: own records only, but create requires mailbox membership
        const threadStateCol = app.findCollectionByNameOrId('mail_thread_state')
        setRules(threadStateCol, {
            list: userOrgRule,
            view: userOrgRule,
            create: threadStateCreateRule,
            update: userOrgRule,
            del: userOrgRule,
        })
        app.save(threadStateCol)
    },
    app => {
        const collections = [
            'mail_thread_state',
            'mail_messages',
            'mail_threads',
            'mail_labels',
            'mail_mailbox_members',
            'mail_mailboxes',
            'mail_domains',
        ]
        for (const name of collections) {
            const collection = app.findCollectionByNameOrId(name)
            app.delete(collection)
        }
    }
)
