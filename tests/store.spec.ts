import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { archiveTask, createTask, formatStatus, initOdd, listTasks, mutateTask, readTask } from '../src/core/store'
import { getSection } from '../src/core/task'
import { advance } from '../src/core/workflow'

let cwd: string
beforeEach(async () => { cwd = await mkdtemp(join(tmpdir(), 'odd-')) })
afterEach(() => rm(cwd, { recursive: true, force: true }))

describe('store', () => {
  it('init is idempotent and never overwrites', async () => {
    const first = await initOdd(cwd)
    expect(first.length).toBeGreaterThan(5)
    await writeFile(join(cwd, '.odd', 'config.yml'), 'version: 1\nmode: auto\n')
    expect(await initOdd(cwd)).toEqual([])
    expect(await readFile(join(cwd, '.odd', 'config.yml'), 'utf8')).toContain('mode: auto')
  })

  it('requires init before creating tasks', async () => {
    await expect(createTask(cwd, { name: 'a', type: 'feature' })).rejects.toThrow(/odd-init/)
  })

  it('creates, rejects duplicates and bad names', async () => {
    await initOdd(cwd)
    await createTask(cwd, { name: 'login-oauth', type: 'feature', goal: 'g' })
    await expect(createTask(cwd, { name: 'login-oauth', type: 'feature' })).rejects.toThrow(/already exists/)
    await expect(createTask(cwd, { name: '../evil', type: 'feature' })).rejects.toThrow(/Invalid task name/)
  })

  it('uses a project template override', async () => {
    await initOdd(cwd)
    const tpl = await readFile(join(cwd, '.odd', 'templates', 'feature.md'), 'utf8')
    await writeFile(join(cwd, '.odd', 'templates', 'feature.md'), tpl.replace('## Evidence', '## Evidence\n- project rule: link the PR'))
    await createTask(cwd, { name: 'a', type: 'feature' })
    expect(getSection((await readTask(cwd, 'a')).body, 'Evidence')).toContain('project rule')
  })

  it('RESUME: state survives across "sessions" (re-read from disk)', async () => {
    await initOdd(cwd)
    await createTask(cwd, { name: 'login-oauth', type: 'feature', goal: 'Sign in' })
    // session 1: finish the story phase, then stop
    await mutateTask(cwd, 'login-oauth', (t, c) => advance(t, c, { outcome: 'done', summary: '3 criteria agreed' }))
    // session 2: a brand new process only has the file
    const resumed = await readTask(cwd, 'login-oauth')
    expect(resumed.frontmatter.phase).toBe('pair')
    expect(getSection(resumed.body, 'Next step')).toContain('3 criteria agreed')
    const [s] = await listTasks(cwd)
    expect(s).toMatchObject({ id: 'login-oauth', phase: 'pair', done: 1, total: 5 })
    expect(formatStatus([s!])).toContain('1/5')
  })

  it('serializes concurrent writers with the lock', async () => {
    await initOdd(cwd)
    await createTask(cwd, { name: 'a', type: 'feature' })
    await Promise.all(Array.from({ length: 15 }, (_, i) =>
      mutateTask(cwd, 'a', (t) => ({ ...t, body: t.body.replace('## Decisions', `## Decisions\n- d${i}`) }))))
    const decisions = getSection((await readTask(cwd, 'a')).body, 'Decisions')!
    expect(decisions.split('\n')).toHaveLength(15)
    expect((await readdir(join(cwd, '.odd', 'tasks'))).filter((f) => f.includes('.lock') || f.includes('.tmp'))).toEqual([])
  })

  it('archives only finished tasks', async () => {
    await initOdd(cwd)
    await createTask(cwd, { name: 'h', type: 'hotfix' })
    await expect(archiveTask(cwd, 'h')).rejects.toThrow(/done/)
    for (let i = 0; i < 4; i++) await mutateTask(cwd, 'h', (t, c) => advance(t, c, { outcome: 'done', summary: 'ok' }))
    expect(await archiveTask(cwd, 'h')).toContain('archive')
    expect(await listTasks(cwd)).toEqual([])
  })
})
