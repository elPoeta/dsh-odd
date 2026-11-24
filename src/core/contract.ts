import type { AdvanceInput } from './workflow'

export type ReportStatus = 'done' | 'needs_input' | 'blocked' | 'failed'
export type Verdict = 'approve' | 'changes_requested'

/** What a subagent must return. Flat on purpose: the host accepts only a JSON Schema subset. */
export interface SubagentReport {
  status: ReportStatus
  verdict?: Verdict
  summary: string
  question?: string
  findings: string[]
  files_touched: string[]
  tests_command?: string
  tests_result?: string
  decisions: string[]
}

// TODO(verify): confirm this stays inside the host's assertObjectJsonSchema subset.
export const REPORT_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['done', 'needs_input', 'blocked', 'failed'] },
    verdict: { type: 'string', enum: ['approve', 'changes_requested'] },
    summary: { type: 'string' },
    question: { type: 'string' },
    findings: { type: 'array', items: { type: 'string' } },
    files_touched: { type: 'array', items: { type: 'string' } },
    tests_command: { type: 'string' },
    tests_result: { type: 'string' },
    decisions: { type: 'array', items: { type: 'string' } },
  },
  required: ['status', 'summary'],
} as const

/** Phases whose `done` must carry an explicit verdict. */
export const VERDICT_PHASES = ['code-review']

const STATUSES: ReportStatus[] = ['done', 'needs_input', 'blocked', 'failed']
const VERDICTS: Verdict[] = ['approve', 'changes_requested']

function strArray(v: unknown, field: string): string[] {
  if (v === undefined) return []
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) throw new Error(`"${field}" must be an array of strings`)
  return v as string[]
}

/** Strict validation. The orchestrator never trusts the child's shape. */
export function parseReport(structured: unknown): SubagentReport {
  if (typeof structured !== 'object' || structured === null || Array.isArray(structured)) throw new Error('result is not an object')
  const o = structured as Record<string, unknown>
  if (!STATUSES.includes(o.status as ReportStatus)) throw new Error(`invalid status: ${String(o.status)}`)
  if (typeof o.summary !== 'string' || !o.summary.trim()) throw new Error('summary is required')
  if (o.verdict !== undefined && !VERDICTS.includes(o.verdict as Verdict)) throw new Error(`invalid verdict: ${String(o.verdict)}`)
  if (o.status === 'needs_input' && (typeof o.question !== 'string' || !o.question.trim())) throw new Error('needs_input requires a question')
  for (const k of ['question', 'tests_command', 'tests_result'] as const) {
    if (o[k] !== undefined && typeof o[k] !== 'string') throw new Error(`"${k}" must be a string`)
  }
  return {
    status: o.status as ReportStatus,
    verdict: o.verdict as Verdict | undefined,
    summary: o.summary.trim(),
    question: o.question as string | undefined,
    findings: strArray(o.findings, 'findings'),
    files_touched: strArray(o.files_touched, 'files_touched'),
    tests_command: o.tests_command as string | undefined,
    tests_result: o.tests_result as string | undefined,
    decisions: strArray(o.decisions, 'decisions'),
  }
}

/** Map a validated report to a workflow outcome. A review `done` without a verdict is a failure. */
export function toAdvanceInput(phase: string, r: SubagentReport, summary: string): AdvanceInput {
  const actor = `subagent:${phase}`
  if (r.status === 'done') {
    if (r.verdict === 'changes_requested') return { outcome: 'changes_requested', summary, actor }
    if (VERDICT_PHASES.includes(phase) && r.verdict !== 'approve') {
      return { outcome: 'failed', summary: `"${phase}" returned done without a verdict (approve | changes_requested)`, actor }
    }
    return { outcome: 'done', summary, actor }
  }
  if (r.status === 'needs_input') return { outcome: 'needs_input', summary, question: r.question, actor }
  return { outcome: r.status, summary, actor }
}
