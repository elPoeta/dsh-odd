import { cpSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The skills this plugin ships. Anything else a developer drops into skills/ is not ours to lint. */
export const SHIPPED = ['code-review', 'fix', 'grill', 'odd-orchestrator', 'pair', 'refactor', 'ship', 'story', 'tdd', 'testing', 'to-tickets', 'verify']

export const PLUGIN_SKILLS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills')

let copy: string | undefined
/** A private copy containing only the shipped skills: tests never see extra folders or edits-in-progress. */
export function shippedSkillsDir(): string {
  if (!copy) {
    copy = mkdtempSync(join(tmpdir(), 'odd-shipped-'))
    for (const n of SHIPPED) cpSync(join(PLUGIN_SKILLS_DIR, n), join(copy, n), { recursive: true })
  }
  return copy
}
