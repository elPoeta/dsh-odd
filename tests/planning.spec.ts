import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, effectiveDeny, mergeConfig } from '../src/core/config'
import { parseReport, toAdvanceInput } from '../src/core/contract'
import { dispatchPhase, type RunRequest, type RunResult, type SubagentClient } from '../src/core/dispatch'
import { advance, resolveInput } from '../src/core/workflow'
import { archiveTask, createTask, formatStatus, initOdd, listTasks, mutateTask, readTask, unblockTask } from '../src/core/store'
import {
  KNOWN_SECTIONS, checkItem, checkLastUnchecked, getSection, parseTask, sanitizeBlock, sectionNames, serializeTask, setSection,
} from '../src/core/task'
import { registerAll } from '../src/host/adapter'
import { fakeCtx, sessionExec } from './fake-ctx'

const SKILLS = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills')
let home: string, proj: string
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'odd-pl-'))
  proj = join(home, 'proj')
  await mkdir(join(proj, '.git'), { recursive: true })
})
afterEach(() => rm(home, { recursive: true, force: true }))

const setup = () => {
  const f = fakeCtx()
  registerAll(f.ctx, { rootDir: '.odd', home, builtinDirs: [SKILLS] })
  const call = (name: string, args: any = {}) => f.call(name, args, sessionExec(proj))
  return { f, call }
}

describe('md integrity: text can never change the file structure', () => {
  it('headings outside fences are demoted; fenced headings are left alone', () => {
    const out = sanitizeBlock('# Title\n## Story\n### already fine\n```sh\n## not a heading\n# comment\n```\n## After')
    expect(out).toBe('### Title\n### Story\n### already fine\n```sh\n## not a heading\n# comment\n```\n### After')
  })
  it('an unclosed fence is closed, so it cannot swallow the next sections', () => {
    const body = setSection('# T\n\n## Goal\ng\n', 'Evidence', 'start ```sh\nnot a fence\n```js\nunclosed')
    const withNext = setSection(body, 'Log', 'later')
    expect(sectionNames(withNext)).toEqual(['Goal', 'Evidence', 'Log'])
  })
  it('split ignores headings inside a fence, even when written by hand', () => {
    const body = '# T\n\n## Delivery\n````markdown\n```bash\nx\n```\n## Story\n````\n\n## Log\nentry\n'
    expect(sectionNames(body)).toEqual(['Delivery', 'Log'])
    expect(getSection(body, 'Delivery')).toContain('## Story')
  })
  it('odd_task_note demotes a PR body so it cannot create sections', async () => {
    const { call } = setup()
    await call('odd_task_create', { name: 'pr-test', type: 'feature' })
    await call('odd_task_note', { name: 'pr-test', section: 'Delivery', text: '## Story\nAs a user\n## What changed\n- x', mode: 'replace' })
    const md = parseTask(await call('odd_task_read', { name: 'pr-test' }).then((s) => s.split('\n\n').slice(1).join('\n\n')))
    expect(sectionNames(md.body)).not.toContain('Story\nAs a user')
    expect(getSection(md.body, 'Delivery')).toContain('### Story')
    expect(sectionNames(md.body).filter((n) => n === 'Story')).toHaveLength(1)    // only the template's own one
  })
  it('odd_task_note rejects unknown sections, canonicalizes case, and supports replace', async () => {
    const { call } = setup()
    await call('odd_task_create', { name: 't1', type: 'feature' })
    await expect(call('odd_task_note', { name: 't1', section: 'Descisions', text: 'x' })).rejects.toThrow(/Unknown section "Descisions".*Decisions/)
    await call('odd_task_note', { name: 't1', section: 'acceptance CRITERIA', text: '- [ ] one' })
    await call('odd_task_note', { name: 't1', section: 'Acceptance criteria', text: '- [ ] two' })
    await call('odd_task_note', { name: 't1', section: 'Acceptance criteria', text: '- [ ] only', mode: 'replace' })
    const md = await call('odd_task_read', { name: 't1' })
    expect(md).toContain('- [ ] only')
    expect(md).not.toContain('- [ ] one')
    expect(md.match(/## Acceptance criteria/g)).toHaveLength(1)
  })
  it('every section the skills and tools use is known', () => {
    expect(KNOWN_SECTIONS).toEqual(expect.arrayContaining(['Backlog', 'Tickets', 'Story', 'Acceptance criteria', 'Implementation plan', 'Out of scope', 'Test list', 'Answers', 'Reviews', 'Verification', 'Delivery']))
  })
})

describe('odd_task_check', () => {
  it('ticks the test list, reports progress, and fuzzy-matches acceptance criteria', async () => {
    const { call } = setup()
    await call('odd_task_create', { name: 't2', type: 'feature' })
    await call('odd_task_note', { name: 't2', section: 'Test list', text: '- [ ] rejects an expired token (service)\n- [ ] (manual) layout looks right', mode: 'replace' })
    expect(await call('odd_task_check', { name: 't2', item: 'rejects an expired' })).toBe('Test list: 1/2 done')
    await call('odd_task_note', { name: 't2', section: 'Acceptance criteria', text: '- [ ] Given a token, when it expired, then login fails.', mode: 'replace' })
    expect(await call('odd_task_check', { name: 't2', section: 'Acceptance criteria', item: 'when it expired' })).toBe('Acceptance criteria: 1/1 done')
  })
  it('a miss lists what is still unchecked instead of failing silently', async () => {
    const { call } = setup()
    await call('odd_task_create', { name: 't3', type: 'feature' })
    await call('odd_task_note', { name: 't3', section: 'Test list', text: '- [ ] alpha\n- [x] beta', mode: 'replace' })
    await expect(call('odd_task_check', { name: 't3', item: 'zzz' })).rejects.toThrow(/Unchecked items:\n- alpha/)
    await expect(call('odd_task_check', { name: 't3', item: 'beta' })).rejects.toThrow(/No unchecked item/)
  })
  it('core helpers: prefix first, fuzzy only on request; last-unchecked closes the latest question', () => {
    const body = '# T\n\n## Test list\n- [ ] foo bar\n- [ ] bar baz\n'
    expect(checkItem(body, 'Test list', 'baz')).toBe(body)
    expect(getSection(checkItem(body, 'Test list', 'baz', true), 'Test list')).toContain('- [x] bar baz')
    const q = checkLastUnchecked('# T\n\n## Open questions\n- [ ] first\n- [ ] second\n', 'Open questions')
    expect(q.text).toBe('second')
    expect(getSection(q.body, 'Open questions')).toBe('- [ ] first\n- [x] second')
  })
})

describe('answers reach the next executor', () => {
  it('resolveInput records the answer under Answers and closes the question', async () => {
    await initOdd(proj)
    await createTask(proj, { name: 'a1', type: 'feature', phase: 'pair' })
    let t = await mutateTask(proj, 'a1', (task, cfg) => advance(task, cfg, { outcome: 'needs_input', summary: 'q', question: 'Is OAuth in scope?' }))
    expect(getSection(t.body, 'Open questions')).toBe('- [ ] Is OAuth in scope?')
    t = resolveInput(t, 'No, only password login')
    expect(getSection(t.body, 'Open questions')).toBe('- [x] Is OAuth in scope?')
    expect(getSection(t.body, 'Answers')).toBe('- [pair] Q: Is OAuth in scope? A: No, only password login')
  })

  it('a review that asked a question gets the answer in its NEXT packet', async () => {
    await initOdd(proj)
    await createTask(proj, { name: 'a2', type: 'feature', goal: 'login', phase: 'code-review' })
    const calls: RunRequest[] = []
    const replies: RunResult[] = [
      { stopReason: 'completed', outputText: '', structured: { status: 'needs_input', summary: 'unclear', question: 'Is OAuth in scope?' } },
      { stopReason: 'completed', outputText: '', structured: { status: 'done', verdict: 'approve', summary: 'ok' } },
    ]
    const client: SubagentClient = { run: async (req) => { calls.push(req); return replies.shift()! } }
    const deps = { client, exec: async () => ({ code: 0, output: '+x' }), builtinDirs: [SKILLS] }
    await dispatchPhase(deps, proj, 'a2', new AbortController().signal)
    expect(calls[0]!.prompt).not.toContain('No, only password login')
    await mutateTask(proj, 'a2', (t) => resolveInput(t, 'No, only password login'))
    await dispatchPhase(deps, proj, 'a2', new AbortController().signal)
    expect(calls[1]!.prompt).toContain('Answers from the human to earlier questions')
    expect(calls[1]!.prompt).toContain('Q: Is OAuth in scope? A: No, only password login')
  })
})

describe('task types, start phase and dependencies', () => {
  it('a plan task walks grill, backlog, to-tickets; a later start phase marks the earlier ones skipped', async () => {
    await initOdd(proj)
    const t = await createTask(proj, { name: 'idea', type: 'plan', phase: 'backlog' })
    expect(t.frontmatter.phase).toBe('backlog')
    expect(getSection(t.body, 'Plan')).toBe('- [x] grill (skipped)\n- [ ] backlog\n- [ ] to-tickets')
    expect(sectionNames(t.body)).toEqual(expect.arrayContaining(['Backlog', 'Tickets']))
    await expect(createTask(proj, { name: 'bad', type: 'feature', phase: 'grill' })).rejects.toThrow(/not a phase of the feature workflow/)
  })

  it('tickets are tasks with blockers: validation, readiness, and the frontier in the status', async () => {
    await initOdd(proj)
    await createTask(proj, { name: 'plan-1', type: 'plan' })
    await createTask(proj, { name: 'shop-01-skeleton', type: 'feature', phase: 'story', parent: 'plan-1' })
    await createTask(proj, { name: 'shop-02-cart', type: 'feature', phase: 'story', parent: 'plan-1', blockedBy: ['shop-01-skeleton'] })
    await expect(createTask(proj, { name: 'x-03', type: 'feature', blockedBy: ['ghost'] })).rejects.toThrow(/does not exist.*dependency order/)
    await expect(createTask(proj, { name: 'x-04', type: 'feature', blockedBy: ['x-04'] })).rejects.toThrow(/cannot block itself/)
    const tasks = await listTasks(proj)
    const cart = tasks.find((t) => t.id === 'shop-02-cart')!
    expect(cart.blockers).toEqual([{ id: 'shop-01-skeleton', state: 'open' }])
    const status = formatStatus(tasks)
    expect(status).toContain('shop-02-cart [feature] todo / story (0/5)  (from plan-1)  BLOCKED by shop-01-skeleton (not done)')
    expect(status).toContain('Ready to work (no pending blockers): plan-1, shop-01-skeleton')
    expect(status).not.toMatch(/Ready to work.*shop-02-cart/)
  })

  it('finishing or archiving a blocker releases its dependents; removing an edge is logged', async () => {
    await initOdd(proj)
    await createTask(proj, { name: 'b-01', type: 'hotfix' })
    await createTask(proj, { name: 'b-02', type: 'feature', blockedBy: ['b-01'] })
    for (let i = 0; i < 4; i++) await mutateTask(proj, 'b-01', (t, c) => advance(t, c, { outcome: 'done', summary: 'ok' }))
    expect((await listTasks(proj)).find((t) => t.id === 'b-02')!.blockers).toEqual([])      // done blocker
    await archiveTask(proj, 'b-01')
    expect((await listTasks(proj)).find((t) => t.id === 'b-02')!.blockers).toEqual([])      // archived still counts as done
    await createTask(proj, { name: 'b-03', type: 'feature', blockedBy: ['b-02'] })
    const after = await unblockTask(proj, 'b-03', 'b-02')
    expect(after.frontmatter.blocked_by).toBeUndefined()
    expect(getSection(after.body, 'Log')).toContain('dependency removed: no longer blocked by b-02')
    await expect(unblockTask(proj, 'b-03', 'b-02')).rejects.toThrow(/is not blocked by/)
  })

  it('frontmatter validates blocked_by and parent', () => {
    expect(() => parseTask('---\nid: a\ntype: feature\nstatus: todo\nphase: story\nblocked_by: nope\n---\n')).toThrow(/blocked_by/)
    expect(() => parseTask('---\nid: a\ntype: feature\nstatus: todo\nphase: story\nparent: Bad Id\n---\n')).toThrow(/parent/)
    const t = parseTask('---\nid: a\ntype: feature\nstatus: todo\nphase: story\nblocked_by: [b, c]\nparent: p\n---\n# A\n')
    expect(parseTask(serializeTask(t)).frontmatter).toMatchObject({ blocked_by: ['b', 'c'], parent: 'p' })
  })

  it('tools enforce it: a blocked task cannot be advanced or dispatched, and the header says why', async () => {
    const { call } = setup()
    await call('odd_task_create', { name: 'one', type: 'feature' })
    await call('odd_task_create', { name: 'two', type: 'feature', parent: 'one', blocked_by: 'one' })
    const header = await call('odd_task_read', { name: 'two' })
    expect(header).toContain('[odd] BLOCKED by one (not done)')
    await expect(call('odd_task_advance', { name: 'two', outcome: 'done', summary: 'x' })).rejects.toThrow(/blocked by one.*odd_task_unblock/)
    await expect(call('odd_dispatch', { name: 'two' })).rejects.toThrow(/blocked by one/)
    expect(await call('odd_task_list')).toContain('BLOCKED by one')
    expect(await call('odd_task_unblock', { name: 'two', blocker: 'one' })).toBe('blocked_by: nothing')
    expect(await call('odd_task_advance', { name: 'two', outcome: 'done', summary: 'x' })).toContain('phase=pair')
  })
})

describe('verify role, review packets and loops (with the real builtin skills)', () => {
  const ok = (structured: unknown): RunResult => ({ stopReason: 'completed', outputText: '', structured })
  const run = (reply: RunResult) => {
    const calls: RunRequest[] = []
    const client: SubagentClient = { run: async (req) => { calls.push(req); return reply } }
    return { calls, deps: { client, exec: async () => ({ code: 0, output: '+change' }), builtinDirs: [SKILLS] } }
  }
  const prepare = async (phase: string) => {
    await initOdd(proj)
    await createTask(proj, { name: 'v1', type: 'feature', goal: 'Cart', phase })
    await mutateTask(proj, 'v1', (t) => ({
      ...t,
      body: [
        ['Story', 'As a shopper, I want a cart, so that I can buy.'],
        ['Acceptance criteria', '- [ ] Given a cart, when I add an item, then the total updates.'],
        ['Out of scope', '- coupons'],
        ['Test list', '- [x] adds an item (service)\n- [ ] (manual) layout'],
      ].reduce((b, [s, c]) => setSection(b, s!, c!), t.body),
    }))
  }

  it('the code-review packet carries the story block, the diff and the embedded testing skill', async () => {
    await prepare('code-review')
    const { calls, deps } = run(ok({ status: 'done', verdict: 'approve', summary: 'ok' }))
    await dispatchPhase(deps, proj, 'v1', new AbortController().signal)
    const p = calls[0]!.prompt
    for (const s of ['## Story', 'As a shopper', '## Acceptance criteria', 'total updates', '## Out of scope', 'coupons', '## Changes under review', '+change']) expect(p).toContain(s)
    expect(p).toContain('## Reference skill: testing')
    expect(p).toContain('Signs of a weak test')
    expect(p).toContain('You are read-only')
    expect(getSection((await readTask(proj, 'v1')).body, 'Handoffs')).toMatch(/\(skill: code-review@builtin \+testing@builtin/)
  })

  it('verify may run commands but not edit: bash stays, write/edit go; no diff; manual items are visible', async () => {
    await prepare('verify')
    const { calls, deps } = run(ok({ status: 'done', verdict: 'approve', summary: 'all pass' }))
    await dispatchPhase(deps, proj, 'v1', new AbortController().signal)
    const req = calls[0]!
    expect(req.toolDeny).toEqual(expect.arrayContaining(['write', 'edit', 'apply_patch', 'odd_task_advance', 'mcp__engram__mem_save']))
    expect(req.toolDeny).not.toContain('bash')
    expect(req.toolDeny).not.toContain('pwsh')
    expect(req.prompt).toContain('You may run commands to observe behavior')
    expect(req.prompt).not.toContain('You are read-only')
    expect(req.prompt).not.toContain('## Changes under review')
    expect(req.prompt).toContain('(manual) layout')
    expect(req.prompt).toContain('Verify')
  })

  it('verify fail goes back to pair; the full write-up lands in Verification with the loop number', async () => {
    await prepare('verify')
    const { deps } = run(ok({
      status: 'done', verdict: 'changes_requested', summary: 'total does not update',
      findings: ['[blocker] adding an item updates the total - expected 10, actual 0'],
      details: '### Criteria\n- [ ] total updates: **fail**. Expected 10, actual 0',
    }))
    const r = await dispatchPhase(deps, proj, 'v1', new AbortController().signal)
    expect(r).toMatchObject({ outcome: 'changes_requested', nextPhase: 'pair' })
    const t = await readTask(proj, 'v1')
    expect(t.frontmatter.review_loops).toBe(1)
    expect(getSection(t.body, 'Verification')).toMatch(/### verify \(loop 1, .*\)\n### Criteria\n- \[ \] total updates: \*\*fail\*\*/)
    expect(getSection(t.body, 'Evidence')).toContain('verify finding (loop 1): [blocker] adding an item updates the total')
  })

  it('verify partial (unknowns) asks the human instead of passing; blocked stops', async () => {
    await prepare('verify')
    const { deps } = run(ok({ status: 'needs_input', summary: 'could not observe 1 criterion', question: 'Please check the layout manually: open /cart' }))
    expect(await dispatchPhase(deps, proj, 'v1', new AbortController().signal)).toMatchObject({ status: 'needs_input', question: expect.stringContaining('/cart') })
  })

  it('a verify done without a verdict is a failed attempt, like a review', () => {
    expect(toAdvanceInput('verify', parseReport({ status: 'done', summary: 'x' }), 's').outcome).toBe('failed')
    expect(toAdvanceInput('verify', parseReport({ status: 'done', verdict: 'approve', summary: 'x' }), 's').outcome).toBe('done')
  })
})

describe('config for the new roles', () => {
  it('allow_shell removes only the shell from the read-only deny list', () => {
    const verify = mergeConfig({}).dispatch.verify!
    const deny = effectiveDeny(verify)
    expect(verify).toMatchObject({ readonly: true, allow_shell: true, include_diff: false })
    expect(deny).toEqual(expect.arrayContaining(['write', 'edit', 'apply_patch', 'subagent', 'ask_user_question']))
    expect(deny).not.toEqual(expect.arrayContaining(['bash']))
    expect(effectiveDeny(mergeConfig({}).dispatch['code-review']!)).toEqual(expect.arrayContaining(['bash', 'pwsh']))
  })
  it('a user override keeps the default role settings it does not mention', () => {
    const cfg = mergeConfig({ dispatch: { 'code-review': { max_depth: 2 } } })
    expect(cfg.dispatch['code-review']).toMatchObject({ max_depth: 2, include_diff: true, skills: ['testing'] })
    expect(mergeConfig({ dispatch: { 'code-review': { skills: [] } } }).dispatch['code-review']!.skills).toEqual([])
  })
  it('ships plan, feature, hotfix and refactor workflows', () => {
    expect(DEFAULT_CONFIG.workflows).toEqual({
      plan: ['grill', 'backlog', 'to-tickets'],
      feature: ['story', 'pair', 'code-review', 'verify', 'ship'],
      hotfix: ['fix', 'code-review', 'verify', 'ship'],
      refactor: ['refactor', 'code-review', 'ship'],
    })
  })
  it('validates the new role fields', () => {
    expect(() => mergeConfig({ dispatch: { verify: { allow_shell: 'yes' as never } } })).toThrow(/allow_shell/)
    expect(() => mergeConfig({ dispatch: { verify: { skills: ['Bad Name'] } } })).toThrow(/skills/)
  })
})
