import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { registerAll } from '../src/host/adapter'
import { createTask, initOdd } from '../src/core/store'

/** Fake ctx: records registrations. Verifies WIRING only, not the real harness API. */
function fakeCtx() {
  const commands = new Map<string, any>()
  const tools = new Map<string, any>()
  return {
    ctx: { commands: { register: (d: any) => commands.set(d.name, d) }, tools: { register: (d: any) => tools.set(d.name, d) } },
    cmd: async (name: string, args = '') => (await commands.get(name).handler(args)).text as string,
    tool: async (name: string, args: any = {}, exec?: any) => (await tools.get(name).execute(args, exec)).text as string,
    tools, commands,
  }
}

let cwd: string
beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'odd-a-'))
  await mkdir(join(cwd, '.git'))
  await initOdd(cwd)
})
afterEach(() => rm(cwd, { recursive: true, force: true }))

describe('adapter wiring', () => {
  it('registers the expected commands and tools', () => {
    const f = fakeCtx()
    registerAll(f.ctx, { cwd, rootDir: '.odd' })
    expect([...f.commands.keys()].sort()).toEqual(['odd-init', 'odd-resume', 'odd-skills', 'odd-status'])
    expect([...f.tools.keys()].sort()).toEqual([
      'odd_dispatch', 'odd_skill_list', 'odd_skill_load', 'odd_task_advance', 'odd_task_answer',
      'odd_task_archive', 'odd_task_create', 'odd_task_note', 'odd_task_read',
    ])
  })

  it('odd_task_read tells the agent the mode and which skill will be used', async () => {
    const f = fakeCtx()
    registerAll(f.ctx, { cwd, rootDir: '.odd' })
    await createTask(cwd, { name: 'login', type: 'feature', goal: 'g' })
    expect(await f.tool('odd_task_read', { name: 'login' })).toMatch(/^\[odd\] phase=grill mode=inline skill=MISSING/)
    await mkdir(join(cwd, '.odd', 'skills', 'grill'), { recursive: true })
    await writeFile(join(cwd, '.odd', 'skills', 'grill', 'SKILL.md'), '---\nname: grill\ndescription: plan an idea\n---\nASK HARD QUESTIONS')
    expect(await f.tool('odd_task_read', { name: 'login' })).toMatch(/skill=grill@\.odd\/skills -> run it inline: call odd_skill_load/)
  })

  it('odd_skill_load returns the project skill body with its source; list shows it', async () => {
    const f = fakeCtx()
    registerAll(f.ctx, { cwd, rootDir: '.odd' })
    await mkdir(join(cwd, '.odd', 'skills', 'pair'), { recursive: true })
    await writeFile(join(cwd, '.odd', 'skills', 'pair', 'SKILL.md'), '---\nname: pair\ndescription: pair program\n---\nTDD ONLY')
    const loaded = await f.tool('odd_skill_load', { name: 'pair' })
    expect(loaded).toContain('# Skill: pair (.odd/skills)')
    expect(loaded).toContain('TDD ONLY')
    expect(loaded).not.toContain('description: pair program')
    expect(await f.tool('odd_skill_list')).toContain('pair')
    await expect(f.tool('odd_skill_load', { name: 'ghost' })).rejects.toThrow(/not found/)
  })

  it('/odd-skills check reports problems, and bundled skills are visible as builtin', async () => {
    const f = fakeCtx()
    const builtin = join(cwd, 'plugin-skills')
    await mkdir(join(builtin, 'odd-orchestrator'), { recursive: true })
    await writeFile(join(builtin, 'odd-orchestrator', 'SKILL.md'), '---\nname: odd-orchestrator\ndescription: protocol\n---\nx')
    registerAll(f.ctx, { cwd, rootDir: '.odd', builtinDirs: [builtin] })
    expect(await f.cmd('odd-skills', 'check')).toMatch(/error\(s\).*\n[\s\S]*missing-skill/)
    expect(await f.cmd('odd-skills')).toContain('odd-orchestrator')
  })

  it('odd_dispatch fails clearly when the calling agent cannot be resolved', async () => {
    const f = fakeCtx()
    registerAll(f.ctx, { cwd, rootDir: '.odd' })
    await expect(f.tool('odd_dispatch', { name: 'x' }, {})).rejects.toThrow(/calling agent/)
  })
})
