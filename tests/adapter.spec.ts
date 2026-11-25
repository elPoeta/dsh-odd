import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { REPORT_SCHEMA } from '../src/core/contract'
import { createTask, initOdd } from '../src/core/store'
import { registerAll } from '../src/host/adapter'

/**
 * Fake ctx that enforces the VERIFIED harness shapes, so the adapter can't drift:
 *  - commands.register(def): name /^[a-z][a-z0-9_-]*$/, non-empty description, optional input.hint (string),
 *    handler(invocation) -> { kind: 'success'|'error', text }
 *  - tools.register(def): ToolDefinition = name, description, JSON-Schema parameters, output{schema,render}, execute
 *  - effect(fn, label) wraps registrations
 */
function fakeCtx() {
  const commands = new Map<string, any>()
  const tools = new Map<string, any>()
  const labels: string[] = []
  const ctx = {
    effect: (fn: () => unknown, label: string) => { labels.push(label); return fn() },
    commands: {
      register: (d: any) => {
        if (!/^[a-z][a-z0-9_-]*$/u.test(d.name)) throw new Error(`bad command name ${d.name}`)
        if (typeof d.description !== 'string' || !d.description.trim()) throw new Error('empty description')
        if (d.input !== undefined && typeof d.input.hint !== 'string') throw new Error('input.hint must be a string')
        if (typeof d.handler !== 'function') throw new Error('handler required')
        commands.set(d.name, d)
        return () => commands.delete(d.name)
      },
    },
    tools: {
      register: (d: any) => {
        if (!d.output || typeof d.output.render !== 'function' || !d.output.schema) throw new Error(`tool ${d.name}: output is mandatory`)
        if (typeof d.execute !== 'function') throw new Error('execute required')
        if (tools.has(d.name)) throw new Error(`duplicate tool ${d.name}`)
        tools.set(d.name, d)
        return () => tools.delete(d.name)
      },
      schemas: () => [...tools.values()].map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })),
    },
  }
  const run = async (name: string, rawInput = '', agent?: unknown) => commands.get(name).handler({ commandId: 'c1', agent, rawInput, signal: new AbortController().signal })
  const call = async (name: string, args: any = {}, exec: any = { signal: new AbortController().signal }) => {
    const def = tools.get(name)
    const value = await def.execute(args, exec)
    const blocks = def.output.render(args, value)
    expect(typeof value).toBe('string') // canonical value matches output.schema {type:'string'}
    expect(blocks).toEqual([{ type: 'text', text: value }])
    return value as string
  }
  return { ctx, commands, tools, labels, run, call }
}

let cwd: string
beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'odd-a-'))
  await mkdir(join(cwd, '.git'))
  await initOdd(cwd)
})
afterEach(() => rm(cwd, { recursive: true, force: true }))

describe('registration (verified shapes)', () => {
  it('registers every command and tool through ctx.effect with valid definitions', () => {
    const f = fakeCtx()
    registerAll(f.ctx, { cwd, rootDir: '.odd' })
    expect([...f.commands.keys()].sort()).toEqual(['odd-init', 'odd-memory', 'odd-resume', 'odd-skills', 'odd-status'])
    expect([...f.tools.keys()].sort()).toEqual([
      'odd_dispatch', 'odd_memory_capture', 'odd_memory_recall', 'odd_skill_list', 'odd_skill_load', 'odd_task_advance',
      'odd_task_answer', 'odd_task_archive', 'odd_task_create', 'odd_task_note', 'odd_task_read',
    ])
    expect(f.labels).toHaveLength(16)
    expect(f.commands.get('odd-resume').input).toEqual({ hint: '<task-name>' })
  })

  it('every schema stays inside the host-enforced JSON Schema subset', () => {
    const ALLOWED = new Set(['type', 'oneOf', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'const', 'description', 'title', 'default', 'examples'])
    const walk = (n: any, path: string) => {
      for (const k of Object.keys(n)) expect(ALLOWED.has(k), `${path}.${k} is outside the subset`).toBe(true)
      if (n.enum) { expect(n.type, `${path}: enum needs a scalar type`).toBeDefined(); expect(n.enum.every((v: unknown) => typeof v === 'string')).toBe(true) }
      if (n.required) for (const r of n.required) expect(Object.keys(n.properties ?? {}), `${path}: required "${r}" must be a property`).toContain(r)
      for (const [k, v] of Object.entries(n.properties ?? {})) walk(v, `${path}.${k}`)
      if (n.items) walk(n.items, `${path}[]`)
    }
    const f = fakeCtx()
    registerAll(f.ctx, { cwd, rootDir: '.odd' })
    for (const [name, def] of f.tools) { expect(def.parameters.type).toBe('object'); walk(def.parameters, name) }
    walk(REPORT_SCHEMA, 'REPORT_SCHEMA')
    expect(REPORT_SCHEMA.type).toBe('object') // subagent outputSchema must be object-rooted
  })
})

describe('commands', () => {
  it('return { kind, text } and turn thrown errors into kind:error', async () => {
    const f = fakeCtx()
    registerAll(f.ctx, { cwd, rootDir: '.odd' })
    expect(await f.run('odd-status')).toEqual({ kind: 'success', text: 'No active ODD tasks.' })
    const r = await f.run('odd-resume', '')
    expect(r).toMatchObject({ kind: 'error' })
    expect((await f.run('odd-resume', 'ghost')).kind).toBe('error')
  })

  it('/odd-resume steers the agent with a text block and the protocol request', async () => {
    const f = fakeCtx()
    registerAll(f.ctx, { cwd, rootDir: '.odd' })
    await createTask(cwd, { name: 'login', type: 'feature', goal: 'g' })
    const steered: unknown[] = []
    const r = await f.run('odd-resume', '  login ', { steer: async (x: unknown) => { steered.push(x) } })
    expect(r).toMatchObject({ kind: 'success' })
    expect(r.text).toContain('Sent the resume request')
    expect(steered).toHaveLength(1)
    const blocks = steered[0] as any[]
    expect(blocks[0]).toMatchObject({ type: 'text' })
    expect(blocks[0].text).toContain('odd_skill_load')
    expect(blocks[0].text).toContain('"login"')
  })

  it('/odd-resume degrades to a manual instruction when steer is unavailable or fails', async () => {
    const f = fakeCtx()
    registerAll(f.ctx, { cwd, rootDir: '.odd' })
    await createTask(cwd, { name: 'login', type: 'feature' })
    for (const agent of [undefined, { steer: async () => { throw new Error('boom') } }]) {
      const r = await f.run('odd-resume', 'login', agent)
      expect(r.kind).toBe('success')
      expect(r.text).toContain('Tell the agent:')
    }
  })

  it('/odd-skills check reports problems; bundled skills show as builtin', async () => {
    const f = fakeCtx()
    const builtin = join(cwd, 'plugin-skills')
    await mkdir(join(builtin, 'odd-orchestrator'), { recursive: true })
    await writeFile(join(builtin, 'odd-orchestrator', 'SKILL.md'), '---\nname: odd-orchestrator\ndescription: protocol\n---\nx')
    registerAll(f.ctx, { cwd, rootDir: '.odd', builtinDirs: [builtin] })
    expect((await f.run('odd-skills', 'check')).text).toMatch(/error\(s\)[\s\S]*missing-skill/)
    expect((await f.run('odd-skills')).text).toContain('odd-orchestrator')
  })
})

describe('tools', () => {
  it('odd_task_read tells the agent the mode and which skill will be used', async () => {
    const f = fakeCtx()
    registerAll(f.ctx, { cwd, rootDir: '.odd' })
    await createTask(cwd, { name: 'login', type: 'feature', goal: 'g' })
    expect(await f.call('odd_task_read', { name: 'login' })).toMatch(/^\[odd\] phase=grill mode=inline skill=MISSING/)
    await mkdir(join(cwd, '.odd', 'skills', 'grill'), { recursive: true })
    await writeFile(join(cwd, '.odd', 'skills', 'grill', 'SKILL.md'), '---\nname: grill\ndescription: plan an idea\n---\nASK HARD QUESTIONS')
    expect(await f.call('odd_task_read', { name: 'login' })).toMatch(/skill=grill@\.odd\/skills -> run it inline: call odd_skill_load/)
  })

  it('odd_skill_load returns the project skill body with its source', async () => {
    const f = fakeCtx()
    registerAll(f.ctx, { cwd, rootDir: '.odd' })
    await mkdir(join(cwd, '.odd', 'skills', 'pair'), { recursive: true })
    await writeFile(join(cwd, '.odd', 'skills', 'pair', 'SKILL.md'), '---\nname: pair\ndescription: pair program\n---\nTDD ONLY')
    const loaded = await f.call('odd_skill_load', { name: 'pair' })
    expect(loaded).toContain('# Skill: pair (.odd/skills)')
    expect(loaded).toContain('TDD ONLY')
    expect(await f.call('odd_skill_list')).toContain('pair')
    await expect(f.call('odd_skill_load', { name: 'ghost' })).rejects.toThrow(/not found/)
  })

  it('validates its own arguments (raw ToolDefinitions must)', async () => {
    const f = fakeCtx()
    registerAll(f.ctx, { cwd, rootDir: '.odd' })
    await expect(f.call('odd_task_create', { name: 'a', type: 'bogus' })).rejects.toThrow(/one of: feature, hotfix, refactor/)
    await expect(f.call('odd_task_create', { type: 'feature' })).rejects.toThrow(/"name" is required/)
    await expect(f.call('odd_task_create', { name: 'a', type: 'feature', extra: 'x' })).rejects.toThrow(/Unknown argument "extra"/)
    await expect(f.call('odd_task_create', { name: 5, type: 'feature' })).rejects.toThrow(/required/)
    await expect(f.call('odd_task_create', 'nope')).rejects.toThrow(/must be an object/)
    await expect(f.call('odd_task_advance', { name: 'a', outcome: 'maybe', summary: 's' })).rejects.toThrow(/one of/)
  })

  it('drives a task end to end through the tools', async () => {
    const f = fakeCtx()
    registerAll(f.ctx, { cwd, rootDir: '.odd' })
    expect(await f.call('odd_task_create', { name: 'fix-login', type: 'hotfix', goal: 'crash on login' })).toContain('phase: fix')
    expect(await f.call('odd_task_note', { name: 'fix-login', section: 'Decisions', text: '- guard null user' })).toBe('ok')
    expect(await f.call('odd_task_advance', { name: 'fix-login', outcome: 'done', summary: 'fixed' })).toContain('phase=code-review')
    expect(await f.call('odd_task_advance', { name: 'fix-login', outcome: 'needs_input', summary: 'q', question: 'ship now?' })).toContain('status=needs_input')
    expect(await f.call('odd_task_answer', { name: 'fix-login', answer: 'yes' })).toContain('status=in_progress')
    expect(await f.call('odd_task_read', { name: 'fix-login' })).toContain('guard null user')
  })

  it('odd_dispatch needs the calling agent from exec and fails clearly without it', async () => {
    const f = fakeCtx()
    registerAll(f.ctx, { cwd, rootDir: '.odd' })
    await expect(f.call('odd_dispatch', { name: 'x' }, {})).rejects.toThrow(/exec\.agent was undefined/)
  })
})

describe('Engram memory tools', () => {
  const enable = async () => {
    const { readFile } = await import('node:fs/promises')
    const cfg = join(cwd, '.odd', 'config.yml')
    await writeFile(cfg, (await readFile(cfg, 'utf8')).replace('  enabled: false', '  enabled: true'))
  }
  const mount = (f: ReturnType<typeof fakeCtx>) => {
    for (const t of ['mem_save', 'mem_search', 'mem_get_observation', 'mem_context']) {
      f.tools.set(`mcp__engram__${t}`, { name: `mcp__engram__${t}`, description: '', parameters: {} })
    }
  }

  it('is disabled by default with an actionable error', async () => {
    const f = fakeCtx()
    registerAll(f.ctx, { cwd, rootDir: '.odd' })
    await createTask(cwd, { name: 'a', type: 'feature' })
    await expect(f.call('odd_memory_recall', { name: 'a' })).rejects.toThrow(/memory\.enabled: true/)
    await expect(f.call('odd_memory_capture', { name: 'a' })).rejects.toThrow(/disabled/)
    expect(await f.call('odd_task_create', { name: 'b', type: 'feature' })).not.toContain('Engram')
  })

  it('explains how to mount Engram when its tools are not registered', async () => {
    await enable()
    const f = fakeCtx()
    registerAll(f.ctx, { cwd, rootDir: '.odd' })
    await createTask(cwd, { name: 'a', type: 'feature' })
    const out = await f.call('odd_memory_recall', { name: 'a' })
    expect(out).toContain('Engram MCP tools missing')
    expect(out).toContain('- insert:')
    expect((await f.run('odd-memory')).text).toContain('@deepseek-ai/dsh-mcp-client')
  })

  it('recall returns the exact mem_* calls and the md-wins rule', async () => {
    await enable()
    const f = fakeCtx()
    registerAll(f.ctx, { cwd, rootDir: '.odd' })
    mount(f)
    expect(await f.call('odd_task_create', { name: 'login', type: 'feature', goal: 'Sign in with Google OAuth' })).toContain('call odd_memory_recall')
    const out = await f.call('odd_memory_recall', { name: 'login' })
    expect(out).toContain('mcp__engram__mem_search')
    expect(out).toContain('google')
    expect(out).toMatch(/task file wins/)
    expect((await f.run('odd-memory')).text).toContain('all required tools are registered')
  })

  it('capture: refuses open tasks, then prepares idempotent saves and traces them in the md', async () => {
    await enable()
    const f = fakeCtx()
    registerAll(f.ctx, { cwd, rootDir: '.odd' })
    mount(f)
    await f.call('odd_task_create', { name: 'fix-it', type: 'hotfix', goal: 'crash on login' })
    await expect(f.call('odd_memory_capture', { name: 'fix-it' })).rejects.toThrow(/is todo/)
    await f.call('odd_task_note', { name: 'fix-it', section: 'Root cause', text: 'user was null after refresh' })
    await f.call('odd_task_note', { name: 'fix-it', section: 'Lessons', text: '- Always null-check the refreshed user' })
    await f.call('odd_task_note', { name: 'fix-it', section: 'Evidence', text: '- pnpm test => SECRET-EVIDENCE' })
    for (let i = 0; i < 2; i++) await f.call('odd_task_advance', { name: 'fix-it', outcome: 'done', summary: 'ok' })
    const last = await f.call('odd_task_advance', { name: 'fix-it', outcome: 'done', summary: 'shipped' })
    expect(last).toContain('Task closed')
    expect(last).toContain('Root cause')
    const a = await f.call('odd_memory_capture', { name: 'fix-it' })
    const b = await f.call('odd_memory_capture', { name: 'fix-it' })
    expect(a).toBe(b)                                    // idempotent
    expect(a).toContain('mcp__engram__mem_save')
    expect(a).toContain('bug/fix-it-root-cause')
    expect(a).toContain('odd/fix-it')
    expect(a).not.toContain('SECRET-EVIDENCE')
    const md = await f.call('odd_task_read', { name: 'fix-it' })
    expect(md).toContain('## Memory')
    expect(md.match(/odd\/fix-it \(/g)).toHaveLength(1)
  })

  it('a blocked task can be captured too', async () => {
    await enable()
    const f = fakeCtx()
    registerAll(f.ctx, { cwd, rootDir: '.odd' })
    mount(f)
    await f.call('odd_task_create', { name: 'stuck', type: 'feature' })
    expect(await f.call('odd_task_advance', { name: 'stuck', outcome: 'blocked', summary: 'needs infra' })).toContain('odd_memory_capture')
    expect(await f.call('odd_memory_capture', { name: 'stuck' })).toContain('odd/stuck')
  })
})

