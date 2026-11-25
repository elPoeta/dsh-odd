import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { agentsBlock, applyAgentsMd } from '../src/core/bootstrap'

let dir: string
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'odd-b-')) })
afterEach(() => rm(dir, { recursive: true, force: true }))
const read = () => readFile(join(dir, 'AGENTS.md'), 'utf8')

describe('AGENTS.md managed block', () => {
  it('creates the file when missing', async () => {
    expect(await applyAgentsMd(dir)).toBe('created')
    expect(await read()).toBe(agentsBlock() + '\n')
  })
  it('appends to an existing file, keeping the user content byte for byte', async () => {
    await writeFile(join(dir, 'AGENTS.md'), '# Rules\n\n- be nice\n\n')
    expect(await applyAgentsMd(dir)).toBe('updated')
    const md = await read()
    expect(md.startsWith('# Rules\n\n- be nice\n\n<!-- odd:begin')).toBe(true)
    expect(md.endsWith('<!-- odd:end -->\n')).toBe(true)
  })
  it('is idempotent', async () => {
    await applyAgentsMd(dir)
    const once = await read()
    expect(await applyAgentsMd(dir)).toBe('unchanged')
    expect(await read()).toBe(once)
  })
  it('refreshes a stale block in place without touching the rest', async () => {
    await writeFile(join(dir, 'AGENTS.md'), 'before\n\n<!-- odd:begin old -->\nOLD TEXT\n<!-- odd:end -->\n\nafter\n')
    expect(await applyAgentsMd(dir)).toBe('updated')
    const md = await read()
    expect(md).not.toContain('OLD TEXT')
    expect(md.startsWith('before\n\n')).toBe(true)
    expect(md.endsWith('\n\nafter\n')).toBe(true)
    expect(md.match(/odd:begin/g)).toHaveLength(1)
  })
  it('points at the configured root dir and never tells users to run /odd-init', () => {
    expect(agentsBlock('.work')).toContain('.work/tasks/')
    expect(agentsBlock()).toMatch(/never ask the user to run `\/odd-init`/)
  })
})
