import type { HelpTopic } from './types'

export interface HelpSearchResult {
    topic: HelpTopic
    score: number
}

// Scoring weights. Word-start matches feel like "the user typed the
// start of a word they remembered" and outrank mid-word hits.
// Title > tags > summary > body, matching scan-priority.
const TITLE_WORD_START = 100
const TITLE_SUBSTRING = 50
const TAG_WORD_START = 25
const TAG_SUBSTRING = 12
const SUMMARY_WORD_START = 20
const SUMMARY_SUBSTRING = 10
// Body is high-recall, low-precision — no word-start tier; a single
// flat weight keeps body hits as a tiebreaker without letting a long
// body of text swamp a clean title match.
const BODY_SUBSTRING = 1

// True when `term` occurs in `haystack` at the start of a word.
// A "word boundary" is the string start or any non-alphanumeric char.
function hasWordStartMatch(haystack: string, term: string): boolean {
    if (haystack.startsWith(term)) return true
    let i = haystack.indexOf(term)
    while (i > 0) {
        const prev = haystack.charCodeAt(i - 1)
        const isAlnum =
            (prev >= 48 && prev <= 57) || (prev >= 65 && prev <= 90) || (prev >= 97 && prev <= 122)
        if (!isAlnum) return true
        i = haystack.indexOf(term, i + 1)
    }
    return false
}

// Score a single term against a single haystack with two-tier weights.
// Returns 0 when the term doesn't appear at all.
function matchScore(
    haystack: string,
    term: string,
    wordStartWeight: number,
    midWordWeight: number
): number {
    if (!haystack.includes(term)) return 0
    return hasWordStartMatch(haystack, term) ? wordStartWeight : midWordWeight
}

// Substring + tag match across title, tags, summary, body.
// Multi-term queries require every term to match SOMEWHERE per topic.
// Empty/whitespace query returns every topic with score 0 in input order.
export function searchHelpTopics(topics: HelpTopic[], rawQuery: string): HelpSearchResult[] {
    const query = rawQuery.trim().toLowerCase()
    if (!query) return topics.map(topic => ({ topic, score: 0 }))

    const terms = query.split(/\s+/).filter(Boolean)
    const results: HelpSearchResult[] = []

    for (const topic of topics) {
        const title = topic.title.toLowerCase()
        const summary = topic.summary.toLowerCase()
        const tags = topic.tags.map(t => t.toLowerCase())
        const body = topic.body.toLowerCase()

        let score = 0
        let allMatched = true
        for (const term of terms) {
            let termScore = 0
            termScore += matchScore(title, term, TITLE_WORD_START, TITLE_SUBSTRING)
            let tagScore = 0
            for (const tag of tags) {
                const t = matchScore(tag, term, TAG_WORD_START, TAG_SUBSTRING)
                if (t > tagScore) tagScore = t
            }
            termScore += tagScore
            termScore += matchScore(summary, term, SUMMARY_WORD_START, SUMMARY_SUBSTRING)
            if (body.includes(term)) termScore += BODY_SUBSTRING
            if (termScore === 0) {
                allMatched = false
                break
            }
            score += termScore
        }
        if (allMatched) results.push({ topic, score })
    }

    results.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score
        return a.topic.title.localeCompare(b.topic.title, undefined, { sensitivity: 'base' })
    })
    return results
}
