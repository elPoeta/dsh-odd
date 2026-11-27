import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll } from 'vitest'

/**
 * Hermetic tests: nothing may depend on the developer's real home, skills or DSH_* variables.
 * (A developer with their own skills in ~/.agents/skills would otherwise shadow the builtin
 * skills the tests expect, and any DSH_HOME in the shell would change where skills are searched.)
 */
const fakeHome = mkdtempSync(join(tmpdir(), 'odd-test-home-'))
process.env.HOME = fakeHome
process.env.USERPROFILE = fakeHome
for (const key of ['DSH_HOME', 'DSH_AGENTS_HOME', 'DSH_SESSION_ID']) delete process.env[key]

afterAll(() => rmSync(fakeHome, { recursive: true, force: true }))
