import { spawn } from 'node:child_process'
import type { Command } from './runners'

// Run a Command via the workspace .bin (resolved from the PATH npm sets for
// member scripts). Inherit stdio. Resolve with the exit code.
export function runCommand(cmd: Command): Promise<number> {
    return new Promise(resolve => {
        const child = spawn(cmd.bin, cmd.args, { cwd: cmd.cwd, stdio: 'inherit', shell: false })
        child.on('exit', code => resolve(code ?? 1))
        child.on('error', () => resolve(1))
    })
}
