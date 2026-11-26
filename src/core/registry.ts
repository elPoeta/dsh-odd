import { readFile, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { parse } from 'yaml'
import { SKILL_PATH_TOKENS, skillFor, type OddConfig } from './config'
import { NAME_RE } from './task'

/**
 * Skill registry. Follows DSH's own discovery contract (dsh-skill-filesystem):
 * single-level `<name>/SKILL.md` bundles or flat `<name>.md` files, kebab-case
 * names, `name` + `description` frontmatter, no nested discovery.
 * Progressive disclosure: the index keeps name + description only; the body is
 * read from disk when a skill is actually loaded.
 */

export type Severity = 'error' | 'warning'
export interface SkillIssue { severity: Severity; code: string; message: string; path?: string }

export interface SkillEntry {
  /** Lookup key: the frontmatter name when valid, else the directory/file name. */
  key: string
  name: string
  description: string
  path: string
  format: 'bundle' | 'flat'
  /** Raw skills_paths pattern (or "builtin") this entry was found under. */
  source: string
  rootIndex: number
  valid: boolean
  issues: SkillIssue[]
}

export interface RootInfo { source: string; dir: string; exists: boolean }
export interface Registry { roots: RootInfo[]; entries: SkillEntry[]; byName: Map<string, SkillEntry[]> }

export interface ScanOptions {
  builtinDirs?: string[]
  env?: Record<string, string | undefined>
  home?: string
}

export class SkillError extends Error {}

const isDir = (p: string) => stat(p).then((s) => s.isDirectory(), () => false)
const isFile = (p: string) => stat(p).then((s) => s.isFile(), () => false)

/** Nearest ancestor containing .git (dir or file), else cwd. Same rule as DSH. */
export async function findProjectRoot(cwd: string): Promise<string> {
  let dir = resolve(cwd)
  for (;;) {
    if (await stat(join(dir, '.git')).then(() => true, () => false)) return dir
    const up = dirname(dir)
    if (up === dir) return resolve(cwd)
    dir = up
  }
}

export function expandPattern(pattern: string, ctx: { cwd: string; projectRoot: string; env: Record<string, string | undefined>; home: string }): string {
  const tokens: Record<string, string> = {
    project: ctx.projectRoot,
    dsh_home: ctx.env.DSH_HOME || join(ctx.home, '.dsh'),
    agents_home: ctx.env.DSH_AGENTS_HOME || join(ctx.home, '.agents'),
  }
  let out = pattern.replace(/\{(\w+)\}/g, (_, t: string) => {
    if (!SKILL_PATH_TOKENS.includes(t)) throw new Error(`Unknown token {${t}} in skills_paths`)
    return tokens[t]!
  })
  if (out === '~' || out.startsWith('~/')) out = join(ctx.home, out.slice(1))
  return isAbsolute(out) ? out : resolve(ctx.cwd, out)
}

const FM_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/

function splitFrontmatter(text: string): { fm?: Record<string, unknown>; body: string; error?: string } {
  const m = FM_RE.exec(text.replace(/\r\n/g, '\n'))
  if (!m) return { body: text, error: 'no-frontmatter' }
  try {
    const fm = parse(m[1] ?? '')
    if (fm === null || typeof fm !== 'object' || Array.isArray(fm)) return { body: m[2] ?? '', error: 'bad-frontmatter' }
    return { fm: fm as Record<string, unknown>, body: m[2] ?? '' }
  } catch (e) {
    return { body: m[2] ?? '', error: `bad-frontmatter: ${(e as Error).message.split('\n')[0]}` }
  }
}

async function readEntry(path: string, derived: string, format: SkillEntry['format'], source: string, rootIndex: number): Promise<SkillEntry> {
  const issues: SkillIssue[] = []
  const add = (severity: Severity, code: string, message: string) => issues.push({ severity, code, message, path })
  const { fm, error } = splitFrontmatter(await readFile(path, 'utf8'))
  let name = derived
  let description = ''
  let nameValid = true
  if (error || !fm) {
    add('error', error?.startsWith('bad') ? 'bad-frontmatter' : 'no-frontmatter', error?.startsWith('bad') ? `Unparseable frontmatter (${error})` : 'Missing YAML frontmatter')
  } else {
    if (fm.name === undefined) add('warning', 'missing-name', `No "name" in frontmatter; using "${derived}"`)
    else if (typeof fm.name !== 'string' || !NAME_RE.test(fm.name)) {
      nameValid = false
      add('error', 'invalid-name', `Name ${JSON.stringify(fm.name)} must be lowercase letters, digits and hyphens (DSH rejects others)`)
    } else {
      name = fm.name
      if (name !== derived) add('warning', 'name-mismatch', `Frontmatter name "${name}" differs from ${format === 'bundle' ? 'directory' : 'file'} name "${derived}"; ODD resolves by frontmatter name`)
    }
    if (typeof fm.description !== 'string' || !fm.description.trim()) add('error', 'missing-description', 'Missing or empty "description" (needed for the catalog)')
    else {
      description = fm.description.trim()
      if (description.length > 1024) add('warning', 'long-description', `Description is ${description.length} characters; hosts cap catalog descriptions`)
    }
  }
  return {
    key: nameValid ? name : derived, name, description, path, format, source, rootIndex,
    valid: !issues.some((i) => i.severity === 'error'), issues,
  }
}

async function scanRoot(dir: string, source: string, rootIndex: number): Promise<SkillEntry[]> {
  const out: SkillEntry[] = []
  for (const name of (await readdir(dir)).sort()) {
    if (name.startsWith('.')) continue
    const full = join(dir, name)
    if (await isDir(full)) {
      const file = join(full, 'SKILL.md')
      if (await isFile(file)) out.push(await readEntry(file, name, 'bundle', source, rootIndex))
    } else if (name.endsWith('.md') && !/^(readme|skill)\.md$/i.test(name) && (await isFile(full))) {
      out.push(await readEntry(full, name.slice(0, -3), 'flat', source, rootIndex))
    }
  }
  return out
}

export async function scanRegistry(cwd: string, cfg: OddConfig, opts: ScanOptions = {}): Promise<Registry> {
  const env = opts.env ?? process.env
  const home = opts.home ?? homedir()
  const projectRoot = await findProjectRoot(cwd)
  const patterns = [
    ...cfg.skills_paths.map((p) => ({ source: p, dir: expandPattern(p, { cwd, projectRoot, env, home }) })),
    ...(opts.builtinDirs ?? []).map((d) => ({ source: 'builtin', dir: resolve(d) })),
  ]
  const seen = new Set<string>()
  const roots: RootInfo[] = []
  const entries: SkillEntry[] = []
  for (const { source, dir } of patterns) {
    if (seen.has(dir)) continue // same directory reached through two patterns
    seen.add(dir)
    const exists = await isDir(dir)
    roots.push({ source, dir, exists })
    if (exists) entries.push(...(await scanRoot(dir, source, roots.length - 1)))
  }
  entries.sort((a, b) => a.rootIndex - b.rootIndex || (a.format === b.format ? a.path.localeCompare(b.path) : a.format === 'bundle' ? -1 : 1))

  const byName = new Map<string, SkillEntry[]>()
  for (const e of entries) byName.set(e.key, [...(byName.get(e.key) ?? []), e])
  for (const group of byName.values()) {
    if (group.length < 2) continue
    const winner = group[0]!
    for (const e of group) {
      if (e !== winner && e.rootIndex === winner.rootIndex) {
        for (const x of [winner, e]) if (!x.issues.some((i) => i.code === 'ambiguous')) {
          x.issues.push({ severity: 'error', code: 'ambiguous', message: `Two skills named "${x.key}" in the same root (bundle and flat file); remove one`, path: x.path })
          x.valid = false
        }
      } else if (e !== winner) {
        e.issues.push({ severity: 'warning', code: 'shadowed', message: `Shadowed by "${winner.source}" (${winner.path})`, path: e.path })
      }
    }
  }
  return { roots, entries, byName }
}

/**
 * Highest-precedence candidate wins, valid or not. If it is invalid we FAIL
 * instead of silently falling back to a lower-precedence skill: a broken
 * project override must be fixed, not hidden.
 */
export function resolveSkill(reg: Registry, name: string): SkillEntry {
  const first = reg.byName.get(name)?.[0]
  if (!first) {
    const where = reg.roots.map((r) => `- ${r.dir} (${r.source})${r.exists ? '' : ' [missing]'}`).join('\n')
    throw new SkillError(`Skill "${name}" not found. Searched:\n${where}`)
  }
  if (!first.valid) {
    const why = first.issues.filter((i) => i.severity === 'error').map((i) => `- ${i.message}`).join('\n')
    throw new SkillError(`Skill "${name}" resolves to an invalid skill (${first.path}):\n${why}`)
  }
  return first
}

export interface LoadedSkill { name: string; source: string; path: string; text: string }

/** Reads the body at load time (progressive disclosure) and strips the frontmatter. */
export async function readSkillBody(entry: SkillEntry): Promise<string> {
  return splitFrontmatter(await readFile(entry.path, 'utf8')).body.trim()
}

export async function loadResolvedSkill(cwd: string, cfg: OddConfig, name: string, opts: ScanOptions = {}): Promise<LoadedSkill> {
  const entry = resolveSkill(await scanRegistry(cwd, cfg, opts), name)
  return { name: entry.name, source: entry.source, path: entry.path, text: await readSkillBody(entry) }
}

// ------------------------------------------------------------------ doctor

export interface CheckReport { errors: number; warnings: number; issues: SkillIssue[] }

export function checkRegistry(reg: Registry, cfg: OddConfig): CheckReport {
  const issues: SkillIssue[] = reg.entries.flatMap((e) => e.issues)
  const phases = [...new Set(Object.values(cfg.workflows).flat())]
  for (const phase of phases) {
    const dispatched = Boolean(cfg.dispatch[phase])
    const skillName = skillFor(cfg, phase)
    const first = reg.byName.get(skillName)?.[0]
    if (!first) {
      issues.push({
        severity: dispatched ? 'error' : 'warning', code: 'missing-skill',
        message: `Phase "${phase}" has no skill${skillName !== phase ? ` "${skillName}"` : ''}${dispatched ? ' (it is dispatched to a subagent, which needs the skill text)' : ' (the agent would run it without instructions)'}`,
      })
    } else if (!first.valid) {
      issues.push({ severity: 'error', code: 'phase-skill-invalid', message: `Phase "${phase}" resolves to an invalid skill`, path: first.path })
    }
  }
  return {
    errors: issues.filter((i) => i.severity === 'error').length,
    warnings: issues.filter((i) => i.severity === 'warning').length,
    issues,
  }
}

// ---------------------------------------------------------------- formatting

export function formatSkillList(reg: Registry): string {
  const winners = [...reg.byName.values()].map((g) => g[0]!).sort((a, b) => a.key.localeCompare(b.key))
  if (!winners.length) return 'No skills found.\n' + reg.roots.map((r) => `- ${r.dir}${r.exists ? '' : ' [missing]'}`).join('\n')
  const lines = winners.map((e) => {
    const n = (reg.byName.get(e.key)?.length ?? 1) - 1
    return `- ${e.key}${e.valid ? '' : ' [INVALID]'}  (${e.source})${n ? `  +${n} shadowed` : ''}\n    ${e.description || '(no description)'}`
  })
  return lines.join('\n')
}

export function formatCheck(r: CheckReport): string {
  if (!r.issues.length) return 'Skill registry OK: no issues.'
  const head = `${r.errors} error(s), ${r.warnings} warning(s)`
  return head + '\n' + r.issues.map((i) => `- [${i.severity}] ${i.code}: ${i.message}${i.path ? `\n    ${i.path}` : ''}`).join('\n')
}
