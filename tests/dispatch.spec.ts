import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { dispatchPhase, phaseMode, type RunRequest, type RunResult, type SubagentClient } from '../src/core/dispatch'
import type { ExecFn } from '../src/core/exec'
import { buildPacket } from '../src/core/packet'
import { ROLE_DEFAULTS, mergeConfig } from '../src/core/config'
import { createTask, initOdd, loadConfig, mutateTask, readTask } from '../src/core/store'
import { getSection } from '../src/core/task'
import { advance } from '../src/core/workflow'

let cwd: string
const signal = new AbortController().signal
const DIFF = 'diff --git a/src/a.ts b/src/a.ts\n+const secret = 1\n'

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'odd-d-'))
  await initOdd(cwd)
  await mkdir(join(cwd, '.odd', 'skills', 'code-review'), { recursive: true })
  await writeFile(join(cwd, '.odd', 'skills', 'code-review', 'SKILL.md'), '---\nname: code-review\ndescription: Review a change set for bugs and missing tests\n---\nReview for bugs and missing tests.')
  await createTask(cwd, { name: 'login', type: 'feature', goal: 'Sign in with Google' })
  // bring the task to code-review: grill, story, pair done
  for (let i = 0; i < 3; i++) await mutateTask(cwd, 'login', (t, c) => advance(t, c, { outcome: 'done', summary: `step ${i}` }))
})
afterEach(() => rm(cwd, { recursive: true, force: true }))

const fakeExec = (map: Record<string, { code: number; output: string }> = {}): ExecFn => async (cmd) =>
  map[cmd] ?? (cmd.startsWith('git diff') ? { code: 0, output: DIFF } : { code: 0, output: '' })

class Fake implements SubagentClient {
  calls: RunRequest[] = []
  constructor(private reply: RunResult | (() => RunResult | Promise<RunResult>) | Error) {}
  async run(req: RunRequest) {
    this.calls.push(req)
    if (this.reply instanceof Error) throw this.reply
    return typeof this.reply === 'function' ? this.reply() : this.reply
  }
}
const completed = (structured: unknown): RunResult => ({ stopReason: 'completed', structured, outputText: '' })

describe('dispatchPhase (code-review)', () => {
  it('approve -> advances to ship and records handoff + decisions', async () => {
    const client = new Fake(completed({ status: 'done', verdict: 'approve', summary: 'clean', decisions: ['keep PKCE'] }))
    const r = await dispatchPhase({ client, exec: fakeExec() }, cwd, 'login', signal)
    expect(r).toMatchObject({ outcome: 'done', status: 'in_progress', nextPhase: 'ship' })
    const t = await readTask(cwd, 'login')
    expect(getSection(t.body, 'Handoffs')).toContain('code-review -> spawn')
    expect(getSection(t.body, 'Handoffs')).toContain('skill: code-review@.odd/skills')
    expect(getSection(t.body, 'Decisions')).toContain('keep PKCE (from code-review)')
  })

  it('sends a clean, minimal packet: has goal/diff/skill, lacks log and handoffs', async () => {
    const client = new Fake(completed({ status: 'done', verdict: 'approve', summary: 'ok' }))
    await dispatchPhase({ client, exec: fakeExec() }, cwd, 'login', signal)
    const p = client.calls[0]!.prompt
    expect(p).toContain('Sign in with Google')
    expect(p).toContain('+const secret = 1')
    expect(p).toContain('Review for bugs and missing tests.')
    expect(p).not.toContain('description: Review a change set')   // frontmatter stripped
    expect(p).not.toContain('## Log')
    expect(p).not.toContain('step 1')           // earlier phase summaries live in Log/Handoffs
    expect(p).toContain('read-only')
    expect(client.calls[0]!.toolDeny).toEqual(expect.arrayContaining(['write', 'bash', 'odd_task_advance']))
    expect(client.calls[0]!.toolDeny).toEqual(expect.arrayContaining(['mcp__engram__mem_save', 'mcp__engram__mem_search'])) // child gets no memory by default
  })

  it('changes_requested -> back to pair, findings land in Evidence', async () => {
    const client = new Fake(completed({
      status: 'done', verdict: 'changes_requested', summary: 'needs tests',
      findings: ['[blocker] src/a.ts:1 - no tests'],
    }))
    const r = await dispatchPhase({ client, exec: fakeExec() }, cwd, 'login', signal)
    expect(r).toMatchObject({ outcome: 'changes_requested', nextPhase: 'pair', findings: 1 })
    const t = await readTask(cwd, 'login')
    expect(t.frontmatter.review_loops).toBe(1)
    expect(getSection(t.body, 'Evidence')).toContain('[blocker] src/a.ts:1 - no tests')
    expect(getSection(t.body, 'Next step')).toContain('1 findings')
  })

  it('review loop limit blocks the task through the dispatcher', async () => {
    const reply = completed({ status: 'done', verdict: 'changes_requested', summary: 'again' })
    for (let i = 0; i < 4; i++) {
      await dispatchPhase({ client: new Fake(reply), exec: fakeExec() }, cwd, 'login', signal)
      if (i < 3) await mutateTask(cwd, 'login', (t, c) => advance(t, c, { outcome: 'done', summary: 'pair again' })) // pair -> code-review
    }
    expect((await readTask(cwd, 'login')).frontmatter.status).toBe('blocked')
  })

  it('needs_input records the question for the human', async () => {
    const client = new Fake(completed({ status: 'needs_input', summary: 'unclear', question: 'Is OAuth in scope?' }))
    const r = await dispatchPhase({ client, exec: fakeExec() }, cwd, 'login', signal)
    expect(r).toMatchObject({ status: 'needs_input', question: 'Is OAuth in scope?' })
    expect(getSection((await readTask(cwd, 'login')).body, 'Open questions')).toContain('Is OAuth in scope?')
  })

  it.each([
    ['non-completed stopReason', { stopReason: 'aborted', outputText: '' } as RunResult, /stopReason "aborted"/],
    ['missing structured output', { stopReason: 'completed', outputText: 'prose' } as RunResult, /invalid report/],
    ['review done without verdict', completed({ status: 'done', summary: 'meh' }), /without a verdict/],
  ])('treats %s as a failed attempt (retry, not advance)', async (_n, reply, msg) => {
    await dispatchPhase({ client: new Fake(reply), exec: fakeExec() }, cwd, 'login', signal)
    const t = await readTask(cwd, 'login')
    expect(t.frontmatter).toMatchObject({ phase: 'code-review', status: 'in_progress', retries: 1 })
    expect(getSection(t.body, 'Log')).toMatch(msg)
  })

  it('a start rejection (e.g. UNSUPPORTED_CAPABILITY) fails closed and is recorded', async () => {
    const client = new Fake(new Error('UNSUPPORTED_CAPABILITY: toolFilter'))
    await dispatchPhase({ client, exec: fakeExec() }, cwd, 'login', signal)
    const t = await readTask(cwd, 'login')
    expect(t.frontmatter.phase).toBe('code-review')
    expect(getSection(t.body, 'Log')).toContain('UNSUPPORTED_CAPABILITY')
  })

  it('orchestrator verification overrides a child that claims success', async () => {
    const cfgPath = join(cwd, '.odd', 'config.yml')
    const { readFile } = await import('node:fs/promises')
    await writeFile(cfgPath, (await readFile(cfgPath, 'utf8')).replace('# verify_command: ""', 'verify_command: "pnpm test"'))
    const client = new Fake(completed({ status: 'done', verdict: 'approve', summary: 'all green', tests_command: 'pnpm test', tests_result: 'pass' }))
    await dispatchPhase({ client, exec: fakeExec({ 'pnpm test': { code: 1, output: '2 failed' } }) }, cwd, 'login', signal)
    const t = await readTask(cwd, 'login')
    expect(t.frontmatter).toMatchObject({ phase: 'code-review', retries: 1 })
    expect(getSection(t.body, 'Evidence')).toContain('orchestrator verified `pnpm test` => exit 1')
    expect(getSection(t.body, 'Evidence')).toContain('unverified')
  })

  it('refuses non-dispatchable phases, finished tasks and missing skills', async () => {
    const noSkill = await mkdtemp(join(tmpdir(), 'odd-n-'))
    await initOdd(noSkill)
    await createTask(noSkill, { name: 't', type: 'hotfix' })
    await expect(dispatchPhase({ client: new Fake(completed({})), exec: fakeExec() }, noSkill, 't', signal)).rejects.toThrow(/not dispatchable/)
    await mutateTask(noSkill, 't', (t, c) => advance(t, c, { outcome: 'done', summary: 'fixed' })) // fix -> code-review
    await expect(dispatchPhase({ client: new Fake(completed({})), exec: fakeExec() }, noSkill, 't', signal)).rejects.toThrow(/Skill "code-review" not found/)
    await rm(noSkill, { recursive: true, force: true })
  })

  it('detects a task that changed while the child was running', async () => {
    const client = new Fake(async () => {
      await mutateTask(cwd, 'login', (t, c) => advance(t, c, { outcome: 'blocked', summary: 'human stopped it' }))
      return completed({ status: 'done', verdict: 'approve', summary: 'ok' })
    })
    await expect(dispatchPhase({ client, exec: fakeExec() }, cwd, 'login', signal)).rejects.toThrow(/changed while/)
  })

  it('phase_skills: the review phase runs YOUR skill under its own name', async () => {
    const { readFile } = await import('node:fs/promises')
    await mkdir(join(cwd, '.odd', 'skills', 'strict-review'), { recursive: true })
    await writeFile(join(cwd, '.odd', 'skills', 'strict-review', 'SKILL.md'), '---\nname: strict-review\ndescription: strict\n---\nBE VERY STRICT')
    const cfgPath = join(cwd, '.odd', 'config.yml')
    await writeFile(cfgPath, (await readFile(cfgPath, 'utf8')) + '\nphase_skills:\n  code-review: strict-review\n')
    const client = new Fake(completed({ status: 'done', verdict: 'approve', summary: 'ok' }))
    await dispatchPhase({ client, exec: fakeExec() }, cwd, 'login', signal)
    expect(client.calls[0]!.prompt).toContain('BE VERY STRICT')
    expect(client.calls[0]!.prompt).not.toContain('Review for bugs and missing tests.')
    expect(getSection((await readTask(cwd, 'login')).body, 'Handoffs')).toContain('skill: strict-review@.odd/skills')
  })

  it('phaseMode reflects config', async () => {
    const cfg = await loadConfig(cwd)
    expect(phaseMode(cfg, 'code-review')).toBe('subagent')
    expect(phaseMode(cfg, 'pair')).toBe('inline')
  })
})

describe('packet + skill loader', () => {
  it('truncates huge diffs and notes unavailable diffs', async () => {
    const t = await readTask(cwd, 'login')
    const big = buildPacket({ task: t, phase: 'code-review', skillName: 's', skillText: 'x', role: ROLE_DEFAULTS, diff: 'a'.repeat(70_000) })
    expect(big).toContain('truncated 10000 characters')
    const err = buildPacket({ task: t, phase: 'code-review', skillName: 's', skillText: 'x', role: ROLE_DEFAULTS, diff: '', diffError: 'git failed' })
    expect(err).toContain('diff unavailable')
  })

  it('mergeConfig keeps working for configs written before phase 2', () => {
    expect(mergeConfig({ version: 1, mode: 'manual' }).dispatch['code-review']).toBeDefined()
  })
})
