import { readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

export interface LoadedSkill { name: string; path: string; text: string }

const exists = (p: string) => stat(p).then((s) => s.isFile(), () => false)

export function expandPath(p: string, cwd: string): string {
  if (p === '~' || p.startsWith('~/')) return join(homedir(), p.slice(1))
  return isAbsolute(p) ? p : resolve(cwd, p)
}

/**
 * Minimal resolver: first match wins along `paths` (project > user > built-in).
 * Phase 3 replaces this with a validated, indexed registry.
 */
export async function loadSkill(name: string, paths: string[], cwd: string): Promise<LoadedSkill> {
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(name)) throw new Error(`Invalid skill name "${name}"`)
  const tried: string[] = []
  for (const base of paths) {
    const dir = expandPath(base, cwd)
    for (const candidate of [join(dir, name, 'SKILL.md'), join(dir, `${name}.md`)]) {
      tried.push(candidate)
      if (await exists(candidate)) return { name, path: candidate, text: await readFile(candidate, 'utf8') }
    }
  }
  throw new Error(`Skill "${name}" not found. Searched:\n${tried.map((t) => `- ${t}`).join('\n')}`)
}
