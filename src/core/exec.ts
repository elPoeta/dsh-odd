import { exec as cpExec } from 'node:child_process'

export interface ExecResult { code: number; output: string }
export type ExecFn = (command: string, cwd: string) => Promise<ExecResult>

/** Runs a project-configured shell command. Commands come from trusted .odd/config.yml. */
export const defaultExec: ExecFn = (command, cwd) =>
  new Promise((resolve) => {
    cpExec(command, { cwd, timeout: 10 * 60_000, maxBuffer: 20 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? ((err as { code: number }).code) : 1) : 0
      resolve({ code, output: stdout + (stderr ? `\n${stderr}` : '') })
    })
  })
