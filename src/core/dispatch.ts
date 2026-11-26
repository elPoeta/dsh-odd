import { effectiveDeny, skillFor, type OddConfig, type RoleConfig } from './config'
import { REPORT_SCHEMA, parseReport, toAdvanceInput, type SubagentReport } from './contract'
import type { ExecFn } from './exec'
import { buildPacket } from './packet'
import { loadResolvedSkill } from './registry'
import { loadConfig, mutateTask, readTask } from './store'
import { appendToSection, type Task } from './task'
import { advance, type AdvanceInput } from './workflow'

export interface RunRequest {
  label: string
  prompt: string
  outputSchema: typeof REPORT_SCHEMA
  role: RoleConfig
  /** Tool names to hide from the child (not yet intersected with registered tools). */
  toolDeny: string[]
  signal: AbortSignal
}
export interface RunResult { stopReason: string; structured?: unknown; outputText: string }

/** Transport-neutral subagent client. The host adapter implements it over ctx.subagents. */
export interface SubagentClient { run(req: RunRequest): Promise<RunResult> }

export interface DispatchDeps {
  client: SubagentClient
  exec: ExecFn
  now?: () => Date
  /** Directories with the plugin's own skills (lowest precedence). */
  builtinDirs?: string[]
}

export interface DispatchReport {
  phase: string
  outcome: AdvanceInput['outcome']
  status: string
  nextPhase: string
  summary: string
  question?: string
  findings: number
}

export function phaseMode(cfg: OddConfig, phase: string): 'subagent' | 'inline' {
  return cfg.dispatch[phase] ? 'subagent' : 'inline'
}

const clip = (s: string, n = 2000) => (s.length > n ? s.slice(0, n) + '…' : s)

/**
 * Orchestrator step: build a minimal handoff packet, run the phase in a clean
 * subagent, validate its report, verify independently, then record everything
 * in the md and advance. The subagent never writes the md.
 */
export async function dispatchPhase(
  deps: DispatchDeps, cwd: string, name: string, signal: AbortSignal, rootDir?: string,
): Promise<DispatchReport> {
  const now = () => deps.now?.() ?? new Date()
  const cfg = await loadConfig(cwd, rootDir)
  const task = await readTask(cwd, name, rootDir)
  const { phase, status } = task.frontmatter
  if (status !== 'todo' && status !== 'in_progress') {
    throw new Error(`Task "${name}" is ${status}; dispatch only works on todo/in_progress tasks`)
  }
  const role = cfg.dispatch[phase]
  if (!role) throw new Error(`Phase "${phase}" is not dispatchable (no dispatch.${phase} in config). Run it inline.`)
  const skill = await loadResolvedSkill(cwd, cfg, skillFor(cfg, phase), { builtinDirs: deps.builtinDirs })

  let diff: string | undefined
  let diffError: string | undefined
  if (role.include_diff) {
    const d = await deps.exec(cfg.diff_command, cwd)
    if (d.code === 0) diff = d.output
    else { diff = ''; diffError = `\`${cfg.diff_command}\` exited ${d.code}` }
  }
  const prompt = buildPacket({ task, phase, skillName: skill.name, skillText: skill.text, role, diff, diffError })

  // ---- run the child; every failure mode becomes a recorded outcome
  let report: SubagentReport | undefined
  let failure: string | undefined
  try {
    const res = await deps.client.run({
      label: `${name}:${phase}`, prompt, outputSchema: REPORT_SCHEMA, role, toolDeny: effectiveDeny(role, cfg.memory.server_name), signal,
    })
    if (res.stopReason !== 'completed') failure = `subagent ended with stopReason "${res.stopReason}"`
    else {
      try { report = parseReport(res.structured) } catch (e) { failure = `invalid report: ${(e as Error).message}` }
    }
  } catch (e) {
    failure = `subagent could not run: ${(e as Error).message}`
  }

  // ---- independent verification (never trust "tests pass")
  const evidence: string[] = []
  let verification: string | undefined
  if (report && report.status === 'done' && role.verify_command) {
    const v = await deps.exec(role.verify_command, cwd)
    evidence.push(`- orchestrator verified \`${role.verify_command}\` => exit ${v.code}`)
    if (v.code !== 0) verification = `orchestrator verification failed (exit ${v.code}): ${clip(v.output, 500)}`
  }
  if (report?.tests_command) {
    evidence.push(`- ${phase} reported \`${report.tests_command}\` => ${report.tests_result ?? 'no result'} (subagent-reported, unverified)`)
  }

  let input: AdvanceInput
  if (failure) input = { outcome: 'failed', summary: failure, actor: `subagent:${phase}` }
  else if (verification) input = { outcome: 'failed', summary: verification, actor: `subagent:${phase}` }
  else {
    const n = report!.findings.length
    const summary = n ? `${report!.summary} (${n} findings, see Evidence)` : report!.summary
    input = toAdvanceInput(phase, report!, summary)
  }
  if (report) for (const f of report.findings) evidence.push(`- ${phase} finding (loop ${task.frontmatter.review_loops + 1}): ${f}`)

  const handoff =
    `- ${now().toISOString()} ${phase} -> ${role.provider} (skill: ${skill.name}@${skill.source}, packet: ${prompt.length} chars` +
    `${diff !== undefined ? `, diff: ${diff.length} chars` : ''}) => ${input.outcome}: ${clip(input.summary, 300)}`

  const after = await mutateTask(cwd, name, (t: Task, c) => {
    if (t.frontmatter.phase !== phase || (t.frontmatter.status !== 'todo' && t.frontmatter.status !== 'in_progress')) {
      throw new Error('Task changed while the subagent was running; re-read it before dispatching again')
    }
    let next = { ...t, body: appendToSection(t.body, 'Handoffs', handoff) }
    for (const d of report?.decisions ?? []) next = { ...next, body: appendToSection(next.body, 'Decisions', `- ${d} (from ${phase})`) }
    for (const e of evidence) next = { ...next, body: appendToSection(next.body, 'Evidence', e) }
    return advance(next, c, input, now())
  }, rootDir)

  return {
    phase,
    outcome: input.outcome,
    status: after.frontmatter.status,
    nextPhase: after.frontmatter.phase,
    summary: input.summary,
    question: input.question,
    findings: report?.findings.length ?? 0,
  }
}

export function formatReport(r: DispatchReport): string {
  const head = `phase=${r.phase} outcome=${r.outcome} -> status=${r.status} phase=${r.nextPhase}`
  if (r.status === 'needs_input') return `${head}\nAsk the human: ${r.question}\nThen call odd_task_answer and odd_dispatch again.`
  if (r.status === 'blocked') return `${head}\nBLOCKED: ${r.summary}\nStop and tell the human.`
  return `${head}\n${r.summary}\nRead the task with odd_task_read for the updated Next step.`
}
