import { ContactSuggestionsProvider } from '@tinycld/core/lib/contacts/use-contact-suggestions'
import { type ContactSuggestion, filterContactSuggestions } from '../hooks/useRecipientSuggestions'
import { RecipientSuggestionList } from './RecipientSuggestionList'

interface ContactSuggestionsListProps {
    activeQuery: string
    committedEmails: Set<string>
    onSelect: (contact: ContactSuggestion) => void
}

/**
 * Renders a filtered dropdown of contact suggestions for the recipient
 * input. The data subscription + runtime package gate live in core's
 * ContactSuggestionsProvider; this component just filters + renders.
 */
export function ContactSuggestionsList({ activeQuery, committedEmails, onSelect }: ContactSuggestionsListProps) {
    return (
        <ContactSuggestionsProvider>
            {(contacts) => {
                const suggestions = filterContactSuggestions(contacts, activeQuery, committedEmails)
                if (suggestions.length === 0) return null
                return <RecipientSuggestionList suggestions={suggestions} query={activeQuery} onSelect={onSelect} />
            }}
        </ContactSuggestionsProvider>
    )
}
