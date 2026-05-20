// Mirrors coreserver/usernames.go::DeriveUsername and the parity-tested JS
// migration in pb_migrations/1820000000_users_username_required.js. Keep the
// three implementations behaviorally identical — the Go test
// TestDeriveUsername is the contract.

const NON_USERNAME_CHAR = /[^a-z0-9_-]/g

export function deriveUsername(email: string) {
    const at = email.indexOf('@')
    const prefix = (at >= 0 ? email.slice(0, at) : email).toLowerCase()
    const cleaned = prefix.replace(NON_USERNAME_CHAR, '')
    return cleaned.length >= 3 ? cleaned : 'user'
}
