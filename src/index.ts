import { fileURLToPath } from 'node:url'
import { registerAll } from './host/adapter'

export const name = 'dsh-odd'
// Hard dependencies only. Both are provided by the shipped @deepseek-ai/dsh-base bundle.
export const inject = ['commands', 'tools']

export interface Config { rootDir?: string; cwd?: string }

// Registrations are wrapped in ctx.effect inside the adapter, so they unload with the plugin.
export function apply(ctx: any, config: Config = {}) {
  // dist/index.js -> ../skills (the plugin's own skills, lowest precedence)
  const builtin = fileURLToPath(new URL('../skills', import.meta.url))
  // cwd is only an explicit override; otherwise the project is resolved per call from the session.
  registerAll(ctx, { cwd: config.cwd, rootDir: config.rootDir ?? '.odd', builtinDirs: [builtin] })
}
