import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '../src/core/config'
import { KNOWN_SECTIONS } from '../src/core/task'
import { registerAll } from '../src/host/adapter'
import { fakeCtx } from './fake-ctx'

/**
 * Static lint of the builtin skills. An LLM's behavior cannot be unit-tested, but the contract
 * between skills, tools and the task file can: every tool, section and phase a skill names must exist.
 */
const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills')
const names = readdirSync(dir).sort()
const skills = Object.fromEntries(names.map((n) => {
  const text = readFileSync(join(dir, n, 'SKILL.md'), 'utf8')
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text)!
  return [n, { text, fm: parse(m[1]!) as Record<string, unknown>, body: m[2]! }]
}))

const registered = (() => { const f = fakeCtx(); registerAll(f.ctx, { rootDir: '.odd' }); return new Set(f.tools.keys()) })()
const canon = new Map(KNOWN_SECTIONS.map((s) => [s.toLowerCase(), s]))

const list = (raw: string) => raw.replace(/\(.*?\)/g, '').split(',').map((s) => s.trim()).filter(Boolean)
const reads = (n: string) => { const m = /Reads: (.+?)\. Writes: (.+?)\./.exec(skills[n]!.body); return m ? { reads: list(m[1]!), writes: list(m[2]!) } : undefined }

describe('builtin skills', () => {
  it('ships exactly the expected set', () => {
    expect(names).toEqual(['backlog', 'code-review', 'fix', 'grill', 'odd-orchestrator', 'pair', 'refactor', 'ship', 'story', 'tdd', 'testing', 'to-tickets', 'verify'])
  })

  it.each(names)('%s: valid frontmatter, name matches its folder, bounded size', (n) => {
    const s = skills[n]!
    expect(s.fm.name).toBe(n)
    expect(typeof s.fm.description).toBe('string')
    expect((s.fm.description as string).length).toBeGreaterThan(60)
    expect((s.fm.description as string).length).toBeLessThan(500)
    expect(Object.keys(s.fm).sort()).toEqual(['description', 'name'])           // no Claude-Code-only keys
    expect(s.text.split('\n').length, 'lines').toBeLessThanOrEqual(110)
    expect(s.text.length, 'chars').toBeLessThanOrEqual(7000)
  })

  it.each(names)('%s: every odd_* tool it names is registered', (n) => {
    for (const m of skills[n]!.text.matchAll(/`(odd_[a-z_]+)`/g)) expect(registered.has(m[1]!), `${n} mentions unknown tool ${m[1]}`).toBe(true)
  })

  it.each(names)('%s: every section it names exists', (n) => {
    const t = skills[n]!.text
    const named = [...t.matchAll(/(?:section|under|in) "([A-Z][A-Za-z ]+)"/g)].map((m) => m[1]!)
    // a reference may also point at the skill's own headings ("described under \"Report\"") or at the
    // label odd_task_list prints; anything else must be a real section of the task file
    const own = new Set([...t.matchAll(/^#{2,3} (.+)$/gm)].map((m) => m[1]!.toLowerCase()))
    const outputLabels = new Set(['ready to work'])
    for (const s of named) {
      const ok = canon.has(s.toLowerCase()) || own.has(s.toLowerCase()) || outputLabels.has(s.toLowerCase())
      expect(ok, `${n} names unknown section "${s}"`).toBe(true)
    }
    const meta = reads(n)
    for (const s of [...(meta?.reads ?? []), ...(meta?.writes ?? [])]) expect(canon.has(s.toLowerCase()), `${n} Reads/Writes unknown section "${s}"`).toBe(true)
  })

  it('what a skill reads is written by another skill or by the system', () => {
    const SYSTEM = ['Goal', 'Plan', 'Answers', 'Reviews', 'Verification', 'Evidence', 'Log', 'Handoffs', 'Next step', 'Memory']
    const written = new Set<string>(SYSTEM)
    for (const n of names) for (const s of reads(n)?.writes ?? []) written.add(s)
    for (const n of names) for (const s of reads(n)?.reads ?? []) expect(written.has(s), `${n} reads "${s}" but nothing writes it`).toBe(true)
  })

  it('the structured sections are written by exactly the phase that owns them', () => {
    const writers = (section: string) => names.filter((n) => reads(n)?.writes.includes(section))
    expect(writers('Backlog')).toEqual(['backlog'])
    expect(writers('Tickets')).toEqual(['to-tickets'])
    expect(writers('Story')).toEqual(['fix', 'story'])
    expect(writers('Acceptance criteria')).toEqual(['fix', 'ship', 'story'])
    expect(writers('Delivery')).toEqual(['ship'])
    expect(writers('Root cause')).toEqual(['fix'])
  })

  it('every workflow phase and every dispatched extra skill has a builtin', () => {
    const phases = new Set(Object.values(DEFAULT_CONFIG.workflows).flat())
    for (const p of phases) expect(names, `phase ${p}`).toContain(p)
    for (const role of Object.values(DEFAULT_CONFIG.dispatch)) for (const s of role.skills) expect(names).toContain(s)
  })

  it('skills that other skills load by name exist', () => {
    for (const n of ['pair', 'fix', 'refactor']) {
      for (const dep of ['tdd', 'testing']) expect(skills[n]!.text, `${n} should load ${dep}`).toContain(`\`${dep}\``)
    }
  })

  it('dispatched skills speak the structured contract; inline skills record in the task file', () => {
    for (const n of ['code-review', 'verify']) {
      const t = skills[n]!.text
      expect(t).toMatch(/verdict/)
      expect(t).toMatch(/`details`/)
      expect(t).toMatch(/`###` headings only/)
      expect(t).not.toMatch(/odd_task_(advance|note|check)/)               // a subagent cannot call the odd tools
    }
    for (const n of ['pair', 'fix', 'refactor', 'story', 'backlog', 'grill', 'to-tickets', 'ship']) expect(skills[n]!.text, n).toMatch(/odd_task_advance/)
  })

  it('none of the human-in-the-loop skills lets the agent commit', () => {
    for (const n of ['pair', 'fix', 'refactor', 'ship', 'tdd']) expect(skills[n]!.text, n).toMatch(/Never commit/i)
  })

  it('no skill depends on tools of another host', () => {
    for (const n of names) {
      expect(skills[n]!.text, n).not.toMatch(/disable-model-invocation|allowed-tools|argument-hint|\/setup-matt-pocock-skills/)
    }
  })
})
