import type { OddConfig } from './config'
import { parseTask, serializeTask, type Task, type TaskType } from './task'

export interface TemplateVars {
  id: string
  title: string
  goal: string
  branch: string
  created: string
  /** Phase to start at. Earlier phases are marked skipped. Defaults to the first phase. */
  start_phase?: string
}

/**
 * Sections skills write on demand (Backlog, Implementation plan, Out of scope, Suggestions, Answers,
 * Reviews, Verification, Delivery, Memory) are created when first used; the ones below are always present
 * so the file reads in a stable order.
 */
const head = (goalHint = '') => `---
id: {{id}}
type: {{type}}
status: todo
phase: {{first_phase}}
branch: {{branch}}
review_loops: 0
retries: 0
created: {{created}}
updated: {{created}}
---
# {{title}}

## Goal
${goalHint}{{goal}}

## Plan
{{plan_checklist}}

## Next step
{{next_step}}

`

const tail = (rootCause = '') => `## Story

## Acceptance criteria

${rootCause}## Test list

## Decisions

## Lessons

## Handoffs

## Log
- {{created}} [orchestrator] task created

## Open questions

## Evidence`

/** Default templates, one per task type. Override with .odd/templates/<type>.md */
const planTail = `## Backlog

## Tickets

## Decisions

## Lessons

## Handoffs

## Log
- {{created}} [orchestrator] task created

## Open questions

## Evidence`

export const DEFAULT_TEMPLATES: Record<TaskType, string> = {
  plan: head('<!-- plan: the idea. Grill it, slice it into a backlog, then turn it into tickets (one task each) -->\n') + planTail,
  feature: head() + tail(),
  hotfix: head('<!-- hotfix: describe the symptom; the cause goes under Root cause -->\n') + tail('## Root cause\n\n'),
  refactor: head('<!-- refactor: behavior must not change; the safety net goes under Test list -->\n') + tail(),
}

export function render(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    if (!(key in vars)) throw new Error(`Unknown template placeholder: {{${key}}}`)
    return vars[key]!
  })
}

export function renderTask(type: TaskType, cfg: OddConfig, vars: TemplateVars, template?: string): Task {
  const phases = cfg.workflows[type]
  const start = vars.start_phase ?? phases[0]!
  const startIdx = phases.indexOf(start)
  if (startIdx === -1) throw new Error(`"${start}" is not a phase of the ${type} workflow (phases: ${phases.join(', ')})`)
  const { start_phase: _ignored, ...rest } = vars
  const text = render(template ?? DEFAULT_TEMPLATES[type], {
    ...rest,
    type,
    first_phase: start,
    plan_checklist: phases.map((p, i) => (i < startIdx ? `- [x] ${p} (skipped)` : `- [ ] ${p}`)).join('\n'),
    next_step: `Run phase "${start}". Goal: ${vars.goal || vars.title}`,
  })
  // Round-trip validates the template and normalizes formatting.
  return parseTask(serializeTask(parseTask(text)))
}
