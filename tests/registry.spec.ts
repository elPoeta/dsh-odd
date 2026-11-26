import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, mergeConfig } from '../src/core/config'
import {
  SkillError, checkRegistry, expandPattern, findProjectRoot, formatCheck, formatSkillList,
  loadResolvedSkill, readSkillBody, resolveSkill, scanRegistry,
} from '../src/core/registry'

let base: string, proj: string, home: string
const env = {} as Record<string, string | undefined>

const skill = (name: string, description = `does ${name}`, body = `BODY of ${name}`) =>
  `---\nname: ${name}\ndescription: ${description}\n---\n${body}\n`

async function put(root: string, rel: string, content: string) {
  const file = join(root, rel)
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, content)
}
const scan = (cfg = DEFAULT_CONFIG, extra = {}) => scanRegistry(proj, cfg, { env, home, ...extra })

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'odd-r-'))
  proj = join(base, 'proj'); home = join(base, 'home')
  await mkdir(join(proj, '.git'), { recursive: true })
  await mkdir(home, { recursive: true })
})
afterEach(() => rm(base, { recursive: true, force: true }))

describe('discovery (DSH contract)', () => {
  it('finds bundles and flat files in every default root and reports the source', async () => {
    await put(proj, '.odd/skills/story/SKILL.md', skill('story'))
    await put(proj, '.agents/skills/pair.md', skill('pair'))
    await put(proj, '.dsh/skills/fix/SKILL.md', skill('fix'))
    await put(home, '.dsh/skills/grill/SKILL.md', skill('grill'))
    await put(home, '.agents/skills/ship/SKILL.md', skill('ship'))
    const reg = await scan()
    const src = Object.fromEntries([...reg.byName].map(([k, v]) => [k, v[0]!.source]))
    expect(src).toEqual({
      story: '.odd/skills', pair: '{project}/.agents/skills', fix: '{project}/.dsh/skills',
      grill: '{dsh_home}/skills', ship: '{agents_home}/skills',
    })
    expect(reg.entries.find((e) => e.key === 'pair')!.format).toBe('flat')
  })

  it('ignores nested skills, hidden entries, README and dirs without SKILL.md', async () => {
    await put(proj, '.odd/skills/group/inner/SKILL.md', skill('inner'))
    await put(proj, '.odd/skills/.hidden/SKILL.md', skill('hidden'))
    await put(proj, '.odd/skills/README.md', '# docs')
    await put(proj, '.odd/skills/empty/notes.txt', 'x')
    expect((await scan()).entries).toEqual([])
  })

  it('honours DSH_HOME / DSH_AGENTS_HOME and {project} = nearest .git ancestor', async () => {
    const custom = join(base, 'custom-dsh')
    await put(custom, 'skills/grill/SKILL.md', skill('grill'))
    const sub = join(proj, 'packages', 'app')
    await mkdir(sub, { recursive: true })
    await put(proj, '.agents/skills/pair/SKILL.md', skill('pair'))
    expect(await findProjectRoot(sub)).toBe(proj)
    const reg = await scanRegistry(sub, DEFAULT_CONFIG, { env: { DSH_HOME: custom }, home })
    expect([...reg.byName.keys()].sort()).toEqual(['grill', 'pair'])   // pair found from a subdirectory via the git root
    expect(expandPattern('~/x', { cwd: sub, projectRoot: proj, env: {}, home })).toBe(join(home, 'x'))
  })

  it('rejects unknown tokens in config', () => {
    expect(() => mergeConfig({ skills_paths: ['{nope}/skills'] })).toThrow(/Unknown token/)
  })

  it('keeps working with phase 1/2 configs that listed plain paths', async () => {
    await put(home, '.agents/skills/pair/SKILL.md', skill('pair'))
    const cfg = mergeConfig({ skills_paths: ['.odd/skills', '~/.agents/skills'] })
    expect((await scan(cfg)).byName.has('pair')).toBe(true)
  })
})

describe('precedence, duplicates and fail-closed resolution', () => {
  it('project beats user, builtin is last, shadowed copies are reported', async () => {
    await put(proj, '.odd/skills/code-review/SKILL.md', skill('code-review', 'project version'))
    await put(home, '.agents/skills/code-review/SKILL.md', skill('code-review', 'user version'))
    const builtin = join(base, 'plugin-skills')
    await put(builtin, 'code-review/SKILL.md', skill('code-review', 'builtin version'))
    await put(builtin, 'odd-orchestrator/SKILL.md', skill('odd-orchestrator'))
    const reg = await scan(DEFAULT_CONFIG, { builtinDirs: [builtin] })
    expect(resolveSkill(reg, 'code-review').description).toBe('project version')
    expect(resolveSkill(reg, 'odd-orchestrator').source).toBe('builtin')
    const shadowed = reg.byName.get('code-review')!.slice(1)
    expect(shadowed.map((e) => e.source)).toEqual(['{agents_home}/skills', 'builtin'])
    expect(shadowed.every((e) => e.issues.some((i) => i.code === 'shadowed'))).toBe(true)
    expect(formatSkillList(reg)).toContain('+2 shadowed')
  })

  it('same name as bundle and flat file in one root is ambiguous and not resolvable', async () => {
    await put(proj, '.odd/skills/pair/SKILL.md', skill('pair'))
    await put(proj, '.odd/skills/pair.md', skill('pair'))
    const reg = await scan()
    expect(reg.byName.get('pair')!.every((e) => e.issues.some((i) => i.code === 'ambiguous'))).toBe(true)
    expect(() => resolveSkill(reg, 'pair')).toThrow(SkillError)
  })

  it('a broken project override does NOT silently fall back to the global skill', async () => {
    await put(proj, '.odd/skills/code-review/SKILL.md', '---\nname: code-review\n---\nno description')
    await put(home, '.agents/skills/code-review/SKILL.md', skill('code-review', 'good global'))
    const reg = await scan()
    expect(() => resolveSkill(reg, 'code-review')).toThrow(/invalid skill[\s\S]*description/)
  })

  it('reports a clear error with searched roots when a skill is missing', async () => {
    const reg = await scan()
    expect(() => resolveSkill(reg, 'nope')).toThrow(/not found[\s\S]*\.odd\/skills/)
  })
})

describe('validation', () => {
  const codes = async (rel: string, content: string) => {
    await put(proj, `.odd/skills/${rel}`, content)
    const reg = await scan()
    return { codes: reg.entries.flatMap((e) => e.issues.map((i) => `${i.severity}:${i.code}`)), entry: reg.entries[0]! }
  }
  it.each([
    ['no frontmatter', 'x/SKILL.md', 'just text', 'error:no-frontmatter'],
    ['broken yaml', 'x/SKILL.md', '---\nname: [oops\n---\nb', 'error:bad-frontmatter'],
    ['uppercase name', 'x/SKILL.md', skill('Code Review'), 'error:invalid-name'],
    ['missing description', 'x/SKILL.md', '---\nname: x\n---\nb', 'error:missing-description'],
    ['missing name', 'x/SKILL.md', '---\ndescription: d\n---\nb', 'warning:missing-name'],
    ['name != dir', 'x/SKILL.md', skill('y'), 'warning:name-mismatch'],
    ['long description', 'x/SKILL.md', skill('x', 'd'.repeat(1100)), 'warning:long-description'],
  ])('%s', async (_n, rel, content, code) => {
    expect((await codes(rel, content)).codes).toContain(code)
  })

  it('invalid name still registers under the directory name so lookups fail closed', async () => {
    const { entry } = await codes('code-review/SKILL.md', skill('Code Review'))
    expect(entry.key).toBe('code-review')
    expect(entry.valid).toBe(false)
  })
})

describe('progressive disclosure', () => {
  it('index holds name+description only; body is read at load time and frontmatter stripped', async () => {
    await put(proj, '.odd/skills/pair/SKILL.md', skill('pair', 'pairing', 'SECRET-BODY-TEXT'))
    const reg = await scan()
    expect(JSON.stringify(reg.entries)).not.toContain('SECRET-BODY-TEXT')
    const loaded = await loadResolvedSkill(proj, DEFAULT_CONFIG, 'pair', { env, home })
    expect(loaded.text).toBe('SECRET-BODY-TEXT')
    expect(await readSkillBody(reg.entries[0]!)).toBe('SECRET-BODY-TEXT')
  })

  it('picks up edits between loads (no stale cache)', async () => {
    await put(proj, '.odd/skills/pair/SKILL.md', skill('pair', 'd', 'v1'))
    expect((await loadResolvedSkill(proj, DEFAULT_CONFIG, 'pair', { env, home })).text).toBe('v1')
    await put(proj, '.odd/skills/pair/SKILL.md', skill('pair', 'd', 'v2'))
    expect((await loadResolvedSkill(proj, DEFAULT_CONFIG, 'pair', { env, home })).text).toBe('v2')
  })
})

describe('check (doctor)', () => {
  it('missing skill: error if the phase is dispatched, warning if inline', async () => {
    const r = checkRegistry(await scan(), DEFAULT_CONFIG)
    const byPhase = Object.fromEntries(r.issues.filter((i) => i.code === 'missing-skill').map((i) => [/"(.+?)"/.exec(i.message)![1], i.severity]))
    expect(byPhase['code-review']).toBe('error')
    expect(byPhase['pair']).toBe('warning')
    expect(r.errors).toBeGreaterThan(0)
    expect(formatCheck(r)).toContain('missing-skill')
  })

  it('is clean when every phase has a valid skill', async () => {
    for (const p of ['grill', 'story', 'pair', 'code-review', 'ship', 'fix', 'refactor']) await put(proj, `.odd/skills/${p}/SKILL.md`, skill(p))
    const r = checkRegistry(await scan(), DEFAULT_CONFIG)
    expect(r).toMatchObject({ errors: 0, warnings: 0 })
    expect(formatCheck(r)).toContain('OK')
  })

  it('flags a phase whose winning skill is invalid', async () => {
    await put(proj, '.odd/skills/pair/SKILL.md', '---\nname: pair\n---\nx')
    const r = checkRegistry(await scan(), DEFAULT_CONFIG)
    expect(r.issues.some((i) => i.code === 'phase-skill-invalid')).toBe(true)
  })
})

describe('shipped skills', () => {
  it("the plugin's own bundled skills validate cleanly", async () => {
    const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills')
    const reg = await scan(DEFAULT_CONFIG, { builtinDirs: [dir] })
    const orch = reg.byName.get('odd-orchestrator')![0]!
    expect(orch).toMatchObject({ valid: true, source: 'builtin' })
    expect(orch.issues).toEqual([])
  })
})

describe('builtin phase skills (defaults that your own skills override)', () => {
  const builtin = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills')

  it('cover every phase of every default workflow, with zero errors AND zero warnings', async () => {
    const reg = await scan(DEFAULT_CONFIG, { builtinDirs: [builtin] })
    const r = checkRegistry(reg, DEFAULT_CONFIG)
    expect(r.issues).toEqual([])
    for (const phase of ['grill', 'story', 'pair', 'fix', 'refactor', 'code-review', 'ship']) {
      expect(resolveSkill(reg, phase), phase).toMatchObject({ valid: true, source: 'builtin' })
    }
  })

  it('are overridden by a project or user skill with the same name (builtin is lowest precedence)', async () => {
    await put(proj, '.odd/skills/grill/SKILL.md', skill('grill', 'my grill', 'MY OWN GRILL'))
    const loaded = await loadResolvedSkill(proj, DEFAULT_CONFIG, 'grill', { env, home, builtinDirs: [builtin] })
    expect(loaded).toMatchObject({ source: '.odd/skills', text: 'MY OWN GRILL' })
    const pair = await loadResolvedSkill(proj, DEFAULT_CONFIG, 'pair', { env, home, builtinDirs: [builtin] })
    expect(pair.source).toBe('builtin')
  })

  it('encode the rules that matter: evidence, no commit, read-only review contract', async () => {
    const text = async (n: string) => (await loadResolvedSkill(proj, DEFAULT_CONFIG, n, { env, home, builtinDirs: [builtin] })).text
    expect(await text('pair')).toMatch(/Never write "tests pass" without running them/)
    expect(await text('ship')).toMatch(/Do NOT commit, push, merge/)
    const review = await text('code-review')
    expect(review).toMatch(/verdict/)
    expect(review).toMatch(/\[blocker\|major\|minor\|nit\]/)
    expect(review).toMatch(/cannot modify files/)
    expect(await text('fix')).toMatch(/Root cause/)
    expect(await text('grill')).toMatch(/do not use `needs_input`/)
  })
})

describe('phase_skills: use your own skill under another name', () => {
  it('check and resolution follow the mapping', async () => {
    await put(proj, '.odd/skills/grill-me/SKILL.md', skill('grill-me', 'interrogate the plan'))
    const cfg = mergeConfig({ phase_skills: { grill: 'grill-me' } })
    const reg = await scan(cfg)
    const missing = checkRegistry(reg, cfg).issues.filter((i) => i.code === 'missing-skill').map((i) => i.message)
    expect(missing.some((m) => m.includes('"grill"'))).toBe(false)      // mapped skill satisfies the phase
    const unmapped = checkRegistry(await scan(DEFAULT_CONFIG), DEFAULT_CONFIG).issues.filter((i) => i.code === 'missing-skill')
    expect(unmapped.some((i) => i.message.includes('"grill"'))).toBe(true)
  })
  it('names the mapped skill in the missing-skill message', async () => {
    const cfg = mergeConfig({ phase_skills: { story: 'user-stories' } })
    const msg = checkRegistry(await scan(cfg), cfg).issues.find((i) => i.message.includes('"story"'))!.message
    expect(msg).toContain('"user-stories"')
  })
  it('is validated', () => {
    expect(() => mergeConfig({ phase_skills: { nope: 'x' } })).toThrow(/not a phase/)
    expect(() => mergeConfig({ phase_skills: { grill: 'Bad Name' } })).toThrow(/skill name/)
  })
})

