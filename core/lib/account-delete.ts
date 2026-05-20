import { pb } from '@tinycld/core/lib/pocketbase'

export async function deleteMyAccount(emailConfirmation: string): Promise<void> {
    await pb.send('/api/account/delete', {
        method: 'POST',
        body: JSON.stringify({ email: emailConfirmation }),
        headers: { 'Content-Type': 'application/json' },
    })
}
