/// <reference path="../../../server/pb_data/types.d.ts" />
migrate(
    app => {
        const isCreator = 'created_by.user ?= @request.auth.id'
        const hasShare = 'drive_shares_via_item.user_org.user ?= @request.auth.id'
        const canView = `${isCreator} || ${hasShare}`
        const canEdit = `${isCreator} || (${hasShare} && drive_shares_via_item.role ?!= "viewer")`
        const orgMemberRule = 'org.user_org_via_org.user ?= @request.auth.id'

        const itemsCol = app.findCollectionByNameOrId('drive_items')
        itemsCol.listRule = canView
        itemsCol.viewRule = canView
        itemsCol.createRule = orgMemberRule
        itemsCol.updateRule = canEdit
        itemsCol.deleteRule = isCreator
        app.save(itemsCol)

        // drive_shares: creator of the item can manage shares, recipients can view their own
        const ownShareRecipient = 'user_org.user = @request.auth.id'
        const isItemCreator = 'item.created_by.user ?= @request.auth.id'

        const sharesCol = app.findCollectionByNameOrId('drive_shares')
        sharesCol.listRule = `${ownShareRecipient} || ${isItemCreator}`
        sharesCol.viewRule = `${ownShareRecipient} || ${isItemCreator}`
        sharesCol.createRule = isItemCreator
        sharesCol.updateRule = isItemCreator
        sharesCol.deleteRule = `${ownShareRecipient} || ${isItemCreator}`
        app.save(sharesCol)

        // drive_item_state: own records only, create if creator or has share
        const ownRecordRule = 'user_org.user = @request.auth.id'
        const stateCol = app.findCollectionByNameOrId('drive_item_state')
        stateCol.listRule = ownRecordRule
        stateCol.viewRule = ownRecordRule
        stateCol.createRule = `${ownRecordRule} && (${isItemCreator} || item.drive_shares_via_item.user_org.user ?= @request.auth.id)`
        stateCol.updateRule = ownRecordRule
        stateCol.deleteRule = ownRecordRule
        app.save(stateCol)
    },
    app => {
        // Revert to share-only rules
        const hasShare = 'drive_shares_via_item.user_org.user ?= @request.auth.id'
        const isOwnerOrEditor = `${hasShare} && drive_shares_via_item.role ?!= "viewer"`
        const isOwner = `${hasShare} && drive_shares_via_item.role ?= "owner"`
        const orgMemberRule = 'org.user_org_via_org.user ?= @request.auth.id'

        const itemsCol = app.findCollectionByNameOrId('drive_items')
        itemsCol.listRule = hasShare
        itemsCol.viewRule = hasShare
        itemsCol.createRule = orgMemberRule
        itemsCol.updateRule = isOwnerOrEditor
        itemsCol.deleteRule = isOwner
        app.save(itemsCol)

        const ownShareRecipient = 'user_org.user = @request.auth.id'
        const isItemOwner =
            'item.drive_shares_via_item.user_org.user ?= @request.auth.id && item.drive_shares_via_item.role ?= "owner"'

        const sharesCol = app.findCollectionByNameOrId('drive_shares')
        sharesCol.listRule = ownShareRecipient
        sharesCol.viewRule = ownShareRecipient
        sharesCol.createRule = isItemOwner
        sharesCol.updateRule = isItemOwner
        sharesCol.deleteRule = `${ownShareRecipient} || ${isItemOwner}`
        app.save(sharesCol)

        const ownRecordRule = 'user_org.user = @request.auth.id'
        const stateCol = app.findCollectionByNameOrId('drive_item_state')
        stateCol.listRule = ownRecordRule
        stateCol.viewRule = ownRecordRule
        stateCol.createRule = `${ownRecordRule} && item.drive_shares_via_item.user_org.user ?= @request.auth.id`
        stateCol.updateRule = ownRecordRule
        stateCol.deleteRule = ownRecordRule
        app.save(stateCol)
    }
)
