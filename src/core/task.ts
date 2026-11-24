import { parse, stringify } from 'yaml'

export type TaskType = 'feature' | 'hotfix' | 'refactor'
export type TaskStatus = 'todo' | 'in_progress' | 'needs_input' | 'blocked' | 'done'

export const TASK_TYPES: TaskType[] = ['feature', 'hotfix', 'refactor']
export const TASK_STATUSES: TaskStatus[] = ['todo', 'in_progress', 'needs_input', 'blocked', 'done']

export interface Frontmatter {
  id: string
  type: TaskType
  status: TaskStatus
  phase: string
  branch?: string
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

function split(body: string): Split {
  const lines = body.replace(/^\n+/, '').split('\n')
  const pre: string[] = []
  const sections: { name: string; lines: string[] }[] = []
  for (const line of lines) {
    const h = /^## (.+?)\s*$/.exec(line)
    if (h) sections.push({ name: h[1]!, lines: [] })
    else if (sections.length) sections[sections.length - 1]!.lines.push(line)
    else pre.push(line)
  }
  return {
    pre: pre.join('\n').trimEnd(),
    sections: sections.map((s) => ({ name: s.name, content: s.lines.join('\n').trim() })),
  }
}

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
  if (found) found.content = content.trim()
  else sp.sections.push({ name, content: content.trim() })
  return join(sp)
}

export function appendToSection(body: string, name: string, text: string): string {
  const current = getSection(body, name) ?? ''
  return setSection(body, name, current ? `${current}\n${text}` : text)
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

/** Tick the first unchecked item whose text starts with `prefix`. */
export function checkItem(body: string, section: string, prefix: string): string {
  const content = getSection(body, section)
  if (content === undefined) return body
  let ticked = false
  const out = content.split('\n').map((line) => {
    const m = /^(\s*- )\[ \]( .*)$/.exec(line)
    if (!ticked && m && m[2]!.trimStart().startsWith(prefix)) {
      ticked = true
      return `${m[1]}[x]${m[2]}`
    }
    return line
  })
  return ticked ? setSection(body, section, out.join('\n')) : body
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
