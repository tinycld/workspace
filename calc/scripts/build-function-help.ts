#!/usr/bin/env tsx
// Regenerates calc/help/functions.md from FUNCTION_CATALOG. Run when
// bumping the hyperformula dep or editing descriptions in the catalog.
//
//   tsx calc/scripts/build-function-help.ts
//
// The catalog is curated, not auto-scraped — refresh by editing
// lib/formula/function-catalog.ts against
// https://hyperformula.handsontable.com/guide/built-in-functions.html
// for the matching HF version.
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FUNCTION_CATALOG } from '../tinycld/calc/lib/formula/function-catalog.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = join(HERE, '..', 'help', 'functions.md')

function escapePipes(s: string): string {
    return s.replace(/\|/g, '\\|')
}

function renderCategory(title: string, entries: typeof FUNCTION_CATALOG[number]['entries']): string {
    const rows = entries
        .map(e => `| \`${escapePipes(e.name)}\` | ${escapePipes(e.description)} | \`${escapePipes(e.syntax)}\` |`)
        .join('\n')
    return [
        `## ${title}`,
        '',
        '| Function | Description | Syntax |',
        '| --- | --- | --- |',
        rows,
        '',
    ].join('\n')
}

const totalCount = FUNCTION_CATALOG.reduce((n, c) => n + c.entries.length, 0)

const frontmatter = [
    '---',
    'title: Function list',
    'summary: Every built-in formula function, grouped by category',
    'tags: [formula, functions, reference]',
    'order: 35',
    '---',
].join('\n')

const intro = [
    '',
    `Calc ships with ${totalCount} built-in functions, grouped below by category. Use your browser's find (**⌘F**) to jump to a specific name, or open the help search palette with **⌘/** and type the function name.`,
    '',
    'See [Formulas and functions](help://calc:formulas) for how to write a formula, reference cells, and read errors.',
    '',
    'Functions and descriptions come from the underlying [HyperFormula](https://hyperformula.handsontable.com/) engine.',
    '',
    '',
].join('\n')

const body = FUNCTION_CATALOG.map(c => renderCategory(c.title, c.entries)).join('\n')

const output = `${frontmatter}\n${intro}${body}`
writeFileSync(OUT, output)
console.log(`Wrote ${OUT} — ${totalCount} functions across ${FUNCTION_CATALOG.length} categories.`)
