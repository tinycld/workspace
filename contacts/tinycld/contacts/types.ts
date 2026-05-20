import type { UserOrg } from '@tinycld/core/types/pbSchema'

export interface Contacts {
    id: string
    first_name: string
    last_name: string
    email: string
    phone: string
    company: string
    job_title: string
    favorite: boolean
    owner: string
    notes: string
    vcard_uid: string
    deleted_at: string
    created: string
    updated: string
}

export type ContactsSchema = {
    contacts: {
        type: Contacts
        relations: {
            owner: UserOrg
        }
    }
}
