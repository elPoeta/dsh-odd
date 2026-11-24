import type { RoleConfig } from './config'
import { getSection, type Task } from './task'

export const MAX_DIFF_CHARS = 60_000

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}\n\n[... truncated ${text.length - max} characters; read the files directly for the rest ...]`
}

export interface PacketInput {
  task: Task
  phase: string
  skillName: string
  skillText: string
  role: RoleConfig
  /** undefined = not requested; '' = requested but empty. */
  diff?: string
  diffError?: string
}

const block = (title: string, body: string | undefined) => (body && body.trim() ? `## ${title}\n${body.trim()}\n\n` : '')

/**
 * The ONLY context the subagent gets. Deliberately excludes Log, Handoffs and
 * Open questions: history is the orchestrator's business, not the executor's.
 */
export function buildPacket(i: PacketInput): string {
  const { task, phase, role } = i
  const title = /^# (.+)$/m.exec(task.body)?.[1] ?? task.frontmatter.id
  let out = `# Handoff: phase "${phase}" for "${title}"\n\n`
  out += `You are an executor with a clean context. Everything you may rely on is in this message. `
  out += `Task type: ${task.frontmatter.type}. Branch: ${task.frontmatter.branch ?? 'n/a'}.\n\n`
  out += block('Goal', getSection(task.body, 'Goal'))
  out += block('Decisions so far', getSection(task.body, 'Decisions'))
  out += block('Evidence so far (includes earlier review findings)', getSection(task.body, 'Evidence'))
  if (i.diff !== undefined) {
    out += i.diffError
      ? `## Changes under review\n(diff unavailable: ${i.diffError}. Inspect the files directly.)\n\n`
      : `## Changes under review\n${i.diff.trim() ? '```diff\n' + truncate(i.diff, MAX_DIFF_CHARS) + '\n```' : '(no changes detected)'}\n\n`
  }
  out += `## Skill instructions: ${i.skillName}\n${i.skillText.trim()}\n\n`
  out += `## Rules\n`
  out += `- You cannot talk to the human. If you need a decision, return status "needs_input" with a "question".\n`
  out += `- Do not read or edit .odd/tasks/*.md; the orchestrator owns it.\n`
  if (role.readonly) out += `- You are read-only. Do not modify any file or run mutating commands.\n`
  out += `- Do not claim tests passed unless you ran them; the orchestrator re-verifies.\n\n`
  out += `## Output contract\n`
  out += `Return your final answer ONLY as the structured output with these fields:\n`
  out += `- status: done | needs_input | blocked | failed\n`
  out += `- verdict: approve | changes_requested (required for code-review when status is done)\n`
  out += `- summary: one short paragraph\n`
  out += `- question: only for needs_input\n`
  out += `- findings: one string per issue, formatted "[blocker|major|minor|nit] path:line - issue"\n`
  out += `- files_touched, tests_command, tests_result, decisions: as applicable\n`
  return out
}
