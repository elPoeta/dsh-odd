import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, ROLE_DEFAULTS, effectiveDeny, mergeConfig } from '../src/core/config'
import {
  MAX_ITEMS, assertCapturable, engramPatchRow, extractItems, formatCapture, formatMemoryStatus, formatRecall,
  keywords, missingMemoryTools, planCapture, planRecall, recordCapture, redact, shortHash, slugify,
} from '../src/core/memory'
import { memoryDeny } from '../src/core/memory-tools'
import { renderTask } from '../src/core/templates'
import { appendToSection, getSection, setSection, type Task } from '../src/core/task'

const mem = { ...DEFAULT_CONFIG.memory, enabled: true }
const vars = { id: 'login-oauth', title: 'Login OAuth', goal: 'Sign in with Google', branch: 'feat/login-oauth', created: '2026-11-24T10:00:00.000Z' }
const mk = (type: 'feature' | 'hotfix' | 'refactor' = 'feature'): Task => renderTask(type, DEFAULT_CONFIG, vars)
const closed = (t: Task, status: 'done' | 'blocked' = 'done'): Task => ({ ...t, frontmatter: { ...t.frontmatter, status } })
const note = (t: Task, section: string, text: string): Task => ({ ...t, body: appendToSection(t.body, section, text) })

describe('text helpers', () => {
  it('slugify is kebab, ascii, bounded and never empty', () => {
    expect(slugify('Use PKCE for the OAuth flow!')).toBe('use-pkce-for-the-oauth-flow')
    expect(slugify('Decisión: usar caché')).toBe('decision-usar-cache')
    expect(slugify('x'.repeat(100)).length).toBeLessThanOrEqual(40)
    expect(slugify('***')).toBe('item')
  })
  it('shortHash is stable across whitespace and case, and differs for different text', () => {
    expect(shortHash('Use  PKCE')).toBe(shortHash(' use pkce '))
    expect(shortHash('use pkce')).not.toBe(shortHash('use implicit'))
    expect(shortHash('a')).toMatch(/^[0-9a-f]{6}$/)
  })
  it.each([
    ['sk-abcdefghijklmnopqrstuvwx', 1],
    ['ghp_abcdefghijklmnopqrstuvwxyz0123', 1],
    ['AKIAABCDEFGHIJKLMNOP', 1],
    ['eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0NTY.SflKxwRJSMeKKF2QT4fw', 1],
    ['password: hunter2 and api_key=abc123', 2],
    ['-----BEGIN PRIVATE KEY-----\nMIIE\n-----END PRIVATE KEY-----', 1],
  ])('redacts secrets: %s', (input, count) => {
    const r = redact(`before ${input} after`)
    expect(r.count).toBe(count)
    expect(r.text).toContain('[REDACTED]')
    expect(r.text.startsWith('before ') && r.text.endsWith(' after')).toBe(true)
  })
  it('leaves ordinary text alone', () => {
    expect(redact('Use PKCE; token refresh runs hourly')).toEqual({ text: 'Use PKCE; token refresh runs hourly', count: 0 })
  })
  it('extractItems reads bullets, joins continuations, ignores comments/empties', () => {
    const items = extractItems('<!-- hint -->\n- first\n- second line\n  continues here\n* third\n- [ ] unchecked\n\nnot a bullet')
    expect(items).toEqual(['first', 'second line continues here', 'third', 'unchecked'])
    expect(extractItems(undefined)).toEqual([])
  })
})

describe('capture plan', () => {
  const task = () => {
    let t = closed(mk())
    t = note(t, 'Decisions', '- Use PKCE for the OAuth flow\n- Store tokens in httpOnly cookies')
    t = note(t, 'Lessons', '- Mock the provider in tests, never hit Google')
    t = note(t, 'Log', '- 2026-11-24T11:00:00.000Z [pair] SECRET-LOG-LINE')
    t = note(t, 'Evidence', '- pnpm test => 42 passed SECRET-EVIDENCE')
    t = note(t, 'Handoffs', '- code-review -> spawn SECRET-HANDOFF')
    return t
  }

  it('builds a digest plus one observation per decision and lesson, with valid Engram keys', () => {
    const plan = planCapture(task(), mem)
    expect(plan.items.map((i) => i.type)).toEqual(['architecture', 'decision', 'decision', 'discovery'])
    for (const i of plan.items) {
      expect(i.topic_key, i.topic_key).toMatch(/^[a-z]+\/[a-z0-9-]+$/)           // family/description, max 2 levels, kebab
      expect(i.topic_key.split('/')).toHaveLength(2)
      expect(i).toMatchObject({ scope: 'project', capture_prompt: false })
      expect(i.content).toContain('.odd/tasks/login-oauth.md')                  // provenance: where the truth lives
    }
    expect(plan.items[0]!.topic_key).toBe('odd/login-oauth')
    expect(plan.items[1]!.topic_key).toMatch(/^decision\/login-oauth-use-pkce-for-the-oauth-flow-[0-9a-f]{6}$/)
    expect(plan.items[3]!.topic_key).toMatch(/^learning\/login-oauth-mock-the-provider-/)
  })

  it('NEVER includes log, handoffs or evidence content', () => {
    const all = JSON.stringify(planCapture(task(), mem))
    for (const secret of ['SECRET-LOG-LINE', 'SECRET-EVIDENCE', 'SECRET-HANDOFF']) expect(all).not.toContain(secret)
  })

  it('is idempotent: same task, same keys and payloads', () => {
    expect(planCapture(task(), mem)).toEqual(planCapture(task(), mem))
  })

  it('a reworded decision gets a new key; a cosmetic edit keeps it', () => {
    const a = planCapture(note(closed(mk()), 'Decisions', '- Use PKCE'), mem).items[1]!.topic_key
    const same = planCapture(note(closed(mk()), 'Decisions', '-   use   pkce '), mem).items[1]!.topic_key
    const other = planCapture(note(closed(mk()), 'Decisions', '- Use implicit flow'), mem).items[1]!.topic_key
    expect(same).toBe(a)
    expect(other).not.toBe(a)
  })

  it('hotfix: digest is a bugfix and Root cause becomes bug/<task>-root-cause', () => {
    let t = closed(renderTask('hotfix', DEFAULT_CONFIG, { ...vars, id: 'fix-crash', title: 'Fix crash', goal: 'crash on login' }))
    expect(getSection(t.body, 'Root cause')).toBe('')                              // template ships the section
    t = { ...t, body: setSection(t.body, 'Root cause', 'user was null after token refresh') }
    const plan = planCapture(t, mem)
    expect(plan.items[0]).toMatchObject({ type: 'bugfix', topic_key: 'odd/fix-crash' })
    expect(plan.items.find((i) => i.topic_key === 'bug/fix-crash-root-cause')).toMatchObject({ type: 'bugfix' })
  })

  it('redacts secrets before they leave the task file and reports the count', () => {
    const plan = planCapture(note(closed(mk()), 'Decisions', '- Use key sk-abcdefghijklmnopqrstuvwx and password=hunter2'), mem)
    const json = JSON.stringify(plan)
    expect(json).not.toContain('sk-abcdefghijklmnop')
    expect(json).not.toContain('hunter2')
    expect(plan.redactions).toBe(2)                                   // counted once, not per field
    for (const i of plan.items) expect(i.topic_key).not.toMatch(/sk-|hunter/)   // regression: the slug leaked the key
  })

  it('truncates long items and caps the number of items', () => {
    const long = planCapture(note(closed(mk()), 'Decisions', `- ${'word '.repeat(600)}`), { ...mem, max_item_chars: 300 })
    expect(long.truncated).toBeGreaterThan(0)
    expect(long.items.every((i) => i.content.length <= 300)).toBe(true)
    const many = planCapture(note(closed(mk()), 'Decisions', Array.from({ length: 40 }, (_, i) => `- decision number ${i}`).join('\n')), mem)
    expect(many.items).toHaveLength(MAX_ITEMS)
    expect(many.dropped).toBe(41 - MAX_ITEMS)
  })

  it('passes project and personal scope only when configured', () => {
    const p = planCapture(closed(mk()), { ...mem, project: 'my-api', scope: 'personal' }).items[0]!
    expect(p).toMatchObject({ project: 'my-api', scope: 'personal' })
    expect('project' in planCapture(closed(mk()), mem).items[0]!).toBe(false)
  })

  it('only closed (done/blocked) tasks are capturable', () => {
    expect(() => assertCapturable(mk())).toThrow(/is todo/)
    expect(() => assertCapturable(closed(mk()))).not.toThrow()
    expect(() => assertCapturable(closed(mk(), 'blocked'))).not.toThrow()
  })

  it('recordCapture traces keys in a Memory section (replaced, not appended) and logs it', () => {
    const t0 = closed(mk())
    const plan = planCapture(t0, mem)
    const once = recordCapture(t0, plan, new Date('2026-11-24T12:00:00Z'))
    const twice = recordCapture(once, plan, new Date('2026-11-24T12:05:00Z'))
    expect(getSection(twice.body, 'Memory')!.match(/odd\/login-oauth \(/g)).toHaveLength(1)
    expect(getSection(twice.body, 'Log')).toContain('memory: prepared 1 Engram item(s)')
  })

  it('formatCapture names the exact tool, shows the arguments and the exclusions', () => {
    const t = task()
    const out = formatCapture(t, planCapture(t, mem), 'engram')
    expect(out).toContain('mcp__engram__mem_save')
    expect(out).toContain('"capture_prompt":false')
    expect(out).toContain('Never saved by design: Log, Handoffs, Evidence')
  })
})

describe('recall plan', () => {
  it('extracts a few keywords, dropping stop words in English and Spanish', () => {
    expect(keywords('Add the new OAuth login for Google accounts')).toEqual(['oauth', 'login', 'google', 'accounts'])
    expect(keywords('Arreglar el login con caché para usuarios')).toEqual(['login', 'caché', 'usuarios'])
    expect(keywords('a b')).toEqual([])
  })
  it('plans context + two searches, using decision for features and bugfix for hotfixes', () => {
    const f = planRecall(mk(), mem)
    expect(f.map((c) => c.tool)).toEqual(['mcp__engram__mem_context', 'mcp__engram__mem_search', 'mcp__engram__mem_search'])
    expect(f[2]!.args).toMatchObject({ type: 'decision', limit: 5 })
    expect(planRecall(renderTask('hotfix', DEFAULT_CONFIG, vars), mem)[2]!.args).toMatchObject({ type: 'bugfix' })
    expect(planRecall(mk(), { ...mem, server_name: 'mem', project: 'p' })[1]).toMatchObject({ tool: 'mcp__mem__mem_search', args: { project: 'p' } })
  })
  it('states the md-wins rule', () => {
    const out = formatRecall(mk(), planRecall(mk(), mem), 'engram')
    expect(out).toMatch(/task file wins/)
    expect(out).toContain('mcp__engram__mem_get_observation')
  })
})

describe('status and mounting help', () => {
  it('reports missing tools with a patch row that sits inside insert:', () => {
    const names = ['mcp__engram__mem_save', 'mcp__engram__mem_search']
    expect(missingMemoryTools('engram', names)).toEqual(['mcp__engram__mem_get_observation', 'mcp__engram__mem_context'])
    expect(missingMemoryTools('engram', undefined)).toBeUndefined()
    const out = formatMemoryStatus(mem, names)
    expect(out).toContain('missing')
    expect(out).toContain('- insert:')
    expect(engramPatchRow('engram')).toContain("args: ['mcp', '--tools=agent']")
    expect(formatMemoryStatus(mem, [...names, 'mcp__engram__mem_get_observation', 'mcp__engram__mem_context'])).toContain('all required tools are registered')
  })
})

describe('config and subagent isolation from memory', () => {
  it('memory is opt-in and validated', () => {
    expect(mergeConfig({}).memory.enabled).toBe(false)
    expect(() => mergeConfig({ memory: { server_name: 'bad name!' } as never })).toThrow(/server_name/)
    expect(() => mergeConfig({ memory: { scope: 'global' } as never })).toThrow(/scope/)
    expect(() => mergeConfig({ memory: { recall_limit: 50 } as never })).toThrow(/recall_limit/)
    expect(() => mergeConfig({ dispatch: { 'code-review': { memory: 'write' as never } } })).toThrow(/memory must be/)
  })
  it('children get NO Engram tools by default, and never the writers even with read access', () => {
    const none = effectiveDeny(ROLE_DEFAULTS)
    expect(none).toEqual(expect.arrayContaining(['mcp__engram__mem_save', 'mcp__engram__mem_search', 'mcp__engram__mem_get_observation']))
    const read = effectiveDeny({ ...ROLE_DEFAULTS, memory: 'read' })
    expect(read).toContain('mcp__engram__mem_save')
    expect(read).toContain('mcp__engram__mem_update')
    expect(read).not.toContain('mcp__engram__mem_search')
    expect(memoryDeny('mem', 'read')[0]).toMatch(/^mcp__mem__/)
    expect(effectiveDeny(ROLE_DEFAULTS, 'mem')).toContain('mcp__mem__mem_save')
  })
})
