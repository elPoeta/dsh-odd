import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { applyAgentsMd } from './bootstrap'
import { DEFAULT_CONFIG_YAML, mergeConfig, parseConfig, type OddConfig } from './config'
import { DEFAULT_TEMPLATES } from './templates'
import { renderTask } from './templates'
import { NAME_RE, TASK_TYPES, parseTask, progress, serializeTask, type Task, type TaskType } from './task'

const exists = (p: string) => stat(p).then(() => true, () => false)

export interface Paths {
  root: string
  config: string
  templates: string
  tasks: string
  archive: string
  skills: string
}

export function paths(cwd: string, rootDir = '.odd'): Paths {
  const root = join(cwd, rootDir)
  return {
    root,
    config: join(root, 'config.yml'),
    templates: join(root, 'templates'),
    tasks: join(root, 'tasks'),
    archive: join(root, 'tasks', 'archive'),
    skills: join(root, 'skills'),
  }
}

export async function isInitialized(cwd: string, rootDir?: string): Promise<boolean> {
  return exists(paths(cwd, rootDir).config)
}

/** Idempotent. Never overwrites existing files. Returns what it created or changed. */
export async function initOdd(cwd: string, rootDir?: string): Promise<string[]> {
  const p = paths(cwd, rootDir)
  const created: string[] = []
  for (const dir of [p.root, p.templates, p.tasks, p.archive, p.skills]) {
    if (!(await exists(dir))) { await mkdir(dir, { recursive: true }); created.push(dir) }
  }
  const files: [string, string][] = [
    [p.config, DEFAULT_CONFIG_YAML],
    ...TASK_TYPES.map((t): [string, string] => [join(p.templates, `${t}.md`), DEFAULT_TEMPLATES[t]]),
  ]
  files.push([join(p.root, '.gitignore'), 'tasks/*.lock\ntasks/*.tmp\n'])
  for (const [file, content] of files) {
    if (!(await exists(file))) { await writeFile(file, content, 'utf8'); created.push(file) }
  }
  // Managed AGENTS.md block: DSH injects it into every session in this project.
  const cfg = parseConfig(await readFile(p.config, 'utf8'))
  if (cfg.bootstrap.agents_md) {
    const result = await applyAgentsMd(cwd, rootDir ?? '.odd')
    if (result !== 'unchanged') created.push(`${join(cwd, 'AGENTS.md')} (managed ODD block ${result})`)
  }
  return created
}

/**
 * `allowMissing` returns the defaults when the project has no .odd yet. Skill lookup and
 * status do not need initialization, so they work (and never create anything) before it.
 */
export async function loadConfig(cwd: string, rootDir?: string, allowMissing = false): Promise<OddConfig> {
  const p = paths(cwd, rootDir)
  if (!(await exists(p.config))) {
    if (allowMissing) return mergeConfig({})
    throw new Error('ODD is not initialized in this project. Call odd_init (or odd_task_create, which does it for you), or run /odd-init.')
  }
  return parseConfig(await readFile(p.config, 'utf8'))
}

// -------------------------------------------------------------------- lock

export async function withLock<T>(file: string, fn: () => Promise<T>, staleMs = 30_000): Promise<T> {
  const lock = file + '.lock'
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      await writeFile(lock, String(process.pid), { flag: 'wx' })
      try { return await fn() } finally { await rm(lock, { force: true }) }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
      const age = Date.now() - (await stat(lock).then((s) => s.mtimeMs, () => Date.now()))
      if (age > staleMs) await rm(lock, { force: true })
      else await new Promise((r) => setTimeout(r, 50))
    }
  }
  throw new Error(`Could not acquire lock for ${file}`)
}

// ------------------------------------------------------------------- tasks

const taskFile = (cwd: string, name: string, rootDir?: string) => {
  if (!NAME_RE.test(name)) throw new Error(`Invalid task name "${name}" (use lowercase letters, digits and hyphens)`)
  return join(paths(cwd, rootDir).tasks, `${name}.md`)
}

async function writeAtomic(file: string, content: string) {
  const tmp = `${file}.${process.pid}.tmp`
  await writeFile(tmp, content, 'utf8')
  await rename(tmp, file)
}

export interface CreateTaskInput { name: string; type: TaskType; title?: string; goal?: string; branch?: string }

export async function createTask(cwd: string, input: CreateTaskInput, rootDir?: string, now = new Date()): Promise<Task> {
  const cfg = await loadConfig(cwd, rootDir)
  const file = taskFile(cwd, input.name, rootDir)
  if (await exists(file)) throw new Error(`Task "${input.name}" already exists`)
  const p = paths(cwd, rootDir)
  const custom = join(p.templates, `${input.type}.md`)
  const template = (await exists(custom)) ? await readFile(custom, 'utf8') : undefined
  const prefix = { feature: 'feat', hotfix: 'fix', refactor: 'refactor' }[input.type]
  const task = renderTask(input.type, cfg, {
    id: input.name,
    title: input.title ?? input.name,
    goal: input.goal ?? '',
    branch: input.branch ?? `${prefix}/${input.name}`,
    created: now.toISOString(),
  }, template)
  await withLock(file, () => writeAtomic(file, serializeTask(task)))
  return task
}

export async function readTask(cwd: string, name: string, rootDir?: string): Promise<Task> {
  const file = taskFile(cwd, name, rootDir)
  if (!(await exists(file))) {
    if (!(await isInitialized(cwd, rootDir))) await loadConfig(cwd, rootDir) // throws the "not initialized" guidance
    throw new Error(`Task "${name}" not found. Call odd_task_list to see the tasks of this project.`)
  }
  return parseTask(await readFile(file, 'utf8'))
}

/** Read-modify-write under a lock. The orchestrator is the only writer. */
export async function mutateTask(cwd: string, name: string, fn: (t: Task, cfg: OddConfig) => Task, rootDir?: string): Promise<Task> {
  const cfg = await loadConfig(cwd, rootDir)
  const file = taskFile(cwd, name, rootDir)
  return withLock(file, async () => {
    if (!(await exists(file))) throw new Error(`Task "${name}" not found`)
    const next = fn(parseTask(await readFile(file, 'utf8')), cfg)
    await writeAtomic(file, serializeTask(next))
    return next
  })
}

export interface TaskSummary {
  id: string
  type: TaskType
  status: string
  phase: string
  done: number
  total: number
  nextStep: string
}

export async function listTasks(cwd: string, rootDir?: string): Promise<TaskSummary[]> {
  const dir = paths(cwd, rootDir).tasks
  if (!(await exists(dir))) return []
  const out: TaskSummary[] = []
  for (const f of (await readdir(dir)).filter((n) => n.endsWith('.md')).sort()) {
    const t = parseTask(await readFile(join(dir, f), 'utf8'))
    const { done, total } = progress(t)
    const next = /## Next step\n([\s\S]*?)(\n## |$)/.exec(t.body)?.[1]?.trim() ?? ''
    out.push({ id: t.frontmatter.id, type: t.frontmatter.type, status: t.frontmatter.status, phase: t.frontmatter.phase, done, total, nextStep: next })
  }
  return out
}

export async function archiveTask(cwd: string, name: string, rootDir?: string): Promise<string> {
  const t = await readTask(cwd, name, rootDir)
  if (t.frontmatter.status !== 'done') throw new Error('Only tasks with status "done" can be archived')
  const from = taskFile(cwd, name, rootDir)
  const to = join(paths(cwd, rootDir).archive, `${name}.md`)
  await rename(from, to)
  return to
}

export function formatStatus(tasks: TaskSummary[]): string {
  if (!tasks.length) return 'No active ODD tasks.'
  return tasks
    .map((t) => `- ${t.id} [${t.type}] ${t.status} / ${t.phase} (${t.done}/${t.total})\n    next: ${t.nextStep}`)
    .join('\n')
}
