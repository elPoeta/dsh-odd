import type { OddConfig } from './config'
import { parseTask, serializeTask, type Task, type TaskType } from './task'

export interface TemplateVars {
  id: string
  title: string
  goal: string
  branch: string
  created: string
}

const COMMON_TAIL = `## Next step
{{next_step}}

## Decisions

## Handoffs

## Log
- {{created}} [orchestrator] task created

## Open questions

## Evidence`

const HEAD = `---
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
{{goal}}

## Plan
{{plan_checklist}}

`

/** Default templates, one per task type. Override with .odd/templates/<type>.md */
export const DEFAULT_TEMPLATES: Record<TaskType, string> = {
  feature: HEAD + COMMON_TAIL,
  hotfix: HEAD.replace('## Goal', '## Goal\n<!-- hotfix: describe the symptom, then the root cause once known -->') + COMMON_TAIL,
  refactor: HEAD.replace('## Goal', '## Goal\n<!-- refactor: behavior must not change; list the safety net (tests) -->') + COMMON_TAIL,
}

export function render(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    if (!(key in vars)) throw new Error(`Unknown template placeholder: {{${key}}}`)
    return vars[key]!
  })
}

export function renderTask(type: TaskType, cfg: OddConfig, vars: TemplateVars, template?: string): Task {
  const phases = cfg.workflows[type]
  const text = render(template ?? DEFAULT_TEMPLATES[type], {
    ...vars,
    type,
    first_phase: phases[0]!,
    plan_checklist: phases.map((p) => `- [ ] ${p}`).join('\n'),
    next_step: `Run phase "${phases[0]}". Goal: ${vars.goal || vars.title}`,
  })
  // Round-trip validates the template and normalizes formatting.
  return parseTask(serializeTask(parseTask(text)))
}
