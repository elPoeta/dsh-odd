import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * DSH injects the project's AGENTS.md into every session started under it (workspace
 * instructions, from the project root down to the session cwd). A small managed block
 * there makes the main agent behave as the ODD orchestrator on its own, in this project
 * only, without the user running commands and without an agent preset.
 */
export const BLOCK_RE = /<!-- odd:begin[\s\S]*?<!-- odd:end -->/

export function agentsBlock(rootDir = '.odd'): string {
  return [
    '<!-- odd:begin (managed by dsh-plugin-odd; delete this block to opt out, or set bootstrap.agents_md: false in .odd/config.yml) -->',
    '## ODD workflow (Organic-Driven Development)',
    '',
    `This project tracks feature, hotfix and refactor work in markdown task files under \`${rootDir}/tasks/\`. The task file is the source of truth, not the chat.`,
    '',
    '- For a feature, hotfix or refactor request: call `odd_task_list` first. Resume a matching task, otherwise create one with `odd_task_create` (it sets up `.odd/` automatically; never ask the user to run `/odd-init`).',
    '- Then call `odd_skill_load` with name `odd-orchestrator` and follow that protocol.',
    '- Quick questions and tiny edits do not need a task.',
    '<!-- odd:end -->',
  ].join('\n')
}

export type AgentsMdResult = 'created' | 'updated' | 'unchanged'

/** Idempotent. Only touches the managed block; everything else in AGENTS.md is preserved. */
export async function applyAgentsMd(projectRoot: string, rootDir = '.odd'): Promise<AgentsMdResult> {
  const file = join(projectRoot, 'AGENTS.md')
  const block = agentsBlock(rootDir)
  let current: string | undefined
  try { current = await readFile(file, 'utf8') } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e }
  if (current === undefined) { await writeFile(file, block + '\n', 'utf8'); return 'created' }
  if (BLOCK_RE.test(current)) {
    const next = current.replace(BLOCK_RE, () => block)
    if (next === current) return 'unchanged'
    await writeFile(file, next, 'utf8')
    return 'updated'
  }
  await writeFile(file, current.replace(/\s*$/, '') + '\n\n' + block + '\n', 'utf8')
  return 'updated'
}
