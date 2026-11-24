/**
 * Thin adapter between the harness and the ODD core. All harness API shapes live in
 * ./api.ts and ./subagent-client.ts (see their headers for what was verified).
 *
 *   - Human slash commands: ctx.commands.register({ name, description, input?: { hint },
 *     handler(invocation) }) with invocation = { commandId, agent, rawInput, signal }
 *     returning { kind: 'success' | 'error', text }. They never reach the model.
 *   - Model tools: ctx.tools.register(ToolDefinition). A raw definition needs
 *     name, description, JSON-Schema parameters, `output: { schema, render }` and
 *     execute(args, exec) returning the canonical value (a string here).
 */
import { defaultExec } from '../core/exec'
import { dispatchPhase, formatReport, phaseMode } from '../core/dispatch'
import {
  SkillError, checkRegistry, formatCheck, formatSkillList, readSkillBody, resolveSkill, scanRegistry,
} from '../core/registry'
import {
  archiveTask, createTask, formatStatus, initOdd, listTasks, loadConfig, mutateTask, readTask,
} from '../core/store'
import { TASK_TYPES, appendLog, appendToSection, serializeTask, setNextStep, type TaskType } from '../core/task'
import { OUTCOMES, advance, resolveInput, type Outcome } from '../core/workflow'
import {
  checkArgs, effect, fail, objectSchema, ok, steerAgent, textBlock, type AnyCtx, type PropSpec,
} from './api'
import { createSubagentClient } from './subagent-client'

export interface AdapterOptions {
  cwd: string
  rootDir: string
  /** Plugin-bundled skills (lowest precedence). */
  builtinDirs?: string[]
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function registerAll(ctx: AnyCtx, opts: AdapterOptions): void {
  const { cwd, rootDir } = opts
  const builtinDirs = opts.builtinDirs ?? []
  const registry = async () => scanRegistry(cwd, await loadConfig(cwd, rootDir), { builtinDirs })

  // ---- human slash commands (never reach the model) -----------------------
  const command = (
    name: string, description: string, hint: string | undefined,
    run: (inv: { rawInput: string; agent: unknown; signal: AbortSignal }) => Promise<string>,
  ) =>
    effect(ctx, () => ctx.commands.register({
      name,
      description,
      ...(hint ? { input: { hint } } : {}),
      handler: async (inv: any) => {
        try { return ok(await run({ rawInput: String(inv?.rawInput ?? '').trim(), agent: inv?.agent, signal: inv?.signal })) }
        catch (e) { return fail(message(e)) }
      },
    }), `odd: /${name}`)

  command('odd-init', 'Create the .odd/ structure (config, templates, tasks) in this project', undefined, async () => {
    const created = await initOdd(cwd, rootDir)
    return created.length ? `Created:\n${created.map((c) => `- ${c}`).join('\n')}` : 'ODD already initialized.'
  })

  command('odd-status', 'List active ODD tasks with phase, progress and next step', undefined,
    async () => formatStatus(await listTasks(cwd, rootDir)))

  command('odd-skills', 'List the skill registry (ODD project > project > user > builtin); "check" validates it', '[check]', async ({ rawInput }) => {
    const reg = await registry()
    if (rawInput === 'check') return formatCheck(checkRegistry(reg, await loadConfig(cwd, rootDir)))
    const roots = reg.roots.map((r) => `- ${r.source}${r.exists ? '' : ' [missing]'}`).join('\n')
    return `${formatSkillList(reg)}\n\nRoots (highest precedence first):\n${roots}`
  })

  command('odd-resume', 'Resume an ODD task: the agent reads the task file and continues from its Next step', '<task-name>', async ({ rawInput, agent }) => {
    if (!rawInput) throw new Error('Usage: /odd-resume <task-name>')
    const t = await readTask(cwd, rawInput, rootDir)
    const fm = t.frontmatter
    const summary = `${fm.id} [${fm.type}] status=${fm.status} phase=${fm.phase}`
    if (fm.status === 'done') return `${summary}\nThis task is done; nothing to resume.`
    const request =
      `Resume ODD task "${fm.id}". First call odd_skill_load with name "odd-orchestrator" and follow that protocol, ` +
      `then call odd_task_read for "${fm.id}" and continue from its Next step.`
    try {
      // dsh-plan-mode does the same for /plan <message>: an explicit steer() into the receiving agent.
      await steerAgent(agent, request)
      return `${summary}\nSent the resume request to the agent.`
    } catch (e) {
      return `${summary}\nCould not submit it to the agent automatically (${message(e)}).\nTell the agent: "${request}"`
    }
  })

  // ---- model-facing tools: the orchestrator protocol -----------------------
  const tool = (
    name: string, description: string, props: Record<string, PropSpec>, required: string[],
    run: (a: Record<string, string>, exec: any) => Promise<string>,
  ) => {
    const parameters = objectSchema(props, required)
    effect(ctx, () => ctx.tools.register({
      name,
      description,
      parameters,
      // Canonical value is one string; render projects it for the model.
      output: { schema: { type: 'string' }, render: (_args: unknown, value: unknown) => [textBlock(String(value))] },
      // Not concurrency-safe on purpose: these tools write the md (isConcurrencySafe omitted = exclusive).
      execute: async (args: unknown, exec: any) => run(checkArgs(args, parameters), exec),
    }), `odd: ${name}`)
  }

  const str: PropSpec = { type: 'string' }

  tool('odd_task_create', 'Create an ODD task markdown file (feature | hotfix | refactor).',
    { name: str, type: { type: 'string', enum: TASK_TYPES }, title: str, goal: str }, ['name', 'type'],
    async (a) => serializeTask(await createTask(cwd, { name: a.name!, type: a.type as TaskType, title: a.title, goal: a.goal }, rootDir)))

  tool('odd_task_read', 'Read a task file. Always call this first when resuming work. The first line says whether the current phase runs inline or via odd_dispatch, and which skill applies.',
    { name: str }, ['name'],
    async (a) => {
      const t = await readTask(cwd, a.name!, rootDir)
      const cfg = await loadConfig(cwd, rootDir)
      const mode = phaseMode(cfg, t.frontmatter.phase)
      const hint = mode === 'subagent'
        ? 'call odd_dispatch to run it in a clean-context subagent'
        : `run it inline: call odd_skill_load with "${t.frontmatter.phase}" and follow it`
      let skillInfo = 'skill=MISSING (run /odd-skills check)'
      try { const e = resolveSkill(await registry(), t.frontmatter.phase); skillInfo = `skill=${e.key}@${e.source}` }
      catch (err) { if (!(err instanceof SkillError)) throw err }
      return `[odd] phase=${t.frontmatter.phase} mode=${mode} ${skillInfo} -> ${hint}\n\n${serializeTask(t)}`
    })

  tool('odd_dispatch', "Run the task's CURRENT phase in a clean-context subagent (only phases with mode=subagent). Records the result in the md and advances the workflow.",
    { name: str }, ['name'],
    async (a, exec) => {
      // ToolRunContext extends ToolExecution: exec.agent (calling Agent) and exec.signal (required).
      if (!exec?.agent) throw new Error('odd_dispatch needs a calling agent (exec.agent was undefined)')
      const client = createSubagentClient(ctx, exec.agent)
      const report = await dispatchPhase({ client, exec: defaultExec, builtinDirs }, cwd, a.name!, exec.signal ?? new AbortController().signal, rootDir)
      return formatReport(report)
    })

  tool('odd_task_advance', 'Record a phase result and move the workflow forward (applies circuit breakers).',
    { name: str, outcome: { type: 'string', enum: OUTCOMES }, summary: str, question: str }, ['name', 'outcome', 'summary'],
    async (a) => {
      const t = await mutateTask(cwd, a.name!, (task, cfg) =>
        advance(task, cfg, { outcome: a.outcome as Outcome, summary: a.summary!, question: a.question || undefined }), rootDir)
      return `status=${t.frontmatter.status} phase=${t.frontmatter.phase} review_loops=${t.frontmatter.review_loops}`
    })

  tool('odd_task_answer', "Record the human's answer to a needs_input question and resume the phase.",
    { name: str, answer: str }, ['name', 'answer'],
    async (a) => {
      const t = await mutateTask(cwd, a.name!, (task) => resolveInput(task, a.answer!), rootDir)
      return `status=${t.frontmatter.status} phase=${t.frontmatter.phase}`
    })

  tool('odd_task_note', 'Append a line to a task section (Decisions, Handoffs, Evidence, Log, Open questions) or set Next step.',
    { name: str, section: str, text: str }, ['name', 'section', 'text'],
    async (a) => {
      await mutateTask(cwd, a.name!, (task) => {
        if (/^next step$/i.test(a.section!)) return setNextStep(task, a.text!)
        if (/^log$/i.test(a.section!)) return appendLog(task, 'orchestrator', a.text!)
        return { ...task, body: appendToSection(task.body, a.section!, a.text!) }
      }, rootDir)
      return 'ok'
    })

  tool('odd_skill_list', 'List available skills (name, source, description) in ODD precedence order. Includes ODD-only project skills the native skill tool cannot see.',
    {}, [],
    async () => formatSkillList(await registry()))

  tool('odd_skill_load', "Load the full instructions of a skill by name, resolved with ODD precedence (project overrides global). Use this for the current phase's skill.",
    { name: str }, ['name'],
    async (a) => {
      const entry = resolveSkill(await registry(), a.name!)
      return `# Skill: ${entry.name} (${entry.source})\n\n${await readSkillBody(entry)}`
    })

  tool('odd_task_archive', 'Move a finished task to .odd/tasks/archive/.',
    { name: str }, ['name'],
    async (a) => `archived: ${await archiveTask(cwd, a.name!, rootDir)}`)
}
