export interface AllResult {
    exitCode: number
    results: { target: string; code: number }[]
}

// Run `run(target)` for each target. Aggregate by default (run all, non-zero
// if any failed). bail stops at the first failure.
export async function runAll(
    targets: string[],
    run: (target: string) => Promise<number>,
    opts: { bail: boolean }
): Promise<AllResult> {
    const results: { target: string; code: number }[] = []
    for (const target of targets) {
        const code = await run(target)
        results.push({ target, code })
        if (code !== 0 && opts.bail) break
    }
    const exitCode = results.some(r => r.code !== 0) ? 1 : 0
    return { exitCode, results }
}
