import { registerAll } from './host/adapter'

export const name = 'dsh-odd'
// Hard dependencies only. Both are provided by the shipped @deepseek-ai/dsh-base bundle.
export const inject = ['commands', 'tools']

export interface Config { rootDir?: string; cwd?: string }

// TODO(verify): wrap registrations in ctx.effect(() => disposer) once the
// disposer shape returned by register() is confirmed, so they unwind on unload.
export function apply(ctx: any, config: Config = {}) {
  registerAll(ctx, { cwd: config.cwd ?? process.cwd(), rootDir: config.rootDir ?? '.odd' })
}
