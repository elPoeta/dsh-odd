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
import { defaultExec } from '../core/exec'
import { dispatchPhase, formatReport, phaseMode } from '../core/dispatch'
import {
  archiveTask, createTask, formatStatus, initOdd, listTasks, loadConfig, mutateTask, readTask,
} from '../core/store'
import {
  checkRegistry, formatCheck, formatSkillList, readSkillBody, resolveSkill, scanRegistry, SkillError,
} from '../core/registry'
import { createSubagentClient } from './subagent-client'
import { TASK_TYPES, appendLog, appendToSection, setNextStep, serializeTask, type TaskType } from '../core/task'
import { OUTCOMES, advance, resolveInput, type Outcome } from '../core/workflow'

// Deliberately loose: the real Context type is not imported so the core never
// depends on harness internals.
type AnyCtx = any // TODO(verify): replace with Context from '@deepseek-ai/cordis'

export interface AdapterOptions {
  cwd: string
  rootDir: string
  /** Plugin-bundled skills (lowest precedence). */
  builtinDirs?: string[]
}

const text = (s: string) => ({ text: s }) // TODO(verify): CommandResult / tool result shape

export function registerAll(ctx: AnyCtx, opts: AdapterOptions): void {
  const { cwd, rootDir } = opts
  const builtinDirs = opts.builtinDirs ?? []
  const registry = async () => scanRegistry(cwd, await loadConfig(cwd, rootDir), { builtinDirs })

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
    name: 'odd-skills',
    description: 'List the skill registry (precedence: ODD project > project > user > builtin). Use "/odd-skills check" to validate.',
    inputHint: '[check]', // TODO(verify): field name for the input hint
    handler: async (args: string) => {
      const reg = await registry()
      if (String(args ?? '').trim() === 'check') return text(formatCheck(checkRegistry(reg, await loadConfig(cwd, rootDir))))
      const roots = reg.roots.map((r) => `- ${r.source}${r.exists ? '' : ' [missing]'}`).join('\n')
      return text(`${formatSkillList(reg)}\n\nRoots (highest precedence first):\n${roots}`)
    },
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
  const tool = (name: string, description: string, properties: Record<string, unknown>, required: string[], run: (a: any, exec?: any) => Promise<string>) =>
    ctx.tools.register({
      name,
      description,
      // TODO(verify): the real registry may expect a schemastery schema
      // instead of plain JSON Schema.
      parameters: { type: 'object', properties, required },
      execute: async (args: any, exec?: any) => text(await run(args, exec)),
    })

  const str = { type: 'string' }

  tool('odd_task_create', 'Create an ODD task markdown file (feature | hotfix | refactor).',
    { name: str, type: { type: 'string', enum: TASK_TYPES }, title: str, goal: str }, ['name', 'type'],
    async (a) => {
      const t = await createTask(cwd, { name: a.name, type: a.type as TaskType, title: a.title, goal: a.goal }, rootDir)
      return serializeTask(t)
    })

  tool('odd_task_read', 'Read a task file. Always call this first when resuming work. The first line says whether the current phase runs inline or via odd_dispatch.',
    { name: str }, ['name'],
    async (a) => {
      const t = await readTask(cwd, a.name, rootDir)
      const cfg = await loadConfig(cwd, rootDir)
      const mode = phaseMode(cfg, t.frontmatter.phase)
      const hint = mode === 'subagent' ? 'call odd_dispatch to run it in a clean-context subagent' : `run it inline: call odd_skill_load with "${t.frontmatter.phase}" and follow it`
      let skillInfo = 'skill=MISSING (run /odd-skills check)'
      try { const e = resolveSkill(await registry(), t.frontmatter.phase); skillInfo = `skill=${e.key}@${e.source}` }
      catch (err) { if (!(err instanceof SkillError)) throw err }
      return `[odd] phase=${t.frontmatter.phase} mode=${mode} ${skillInfo} -> ${hint}\n\n${serializeTask(t)}`
    })

  tool('odd_dispatch', 'Run the task\'s CURRENT phase in a clean-context subagent (only phases with mode=subagent). Records the result in the md and advances the workflow.',
    { name: str }, ['name'],
    async (a, exec) => {
      // TODO(verify): how the tool handler exposes the calling Agent and the abort signal
      // (docs: the signal is the tool's `exec.signal`).
      const parent = exec?.agent
      if (!parent) throw new Error('odd_dispatch: could not resolve the calling agent from the tool context')
      const signal: AbortSignal = exec?.signal ?? new AbortController().signal
      const client = createSubagentClient(ctx, parent)
      const report = await dispatchPhase({ client, exec: defaultExec, builtinDirs }, cwd, a.name, signal, rootDir)
      return formatReport(report)
    })

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

  tool('odd_skill_list', 'List available skills (name, source, description) in ODD precedence order. Includes ODD-only project skills the native skill tool cannot see.',
    {}, [],
    async () => formatSkillList(await registry()))

  tool('odd_skill_load', 'Load the full instructions of a skill by name, resolved with ODD precedence (project overrides global). Use this for the current phase\'s skill.',
    { name: str }, ['name'],
    async (a) => {
      const entry = resolveSkill(await registry(), a.name)
      return `# Skill: ${entry.name} (${entry.source})\n\n${await readSkillBody(entry)}`
    })

  tool('odd_task_archive', 'Move a finished task to .odd/tasks/archive/.',
    { name: str }, ['name'],
    async (a) => `archived: ${await archiveTask(cwd, a.name, rootDir)}`)
}
