import { createHash } from 'node:crypto'
import type { MemoryConfig } from './config'
import { REQUIRED_MEMORY_TOOLS, mcpToolName } from './memory-tools'
import { appendLog, getSection, progress, setSection, type Task } from './task'

/**
 * Engram integration, derived-memory side.
 *
 * Rules (enforced here, not by convention):
 *  - The task md is the source of truth. Engram only receives curated sections
 *    (Goal, Decisions, Root cause, Lessons, a digest). Log, Handoffs, Evidence,
 *    Open questions and Next step are NEVER saved: history stays in the md.
 *  - Saves are idempotent: deterministic topic_key, so re-running updates in place.
 *  - Automated saves use capture_prompt=false (Engram's own recommendation).
 *  - Secrets are redacted before anything leaves the task file.
 *
 * topic_key convention (Engram: "family/description", kebab-case, max 2 levels):
 *   odd/<task>                       digest of the whole task (upserted)
 *   decision/<task>-<slug>-<hash>    one per bullet in ## Decisions
 *   bug/<task>-root-cause            ## Root cause
 *   learning/<task>-<slug>-<hash>    one per bullet in ## Lessons
 */

export interface SavePayload {
  title: string
  type: string
  content: string
  topic_key: string
  scope: string
  capture_prompt: false
  project?: string
}

export interface CapturePlan {
  items: SavePayload[]
  /** Observations that were not produced because of the item cap. */
  dropped: number
  redactions: number
  truncated: number
}

export const NEVER_SAVED = ['Log', 'Handoffs', 'Evidence', 'Open questions', 'Next step']
export const MAX_ITEMS = 25

// ------------------------------------------------------------- text helpers

export function slugify(text: string, max = 40): string {
  const s = text.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return s.slice(0, max).replace(/-+$/, '') || 'item'
}

/** Stable across whitespace/case edits, so cosmetic changes do not fork the key. */
export function shortHash(text: string): string {
  return createHash('sha1').update(text.trim().replace(/\s+/g, ' ').toLowerCase()).digest('hex').slice(0, 6)
}

const SECRET_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
]
const KEY_VALUE = /\b(password|passwd|secret|token|api[_-]?key)(\s*[:=]\s*)(?!\[REDACTED\])\S+/gi

/** Conservative: it removes obvious credentials, it is not a DLP system. */
export function redact(text: string): { text: string; count: number } {
  let count = 0
  let out = text
  for (const re of SECRET_PATTERNS) out = out.replace(re, () => { count++; return '[REDACTED]' })
  out = out.replace(KEY_VALUE, (_m, k: string, sep: string) => { count++; return `${k}${sep}[REDACTED]` })
  return { text: out, count }
}

const stripComments = (s: string) => s.replace(/<!--[\s\S]*?-->/g, '').trim()
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s)
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim()

/** Bullets of a section; indented continuation lines are joined; comments and empties ignored. */
export function extractItems(section: string | undefined): string[] {
  if (!section) return []
  const items: string[] = []
  for (const raw of stripComments(section).split('\n')) {
    const bullet = /^[-*]\s+(?:\[[ xX]\]\s+)?(.*\S)\s*$/.exec(raw)
    if (bullet) items.push(bullet[1]!)
    else if (/^\s{2,}\S/.test(raw) && items.length) items[items.length - 1] += ' ' + raw.trim()
  }
  return items
}

// ------------------------------------------------------------------ capture

export function planCapture(task: Task, cfg: MemoryConfig, _now = new Date()): CapturePlan {
  const fm = task.frontmatter
  const plan: CapturePlan = { items: [], dropped: 0, redactions: 0, truncated: 0 }
  // Scrub BEFORE deriving anything: titles, content AND topic_key slugs/hashes are all
  // persisted, so a secret must never reach any of them (it used to leak through the slug).
  const scrub = (s: string) => { const r = redact(s); plan.redactions += r.count; return r.text }
  const title = scrub(/^# (.+)$/m.exec(task.body)?.[1]?.trim() ?? fm.id)
  const goal = scrub(oneLine(stripComments(getSection(task.body, 'Goal') ?? '')))
  const decisions = extractItems(getSection(task.body, 'Decisions')).map(scrub)
  const lessons = extractItems(getSection(task.body, 'Lessons')).map(scrub)
  const rootCause = scrub(stripComments(getSection(task.body, 'Root cause') ?? ''))
  const { done, total } = progress(task)
  const source = `**Source**: ODD task \`${fm.id}\` (${fm.type}, status=${fm.status}). Source of truth: .odd/tasks/${fm.id}.md`
  const base = { scope: cfg.scope, capture_prompt: false as const, ...(cfg.project ? { project: cfg.project } : {}) }

  const push = (p: { title: string; type: string; content: string; topic_key: string }) => {
    if (plan.items.length >= MAX_ITEMS) { plan.dropped++; return }
    // Defense in depth: inputs are already scrubbed, so this normally finds nothing.
    const t = redact(clip(oneLine(p.title), 100))
    const c = redact(p.content)
    plan.redactions += t.count + c.count
    let content = c.text
    if (content.length > cfg.max_item_chars) { content = clip(content, cfg.max_item_chars); plan.truncated++ }
    plan.items.push({ ...base, title: t.text, type: p.type, content, topic_key: p.topic_key })
  }

  push({
    title: `${title} [odd task ${fm.id}]`,
    type: fm.type === 'hotfix' ? 'bugfix' : 'architecture',
    topic_key: `odd/${fm.id}`,
    content: [
      `**What**: ${title} (${fm.type} task, status=${fm.status})`,
      `**Why**: ${goal || 'n/a'}`,
      `**Outcome**: ${done}/${total} phases done; review loops ${fm.review_loops}; branch ${fm.branch ?? 'n/a'}`,
      `**Decisions**: ${decisions.length} (saved as decision/${fm.id}-* observations)`,
      `**Lessons**: ${lessons.length}`,
      source,
    ].join('\n'),
  })

  for (const d of decisions) {
    push({
      title: `${fm.id}: ${clip(d, 80)}`,
      type: 'decision',
      topic_key: `decision/${fm.id}-${slugify(d)}-${shortHash(d)}`,
      content: `**What**: ${d}\n**Context**: task goal - ${goal || 'n/a'}\n${source}`,
    })
  }

  if (rootCause) {
    push({
      title: `${fm.id}: root cause`,
      type: 'bugfix',
      topic_key: `bug/${fm.id}-root-cause`,
      content: `**What**: ${rootCause}\n**Context**: task goal - ${goal || 'n/a'}\n${source}`,
    })
  }

  for (const l of lessons) {
    push({
      title: `${fm.id}: lesson - ${clip(l, 70)}`,
      type: 'discovery',
      topic_key: `learning/${fm.id}-${slugify(l)}-${shortHash(l)}`,
      content: `**Learned**: ${l}\n**Context**: task goal - ${goal || 'n/a'}\n${source}`,
    })
  }
  return plan
}

/** Eligibility: capture when a task is closed. A blocked task carries lessons too. */
export function assertCapturable(task: Task): void {
  const s = task.frontmatter.status
  if (s !== 'done' && s !== 'blocked') {
    throw new Error(`Memory is captured when a task is closed (done) or blocked; "${task.frontmatter.id}" is ${s}`)
  }
}

/** Trace in the md what was prepared. Replaced (not appended) because keys are deterministic. */
export function recordCapture(task: Task, plan: CapturePlan, now = new Date()): Task {
  const lines = plan.items.map((i) => `- ${i.topic_key} (${i.type})`)
  const body = setSection(task.body, 'Memory', `Prepared for Engram on ${now.toISOString()} (the agent performs the saves):\n${lines.join('\n')}`)
  return appendLog({ ...task, body }, 'orchestrator', `memory: prepared ${plan.items.length} Engram item(s)${plan.redactions ? `, ${plan.redactions} secret(s) redacted` : ''}`, now)
}

export function formatCapture(task: Task, plan: CapturePlan, server: string): string {
  const save = mcpToolName(server, 'mem_save')
  const id = task.frontmatter.id
  const head =
    `Engram capture plan for task "${id}": ${plan.items.length} item(s).\n` +
    `Call ${save} once per item below, with exactly these arguments. They are idempotent: the same topic_key updates the observation in place.\n`
  const body = plan.items.map((i, n) => `${n + 1}. ${JSON.stringify(i)}`).join('\n')
  const notes = [
    `Never saved by design: ${NEVER_SAVED.join(', ')} (history stays in the task file).`,
    plan.redactions ? `Redacted ${plan.redactions} secret-like value(s).` : '',
    plan.truncated ? `Truncated ${plan.truncated} item(s) to the configured limit.` : '',
    plan.dropped ? `Dropped ${plan.dropped} item(s) over the cap of ${MAX_ITEMS}.` : '',
    `Do not add transcripts, logs or secrets. If a save fails, report it: the task file stays the source of truth.`,
  ].filter(Boolean)
  return `${head}\n${body}\n\n${notes.join('\n')}`
}

// ------------------------------------------------------------------- recall

const STOP = new Set((
  'the and for with from that this into when then than have has had was were are not but can could should would about after before ' +
  'over under make makes made add adds new use uses using fix fixes task feature hotfix refactor ' +
  'que los las una uno unos unas con para por del como pero sin sobre entre desde hasta cuando donde esta este eso ese ' +
  'hacer agregar nuevo nueva usar arreglar tarea'
).split(' '))

export function keywords(text: string, max = 5): string[] {
  const seen = new Set<string>()
  for (const w of text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []) {
    if (!STOP.has(w)) seen.add(w)
    if (seen.size >= max) break
  }
  return [...seen]
}

export interface RecallCall { tool: string; args: Record<string, unknown> }

export function planRecall(task: Task, cfg: MemoryConfig): RecallCall[] {
  const fm = task.frontmatter
  const title = /^# (.+)$/m.exec(task.body)?.[1]?.trim() ?? fm.id
  const goal = oneLine(stripComments(getSection(task.body, 'Goal') ?? ''))
  const q = keywords(`${title} ${goal}`).join(' ') || title
  const proj = cfg.project ? { project: cfg.project } : {}
  const t = (n: string) => mcpToolName(cfg.server_name, n)
  return [
    { tool: t('mem_context'), args: { ...proj } },
    { tool: t('mem_search'), args: { query: q, limit: cfg.recall_limit, ...proj } },
    { tool: t('mem_search'), args: { query: q, type: fm.type === 'hotfix' ? 'bugfix' : 'decision', limit: cfg.recall_limit, ...proj } },
  ]
}

export function formatRecall(task: Task, calls: RecallCall[], server: string): string {
  const id = task.frontmatter.id
  const get = mcpToolName(server, 'mem_get_observation')
  return [
    `Engram recall plan for task "${id}". Run these calls (results are compact previews):`,
    ...calls.map((c, n) => `${n + 1}. ${c.tool} ${JSON.stringify(c.args)}`),
    `If a preview looks relevant, call ${get} with its id for the full text.`,
    ``,
    `Rules:`,
    `- Memory is derived from past work. If it contradicts the task file, the task file wins. Never edit the task file from memory alone.`,
    `- If a memory changes what you do, write it into the task file as a Decision (odd_task_note, section "Decisions") and cite the observation id.`,
    `- Ignore memories that do not clearly apply to this task.`,
  ].join('\n')
}

// ------------------------------------------------------------------- status

export function engramPatchRow(server: string): string {
  return [
    '- insert:',
    '    - id: mcp-engram',
    "      name: '@deepseek-ai/dsh-mcp-client'",
    '      config:',
    `        serverName: ${server}`,
    '        transport: stdio',
    '        command: engram',
    "        args: ['mcp', '--tools=agent']",
  ].join('\n')
}

/** Which of the tools the orchestrator needs are not registered (undefined = registry unreadable). */
export function missingMemoryTools(server: string, registered: string[] | undefined): string[] | undefined {
  if (!registered) return undefined
  const set = new Set(registered)
  return REQUIRED_MEMORY_TOOLS.map((t) => mcpToolName(server, t)).filter((n) => !set.has(n))
}

export function formatMemoryStatus(cfg: MemoryConfig, registered: string[] | undefined): string {
  const lines = [`Engram integration: ${cfg.enabled ? 'enabled' : 'DISABLED'} (memory.enabled in .odd/config.yml)`]
  lines.push(`Server name: ${cfg.server_name} -> tools are mcp__${cfg.server_name}__mem_*  | scope: ${cfg.scope}${cfg.project ? ` | project: ${cfg.project}` : ' | project: auto-detected by Engram'}`)
  const missing = missingMemoryTools(cfg.server_name, registered)
  if (missing === undefined) lines.push('Could not read the tool registry to check the Engram tools.')
  else if (missing.length === 0) lines.push('Engram MCP tools: all required tools are registered.')
  else {
    lines.push(`Engram MCP tools missing: ${missing.join(', ')}`)
    lines.push('Mount Engram (stdio) by adding this row to your profile cordis.patch.yml (it must be inside insert:), then restart or hot-reload dsh:')
    lines.push(engramPatchRow(cfg.server_name))
    lines.push('(MCP tools connect asynchronously; if the row is already mounted, wait a moment and retry.)')
  }
  return lines.join('\n')
}
