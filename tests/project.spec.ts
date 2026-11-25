import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, parse } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ProjectError, resolveProject } from '../src/core/project'

let home: string
beforeEach(async () => { home = await realpath(await mkdtemp(join(tmpdir(), 'odd-p-'))) })
afterEach(() => rm(home, { recursive: true, force: true }))

describe('resolveProject', () => {
  it('uses the nearest .git ancestor of the session cwd', async () => {
    const repo = join(home, 'a', 'repo')
    await mkdir(join(repo, '.git'), { recursive: true })
    await mkdir(join(repo, 'x', 'y'), { recursive: true })
    expect(await resolveProject(join(repo, 'x', 'y'), { home })).toBe(repo)
    expect(await resolveProject(repo, { home })).toBe(repo)
  })
  it('nested repos: the innermost one wins, like DSH', async () => {
    const outer = join(home, 'outer'); const inner = join(outer, 'inner')
    await mkdir(join(outer, '.git'), { recursive: true })
    await mkdir(join(inner, '.git'), { recursive: true })
    expect(await resolveProject(join(inner, 'src'), { home })).toBe(inner)
  })
  it('falls back to the session cwd when there is no git repo (outside home)', async () => {
    const plain = join(home, 'scratch'); await mkdir(plain)
    expect(await resolveProject(plain, { home })).toBe(plain)
  })
  it('refuses the home folder and the filesystem root', async () => {
    await expect(resolveProject(home, { home })).rejects.toThrow(ProjectError)
    await expect(resolveProject(parse(home).root, { home })).rejects.toThrow(/filesystem root/)
  })
  it('an explicit override wins, even over the home folder guard', async () => {
    expect(await resolveProject(home, { home, override: home })).toBe(home)
  })
})
