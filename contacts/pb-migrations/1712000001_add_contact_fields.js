/// <reference path="../../../server/pb_data/types.d.ts" />
migrate(
    app => {
        const collection = app.findCollectionByNameOrId('contacts')

        // Migrate existing name data: split at first space into first_name + last_name
        const records = app.findRecordsByFilter('contacts', '1=1')
        const nameMap = {}
        for (const record of records) {
            const name = record.get('name') || ''
            const spaceIndex = name.indexOf(' ')
            nameMap[record.id] = {
                first_name: spaceIndex > -1 ? name.substring(0, spaceIndex) : name,
                last_name: spaceIndex > -1 ? name.substring(spaceIndex + 1) : '',
            }
        }

        // Remove old name field
        collection.fields.removeByName('name')

        // Add new fields
        collection.fields.add(
            new TextField({ name: 'first_name', required: true, min: 1, max: 100 })
        )
        collection.fields.add(new TextField({ name: 'last_name', required: false, max: 100 }))
        collection.fields.add(new TextField({ name: 'company', required: false, max: 200 }))
        collection.fields.add(new TextField({ name: 'job_title', required: false, max: 200 }))
        collection.fields.add(new BoolField({ name: 'favorite' }))

        // Update indexes
        collection.indexes = [
            'CREATE INDEX `idx_contacts_owner` ON `contacts` (`owner`)',
            'CREATE INDEX `idx_contacts_first_name` ON `contacts` (`first_name`)',
            'CREATE INDEX `idx_contacts_last_name` ON `contacts` (`last_name`)',
        ]

        app.save(collection)

        // Populate new fields from old name data
        for (const record of records) {
            const names = nameMap[record.id]
            if (names) {
                record.set('first_name', names.first_name)
                record.set('last_name', names.last_name)
                app.save(record)
            }
        }
    },
    app => {
        const collection = app.findCollectionByNameOrId('contacts')

        // Recombine first_name + last_name into name
        const records = app.findRecordsByFilter('contacts', '1=1')
        const nameMap = {}
        for (const record of records) {
            const first = record.get('first_name') || ''
            const last = record.get('last_name') || ''
            nameMap[record.id] = `${first} ${last}`.trim()
        }

        // Remove new fields
        collection.fields.removeByName('first_name')
        collection.fields.removeByName('last_name')
        collection.fields.removeByName('company')
        collection.fields.removeByName('job_title')
        collection.fields.removeByName('favorite')

        // Re-add name field
        collection.fields.add(new TextField({ name: 'name', required: true, min: 1, max: 200 }))

        // Restore indexes
        collection.indexes = [
            'CREATE INDEX `idx_contacts_owner` ON `contacts` (`owner`)',
            'CREATE INDEX `idx_contacts_name` ON `contacts` (`name`)',
        ]

        app.save(collection)

        // Restore name data
        for (const record of records) {
            const name = nameMap[record.id]
            if (name) {
                record.set('name', name)
                app.save(record)
            }
        }
    }
)
