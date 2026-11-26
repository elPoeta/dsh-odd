import { parse, stringify } from 'yaml'

export type TaskType = 'feature' | 'hotfix' | 'refactor' | 'plan'
export type TaskStatus = 'todo' | 'in_progress' | 'needs_input' | 'blocked' | 'done'

export const TASK_TYPES: TaskType[] = ['feature', 'hotfix', 'refactor', 'plan']
export const TASK_STATUSES: TaskStatus[] = ['todo', 'in_progress', 'needs_input', 'blocked', 'done']

export interface Frontmatter {
  id: string
  type: TaskType
  status: TaskStatus
  phase: string
  branch?: string
  /** Task that spawned this one (a plan task that produced tickets). */
  parent?: string
  /** Tasks that must be done before this one can start. */
  blocked_by?: string[]
  review_loops: number
  retries: number
  created: string
  updated: string
  [key: string]: unknown
}

export interface Task {
  frontmatter: Frontmatter
  /** Everything after the frontmatter: `# Title` + `## Section` blocks. */
  body: string
}

export const NAME_RE = /^[a-z0-9][a-z0-9-]*$/

const FM_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/

export function parseTask(text: string): Task {
  const m = FM_RE.exec(text.replace(/\r\n/g, '\n'))
  if (!m) throw new Error('Task file has no YAML frontmatter')
  const fm = parse(m[1] ?? '') as Partial<Frontmatter> | null
  if (!fm || typeof fm !== 'object') throw new Error('Invalid frontmatter')
  if (typeof fm.id !== 'string' || !NAME_RE.test(fm.id)) throw new Error(`Invalid task id: ${String(fm.id)}`)
  if (!TASK_TYPES.includes(fm.type as TaskType)) throw new Error(`Invalid task type: ${String(fm.type)}`)
  if (!TASK_STATUSES.includes(fm.status as TaskStatus)) throw new Error(`Invalid status: ${String(fm.status)}`)
  if (typeof fm.phase !== 'string') throw new Error('Missing phase')
  if (fm.blocked_by !== undefined && (!Array.isArray(fm.blocked_by) || fm.blocked_by.some((b) => typeof b !== 'string' || !NAME_RE.test(b)))) {
    throw new Error('blocked_by must be a list of task ids')
  }
  if (fm.parent !== undefined && (typeof fm.parent !== 'string' || !NAME_RE.test(fm.parent))) throw new Error('parent must be a task id')
  return {
    frontmatter: {
      ...(fm as Frontmatter),
      review_loops: Number(fm.review_loops ?? 0),
      retries: Number(fm.retries ?? 0),
    },
    body: m[2] ?? '',
  }
}

export function serializeTask(task: Task): string {
  const body = task.body.startsWith('\n') ? task.body : '\n' + task.body
  return `---\n${stringify(task.frontmatter).trimEnd()}\n---\n${body.replace(/\s+$/, '')}\n`
}

// ---------------------------------------------------------------- sections

interface Section { name: string; content: string }
interface Split { pre: string; sections: Section[] }

const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})/

/** Tracks fenced code blocks so `## ` lines inside them are never treated as headings. */
class Fence {
  private open: string | null = null
  /** Feed one line; returns true when the line is inside a fence or is a fence delimiter. */
  feed(line: string): boolean {
    const m = FENCE_RE.exec(line)
    if (this.open === null) {
      if (m) { this.open = m[1]!; return true }
      return false
    }
    if (m && m[1]![0] === this.open[0] && m[1]!.length >= this.open.length && /^\s{0,3}(`{3,}|~{3,})\s*$/.test(line)) this.open = null
    return true
  }
  get unclosed(): string | null { return this.open }
}

function split(body: string): Split {
  const lines = body.replace(/^\n+/, '').split('\n')
  const pre: string[] = []
  const sections: { name: string; lines: string[] }[] = []
  const fence = new Fence()
  for (const line of lines) {
    const inFence = fence.feed(line)
    const h = inFence ? null : /^## (.+?)\s*$/.exec(line)
    if (h) sections.push({ name: h[1]!, lines: [] })
    else if (sections.length) sections[sections.length - 1]!.lines.push(line)
    else pre.push(line)
  }
  return {
    pre: pre.join('\n').trimEnd(),
    sections: sections.map((s) => ({ name: s.name, content: s.lines.join('\n').trim() })),
  }
}

/**
 * Text written into a section must never be able to change the file's structure:
 * `#` / `##` headings outside code fences are demoted to `###`, and an unclosed
 * fence is closed. (Their original headings stay readable, just one level deeper.)
 */
export function sanitizeBlock(text: string): string {
  const fence = new Fence()
  const out = text.replace(/\r\n/g, '\n').split('\n').map((line) => {
    const inFence = fence.feed(line)
    return inFence ? line : line.replace(/^(#{1,2})(\s+)/, '###$2')
  })
  const open = fence.unclosed
  if (open) out.push(open)
  return out.join('\n')
}

/** Section names present in a task body, in order. */
export function sectionNames(body: string): string[] {
  return split(body).sections.map((s) => s.name)
}

/** Every section ODD tools and skills know about. Notes to other names are rejected. */
export const KNOWN_SECTIONS = [
  'Goal', 'Plan', 'Next step', 'Backlog', 'Story', 'Acceptance criteria', 'Implementation plan', 'Out of scope',
  'Suggestions', 'Tickets', 'Test list', 'Root cause', 'Decisions', 'Answers', 'Lessons', 'Handoffs', 'Reviews',
  'Verification', 'Delivery', 'Log', 'Open questions', 'Evidence', 'Memory',
]

function join({ pre, sections }: Split): string {
  const blocks = sections.map((s) => `## ${s.name}${s.content ? '\n' + s.content : ''}`)
  return [pre, ...blocks].filter((b) => b !== '').join('\n\n') + '\n'
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

export function getSection(body: string, name: string): string | undefined {
  return split(body).sections.find((s) => same(s.name, name))?.content
}

export function setSection(body: string, name: string, content: string): string {
  const sp = split(body)
  const found = sp.sections.find((s) => same(s.name, name))
  const clean = sanitizeBlock(content).trim()
  if (found) found.content = clean
  else sp.sections.push({ name, content: clean })
  return join(sp)
}

export function appendToSection(body: string, name: string, text: string): string {
  const current = getSection(body, name) ?? ''
  const clean = sanitizeBlock(text)
  return setSection(body, name, current ? `${current}\n${clean}` : clean)
}

// --------------------------------------------------------------- checklist

export interface CheckItem { done: boolean; text: string }

export function parseChecklist(content: string): CheckItem[] {
  const items: CheckItem[] = []
  for (const line of content.split('\n')) {
    const m = /^\s*- \[( |x|X)\] (.*)$/.exec(line)
    if (m) items.push({ done: m[1] !== ' ', text: m[2]! })
  }
  return items
}

/**
 * Tick the first unchecked item whose text starts with `prefix` (or, with `fuzzy`, contains it).
 * Returns the body unchanged when nothing matched.
 */
export function checkItem(body: string, section: string, prefix: string, fuzzy = false): string {
  const content = getSection(body, section)
  if (content === undefined) return body
  const lines = content.split('\n')
  const want = prefix.trim().toLowerCase()
  const find = (match: (t: string) => boolean) =>
    lines.findIndex((l) => { const m = /^(\s*- )\[ \]( .*)$/.exec(l); return !!m && match(m[2]!.trim().toLowerCase()) })
  let idx = find((t) => t.startsWith(want))
  if (idx === -1 && fuzzy) idx = find((t) => t.includes(want))
  if (idx === -1) return body
  const m = /^(\s*- )\[ \]( .*)$/.exec(lines[idx]!)!
  lines[idx] = `${m[1]}[x]${m[2]}`
  return setSection(body, section, lines.join('\n'))
}

/** Unchecked items of a section, as plain text. */
export function uncheckedItems(body: string, section: string): string[] {
  return parseChecklist(getSection(body, section) ?? '').filter((i) => !i.done).map((i) => i.text)
}

/** Tick the LAST unchecked item of a section (used to close the latest open question). */
export function checkLastUnchecked(body: string, section: string): { body: string; text?: string } {
  const content = getSection(body, section)
  if (content === undefined) return { body }
  const lines = content.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = /^(\s*- )\[ \] (.*)$/.exec(lines[i]!)
    if (m) { lines[i] = `${m[1]}[x] ${m[2]}`; return { body: setSection(body, section, lines.join('\n')), text: m[2] } }
  }
  return { body }
}

export function sectionProgress(body: string, section: string): { done: number; total: number } {
  const items = parseChecklist(getSection(body, section) ?? '')
  return { done: items.filter((i) => i.done).length, total: items.length }
}

export function progress(task: Task): { done: number; total: number } {
  const items = parseChecklist(getSection(task.body, 'Plan') ?? '')
  return { done: items.filter((i) => i.done).length, total: items.length }
}

// --------------------------------------------------------------------- log

export function logLine(actor: string, message: string, now: Date): string {
  return `- ${now.toISOString()} [${actor}] ${message}`
}

export function appendLog(task: Task, actor: string, message: string, now = new Date()): Task {
  return { ...task, body: appendToSection(task.body, 'Log', logLine(actor, message, now)) }
}

export function setNextStep(task: Task, text: string): Task {
  return { ...task, body: setSection(task.body, 'Next step', text) }
}
