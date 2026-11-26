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
 *
 * The project is resolved PER CALL from the calling agent's session cwd
 * (agent.session.header.cwd), so state always lands in the project the session works in.
 */
import { defaultExec } from '../core/exec'
import { dispatchPhase, formatReport, phaseMode } from '../core/dispatch'
import {
  assertCapturable, formatCapture, formatMemoryStatus, formatRecall, missingMemoryTools,
  planCapture, planRecall, recordCapture, type CapturePlan,
} from '../core/memory'
import { skillFor } from '../core/config'
import { resolveProject } from '../core/project'
import {
  SkillError, checkRegistry, formatCheck, formatSkillList, readSkillBody, resolveSkill, scanRegistry,
} from '../core/registry'
import {
  archiveTask, createTask, formatBlockers, formatStatus, initOdd, isInitialized, listTasks, loadConfig, mutateTask, readTask,
  unblockTask, unresolvedBlockers,
} from '../core/store'
import {
  KNOWN_SECTIONS, TASK_TYPES, appendLog, appendToSection, checkItem, sectionNames, sectionProgress, serializeTask, setNextStep, setSection,
  uncheckedItems, type TaskType,
} from '../core/task'
import { OUTCOMES, advance, resolveInput, type Outcome } from '../core/workflow'
import {
  checkArgs, effect, fail, objectSchema, ok, sessionCwd, sessionPreset, steerAgent, textBlock, type AnyCtx, type PropSpec,
} from './api'
import { createSubagentClient, registeredToolNames } from './subagent-client'

export interface AdapterOptions {
  /** Explicit project directory (plugin config `cwd`). When omitted it is resolved per call from the session. */
  cwd?: string
  rootDir: string
  /** Plugin-bundled skills (lowest precedence). */
  builtinDirs?: string[]
  /** Test hook: the home directory ODD refuses to use as a project. */
  home?: string
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function registerAll(ctx: AnyCtx, opts: AdapterOptions): void {
  const { rootDir } = opts
  const builtinDirs = opts.builtinDirs ?? []
  const projectOf = (agent: unknown) => resolveProject(sessionCwd(agent), { override: opts.cwd, home: opts.home })
  const registry = async (cwd: string) =>
    scanRegistry(cwd, await loadConfig(cwd, rootDir, true), { builtinDirs, home: opts.home })

  const initReport = async (cwd: string, agent?: unknown) => {
    const cfg = await loadConfig(cwd, rootDir, true)
    const preset = sessionPreset(agent)
    const skip = cfg.bootstrap.agents_md && preset !== undefined && cfg.bootstrap.skip_presets.includes(preset)
    const created = await initOdd(cwd, rootDir, { skipAgentsMd: skip })
    const note = skip ? `\n(AGENTS.md block not added: this session runs the "${preset}" preset, which already carries the ODD protocol.)` : ''
    return (created.length
      ? `Initialized ODD in ${cwd}:\n${created.map((c) => `- ${c}`).join('\n')}`
      : `ODD already initialized in ${cwd}.`) + note
  }

  // ---- human slash commands (never reach the model) -----------------------
  const command = (
    name: string, description: string, hint: string | undefined,
    run: (inv: { rawInput: string; agent: unknown; signal: AbortSignal }, cwd: string) => Promise<string>,
  ) =>
    effect(ctx, () => ctx.commands.register({
      name,
      description,
      ...(hint ? { input: { hint } } : {}),
      handler: async (inv: any) => {
        try {
          const cwd = await projectOf(inv?.agent)
          return ok(await run({ rawInput: String(inv?.rawInput ?? '').trim(), agent: inv?.agent, signal: inv?.signal }, cwd))
        } catch (e) { return fail(message(e)) }
      },
    }), `odd: /${name}`)

  command('odd-init', 'Create the .odd/ structure in this project (the agent also does this on its own)', undefined, ({ agent }, cwd) => initReport(cwd, agent))

  command('odd-status', 'List active ODD tasks with phase, progress and next step', undefined,
    async (_i, cwd) => formatStatus(await listTasks(cwd, rootDir)))

  command('odd-skills', 'List the skill registry (ODD project > project > user > builtin); "check" validates it', '[check]', async ({ rawInput }, cwd) => {
    const reg = await registry(cwd)
    if (rawInput === 'check') return formatCheck(checkRegistry(reg, await loadConfig(cwd, rootDir, true)))
    const roots = reg.roots.map((r) => `- ${r.source}${r.exists ? '' : ' [missing]'}`).join('\n')
    return `${formatSkillList(reg)}\n\nRoots (highest precedence first):\n${roots}`
  })

  command('odd-memory', 'Show the Engram integration status and how to mount the MCP server', undefined, async (_i, cwd) =>
    formatMemoryStatus((await loadConfig(cwd, rootDir, true)).memory, registeredToolNames(ctx)))

  command('odd-resume', 'Resume an ODD task: the agent reads the task file and continues from its Next step', '<task-name>', async ({ rawInput, agent }, cwd) => {
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
    run: (a: Record<string, string>, exec: any, cwd: string) => Promise<string>,
  ) => {
    const parameters = objectSchema(props, required)
    effect(ctx, () => ctx.tools.register({
      name,
      description,
      parameters,
      // Canonical value is one string; render projects it for the model.
      output: { schema: { type: 'string' }, render: (_args: unknown, value: unknown) => [textBlock(String(value))] },
      // Not concurrency-safe on purpose: these tools write the md (isConcurrencySafe omitted = exclusive).
      execute: async (args: unknown, exec: any) => run(checkArgs(args, parameters), exec, await projectOf(exec?.agent)),
    }), `odd: ${name}`)
  }

  const str: PropSpec = { type: 'string' }

  /** A task with unfinished blockers must not be worked or advanced. */
  const assertNotBlocked = async (cwd: string, name: string) => {
    const blockers = await unresolvedBlockers(cwd, await readTask(cwd, name, rootDir), rootDir)
    if (blockers.length) {
      throw new Error(`Task "${name}" is blocked by ${formatBlockers(blockers)}. Work a task that is ready (odd_task_list), or remove the dependency with odd_task_unblock if it is no longer needed.`)
    }
  }

  tool('odd_init', 'Set up ODD in the current project (.odd/ config, templates, tasks). Idempotent and never overwrites. odd_task_create already does this when needed.',
    {}, [], async (_a, exec, cwd) => initReport(cwd, exec?.agent))

  tool('odd_task_list', 'List the ODD tasks of this project with status, phase, progress and next step. Call it first to decide whether to resume a task or create one.',
    {}, [],
    async (_a, _e, cwd) => {
      const list = formatStatus(await listTasks(cwd, rootDir))
      return (await isInitialized(cwd, rootDir)) ? list : `${list}\n(ODD is not initialized in ${cwd}; odd_task_create sets it up.)`
    })

  tool('odd_task_create', 'Create an ODD task markdown file (feature | hotfix | refactor). Sets up .odd/ first if the project has none. Optional phase starts the task later in its workflow (earlier phases are marked skipped), e.g. phase "story" for one already-defined story. Optional parent (the plan task that produced it) and blocked_by (comma-separated ids of tasks that must be done first; they must already exist, so create blockers first).',
    { name: str, type: { type: 'string', enum: TASK_TYPES }, title: str, goal: str, phase: str, parent: str, blocked_by: str }, ['name', 'type'],
    async (a, exec, cwd) => {
      const setup = (await isInitialized(cwd, rootDir)) ? '' : `[odd] ODD was not set up in ${cwd}; ${await initReport(cwd, exec?.agent)}\n\n`
      const task = await createTask(cwd, {
        name: a.name!, type: a.type as TaskType, title: a.title, goal: a.goal, phase: a.phase,
        parent: a.parent || undefined, blockedBy: a.blocked_by ? a.blocked_by.split(',') : undefined,
      }, rootDir)
      const hint = (await loadConfig(cwd, rootDir)).memory.enabled
        ? '\n\n[odd] Engram is enabled: call odd_memory_recall for related past work before planning.' : ''
      return setup + serializeTask(task) + hint
    })

  tool('odd_task_read', 'Read a task file. Always call this first when resuming work. The first line says whether the current phase runs inline or via odd_dispatch, and which skill applies.',
    { name: str }, ['name'],
    async (a, _e, cwd) => {
      const t = await readTask(cwd, a.name!, rootDir)
      const cfg = await loadConfig(cwd, rootDir)
      const mode = phaseMode(cfg, t.frontmatter.phase)
      const skillName = skillFor(cfg, t.frontmatter.phase)
      const hint = mode === 'subagent'
        ? 'call odd_dispatch to run it in a clean-context subagent'
        : `run it inline: call odd_skill_load with "${skillName}" and follow it`
      let skillInfo = `skill=MISSING "${skillName}" (tell the human; do not change the task state; see /odd-skills check)`
      try { const e = resolveSkill(await registry(cwd), skillName); skillInfo = `skill=${e.key}@${e.source}` }
      catch (err) { if (!(err instanceof SkillError)) throw err }
      const blockers = await unresolvedBlockers(cwd, t, rootDir)
      const blocked = blockers.length
        ? `\n[odd] BLOCKED by ${formatBlockers(blockers)}. Do not work on this task; pick a ready one (odd_task_list), or odd_task_unblock if the dependency is no longer needed.` : ''
      return `[odd] phase=${t.frontmatter.phase} mode=${mode} ${skillInfo} -> ${hint}${blocked}\n\n${serializeTask(t)}`
    })

  tool('odd_dispatch', "Run the task's CURRENT phase in a clean-context subagent (only phases with mode=subagent). Records the result in the md and advances the workflow.",
    { name: str }, ['name'],
    async (a, exec, cwd) => {
      // ToolRunContext extends ToolExecution: exec.agent (calling Agent) and exec.signal (required).
      if (!exec?.agent) throw new Error('odd_dispatch needs a calling agent (exec.agent was undefined)')
      await assertNotBlocked(cwd, a.name!)
      const client = createSubagentClient(ctx, exec.agent)
      const report = await dispatchPhase({ client, exec: defaultExec, builtinDirs }, cwd, a.name!, exec.signal ?? new AbortController().signal, rootDir)
      return formatReport(report)
    })

  tool('odd_task_advance', 'Record a phase result and move the workflow forward (applies circuit breakers).',
    { name: str, outcome: { type: 'string', enum: OUTCOMES }, summary: str, question: str }, ['name', 'outcome', 'summary'],
    async (a, _e, cwd) => {
      await assertNotBlocked(cwd, a.name!)
      const t = await mutateTask(cwd, a.name!, (task, cfg) =>
        advance(task, cfg, { outcome: a.outcome as Outcome, summary: a.summary!, question: a.question || undefined }), rootDir)
      const closed = t.frontmatter.status === 'done' || t.frontmatter.status === 'blocked'
      const hint = closed && (await loadConfig(cwd, rootDir)).memory.enabled
        ? `\n[odd] Task closed: record Decisions, Lessons${t.frontmatter.type === 'hotfix' ? ' and Root cause' : ''} in the task file, then call odd_memory_capture.` : ''
      return `status=${t.frontmatter.status} phase=${t.frontmatter.phase} review_loops=${t.frontmatter.review_loops}${hint}`
    })

  tool('odd_task_unblock', 'Remove a dependency edge from a task (the blocker was dropped, merged or is no longer needed). Logged in the task. Only do this when the human agrees.',
    { name: str, blocker: str }, ['name', 'blocker'],
    async (a, _e, cwd) => {
      const t = await unblockTask(cwd, a.name!, a.blocker!, rootDir)
      return `blocked_by: ${(t.frontmatter.blocked_by ?? []).join(', ') || 'nothing'}`
    })

  tool('odd_task_answer', "Record the human's answer to a needs_input question and resume the phase.",
    { name: str, answer: str }, ['name', 'answer'],
    async (a, _e, cwd) => {
      const t = await mutateTask(cwd, a.name!, (task) => resolveInput(task, a.answer!), rootDir)
      return `status=${t.frontmatter.status} phase=${t.frontmatter.phase}`
    })

  tool('odd_task_note', `Write to a task section. mode "append" (default) adds to the end; mode "replace" overwrites it (use it for Backlog, Story, Acceptance criteria, Implementation plan, Out of scope, Suggestions, Test list). Known sections: ${KNOWN_SECTIONS.join(', ')}. Headings inside the text are demoted so they cannot split the file.`,
    { name: str, section: str, text: str, mode: { type: 'string', enum: ['append', 'replace'] } }, ['name', 'section', 'text'],
    async (a, _e, cwd) => {
      await mutateTask(cwd, a.name!, (task) => {
        const wanted = a.section!.trim()
        const canonical = [...KNOWN_SECTIONS, ...sectionNames(task.body)].find((n) => n.toLowerCase() === wanted.toLowerCase())
        if (!canonical) throw new Error(`Unknown section "${wanted}". Use one of: ${KNOWN_SECTIONS.join(', ')}`)
        if (canonical === 'Next step') return setNextStep(task, a.text!)
        if (canonical === 'Log') return appendLog(task, 'orchestrator', a.text!)
        if (a.mode === 'replace') return { ...task, body: setSection(task.body, canonical, a.text!) }
        return { ...task, body: appendToSection(task.body, canonical, a.text!) }
      }, rootDir)
      return 'ok'
    })

  tool('odd_task_check', 'Tick an item of a checklist section (default "Test list"; also "Acceptance criteria"). item is the start of the item text, or a distinctive part of it. Returns the section progress.',
    { name: str, item: str, section: str }, ['name', 'item'],
    async (a, _e, cwd) => {
      const section = a.section?.trim() || 'Test list'
      let progress = ''
      await mutateTask(cwd, a.name!, (task) => {
        const body = checkItem(task.body, section, a.item!, true)
        if (body === task.body) {
          const open = uncheckedItems(task.body, section)
          throw new Error(`No unchecked item in "${section}" matches "${a.item}". ` + (open.length ? `Unchecked items:\n${open.map((t) => `- ${t}`).join('\n')}` : 'Nothing is left to check.'))
        }
        const p = sectionProgress(body, section)
        progress = `${section}: ${p.done}/${p.total} done`
        return { ...task, body }
      }, rootDir)
      return progress
    })

  tool('odd_skill_list', 'List available skills (name, source, description) in ODD precedence order. Includes ODD-only project skills the native skill tool cannot see.',
    {}, [],
    async (_a, _e, cwd) => formatSkillList(await registry(cwd)))

  tool('odd_skill_load', "Load the full instructions of a skill by name, resolved with ODD precedence (project overrides global). Works before ODD is initialized.",
    { name: str }, ['name'],
    async (a, _e, cwd) => {
      const entry = resolveSkill(await registry(cwd), a.name!)
      return `# Skill: ${entry.name} (${entry.source})\n\n${await readSkillBody(entry)}`
    })

  const requireMemory = async (cwd: string) => {
    const cfg = await loadConfig(cwd, rootDir)
    if (!cfg.memory.enabled) {
      throw new Error('Engram integration is disabled. Set memory.enabled: true in .odd/config.yml and mount the Engram MCP server (see /odd-memory).')
    }
    return cfg.memory
  }

  tool('odd_memory_recall', 'Plan Engram lookups for related past work (decisions, bug causes) before starting a task. Returns the exact mem_* calls to run. Memory is a hint: the task file always wins.',
    { name: str }, ['name'],
    async (a, _e, cwd) => {
      const mem = await requireMemory(cwd)
      const missing = missingMemoryTools(mem.server_name, registeredToolNames(ctx))
      if (missing && missing.length) return formatMemoryStatus(mem, registeredToolNames(ctx))
      const task = await readTask(cwd, a.name!, rootDir)
      return formatRecall(task, planRecall(task, mem), mem.server_name)
    })

  tool('odd_memory_capture', 'When a task is closed (done or blocked), prepare the Engram saves: decisions, root cause, lessons and a digest, with idempotent topic keys. Returns the exact mem_save calls to run. Never includes logs, evidence or transcripts.',
    { name: str }, ['name'],
    async (a, _e, cwd) => {
      const mem = await requireMemory(cwd)
      const missing = missingMemoryTools(mem.server_name, registeredToolNames(ctx))
      if (missing && missing.length) return formatMemoryStatus(mem, registeredToolNames(ctx))
      let plan!: CapturePlan
      const task = await mutateTask(cwd, a.name!, (t) => {
        assertCapturable(t)
        plan = planCapture(t, mem)
        return recordCapture(t, plan)
      }, rootDir)
      return formatCapture(task, plan, mem.server_name)
    })

  tool('odd_task_archive', 'Move a finished task to .odd/tasks/archive/.',
    { name: str }, ['name'],
    async (a, _e, cwd) => `archived: ${await archiveTask(cwd, a.name!, rootDir)}`)
}
