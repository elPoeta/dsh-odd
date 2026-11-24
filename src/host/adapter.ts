/**
 * Thin adapter between the harness and the ODD core.
 *
 * ALL harness API assumptions live in this file. Verified from docs:
 *   - ctx.commands.register(definition): lowercase name, description, optional
 *     input hint, optional recordInput, abortable handler. Command names cannot
 *     contain ":".
 *   - ctx.tools.register(definition) registers a model-callable tool.
 *
 * NOT verified (marked TODO(verify)): exact field names of both definitions,
 * handler signature, and the disposer return value. Before shipping, read the
 * installed .d.ts of @deepseek-ai/dsh-commands and @deepseek-ai/dsh-tools
 * (see: node -p "require.resolve('@deepseek-ai/dsh/package.json')").
 */
import {
  archiveTask, createTask, formatStatus, initOdd, listTasks, mutateTask, readTask,
} from '../core/store'
import { TASK_TYPES, appendLog, appendToSection, setNextStep, serializeTask, type TaskType } from '../core/task'
import { OUTCOMES, advance, resolveInput, type Outcome } from '../core/workflow'

// Deliberately loose: the real Context type is not imported so the core never
// depends on harness internals.
type AnyCtx = any // TODO(verify): replace with Context from '@deepseek-ai/cordis'

export interface AdapterOptions { cwd: string; rootDir: string }

const text = (s: string) => ({ text: s }) // TODO(verify): CommandResult / tool result shape

export function registerAll(ctx: AnyCtx, opts: AdapterOptions): void {
  const { cwd, rootDir } = opts

  // ---- human slash commands (do not start model work) -------------------
  ctx.commands.register({
    name: 'odd-init',
    description: 'Create the .odd/ structure (config, templates, tasks) in this project',
    handler: async () => {
      const created = await initOdd(cwd, rootDir)
      return text(created.length ? `Created:\n${created.map((c) => `- ${c}`).join('\n')}` : 'ODD already initialized.')
    },
  })

  ctx.commands.register({
    name: 'odd-status',
    description: 'List active ODD tasks with phase, progress and next step',
    handler: async () => text(formatStatus(await listTasks(cwd, rootDir))),
  })

  ctx.commands.register({
    name: 'odd-resume',
    description: 'Show where a task stands: /odd-resume <task-name>',
    inputHint: '<task-name>', // TODO(verify): field name for the input hint
    handler: async (args: string) => {
      const name = String(args ?? '').trim()
      if (!name) return text('Usage: /odd-resume <task-name>')
      const t = await readTask(cwd, name, rootDir)
      const fm = t.frontmatter
      // Phase 1: resuming means telling the main agent to read the task and
      // follow the odd-orchestrator skill. A command cannot submit a model
      // message by itself, so we print the instruction for the human to send.
      return text(
        `${fm.id} [${fm.type}] status=${fm.status} phase=${fm.phase}\n\n` +
        `Tell the agent: "Resume ODD task ${fm.id}" (it will call odd_task_read).`,
      )
    },
  })

  // ---- model-facing tools: the orchestrator protocol --------------------
  const tool = (name: string, description: string, properties: Record<string, unknown>, required: string[], run: (a: any) => Promise<string>) =>
    ctx.tools.register({
      name,
      description,
      // TODO(verify): the real registry may expect a schemastery schema
      // instead of plain JSON Schema.
      parameters: { type: 'object', properties, required },
      execute: async (args: any) => text(await run(args)),
    })

  const str = { type: 'string' }

  tool('odd_task_create', 'Create an ODD task markdown file (feature | hotfix | refactor).',
    { name: str, type: { type: 'string', enum: TASK_TYPES }, title: str, goal: str }, ['name', 'type'],
    async (a) => {
      const t = await createTask(cwd, { name: a.name, type: a.type as TaskType, title: a.title, goal: a.goal }, rootDir)
      return serializeTask(t)
    })

  tool('odd_task_read', 'Read a task file. Always call this first when resuming work.',
    { name: str }, ['name'],
    async (a) => serializeTask(await readTask(cwd, a.name, rootDir)))

  tool('odd_task_advance', 'Record a phase result and move the workflow forward (applies circuit breakers).',
    { name: str, outcome: { type: 'string', enum: OUTCOMES }, summary: str, question: str }, ['name', 'outcome', 'summary'],
    async (a) => {
      const t = await mutateTask(cwd, a.name, (task, cfg) =>
        advance(task, cfg, { outcome: a.outcome as Outcome, summary: a.summary, question: a.question }), rootDir)
      return `status=${t.frontmatter.status} phase=${t.frontmatter.phase} review_loops=${t.frontmatter.review_loops}`
    })

  tool('odd_task_answer', 'Record the human\'s answer to a needs_input question and resume the phase.',
    { name: str, answer: str }, ['name', 'answer'],
    async (a) => {
      const t = await mutateTask(cwd, a.name, (task) => resolveInput(task, a.answer), rootDir)
      return `status=${t.frontmatter.status} phase=${t.frontmatter.phase}`
    })

  tool('odd_task_note', 'Append a line to a task section (Decisions, Handoffs, Evidence, Log, Open questions) or set Next step.',
    { name: str, section: str, text: str }, ['name', 'section', 'text'],
    async (a) => {
      await mutateTask(cwd, a.name, (task) => {
        if (/^next step$/i.test(a.section)) return setNextStep(task, a.text)
        if (/^log$/i.test(a.section)) return appendLog(task, 'orchestrator', a.text)
        return { ...task, body: appendToSection(task.body, a.section, a.text) }
      }, rootDir)
      return 'ok'
    })

  tool('odd_task_archive', 'Move a finished task to .odd/tasks/archive/.',
    { name: str }, ['name'],
    async (a) => `archived: ${await archiveTask(cwd, a.name, rootDir)}`)
}
