import type { OddConfig } from './config'
import { appendLog, appendToSection, checkItem, setNextStep, type Frontmatter, type Task } from './task'

/** Contract returned by a subagent (or by the main agent in phase 1). */
export type Outcome = 'done' | 'needs_input' | 'blocked' | 'failed' | 'changes_requested'

export const OUTCOMES: Outcome[] = ['done', 'needs_input', 'blocked', 'failed', 'changes_requested']

export interface AdvanceInput {
  outcome: Outcome
  summary: string
  actor?: string
  /** For needs_input: the question to surface to the human. */
  question?: string
}

/**
 * Pure state machine. Given the task and a phase outcome, returns the next
 * task state. It never touches the filesystem, so it is trivial to test.
 */
export function advance(task: Task, cfg: OddConfig, input: AdvanceInput, now = new Date()): Task {
  const actor = input.actor ?? 'orchestrator'
  const fm = task.frontmatter
  const phases = cfg.workflows[fm.type]
  const idx = phases.indexOf(fm.phase)
  if (idx === -1) throw new Error(`Phase "${fm.phase}" is not part of the ${fm.type} workflow`)
  if (fm.status === 'done') throw new Error('Task is already done')

  let next: Task = { ...task, frontmatter: { ...fm, updated: now.toISOString() } }
  const log = (msg: string) => { next = appendLog(next, actor, msg, now) }
  const set = (patch: Partial<Frontmatter>) => { next = { ...next, frontmatter: { ...next.frontmatter, ...patch } } }

  switch (input.outcome) {
    case 'done': {
      log(`${fm.phase}: done - ${input.summary}`)
      next = { ...next, body: checkItem(next.body, 'Plan', fm.phase) }
      const following = phases[idx + 1]
      if (following === undefined) {
        set({ status: 'done', retries: 0 })
        return setNextStep(next, 'Task complete. Archive it with `odd_task_archive` once merged.')
      }
      set({ phase: following, status: 'in_progress', retries: 0 })
      return setNextStep(next, `Run phase "${following}". Previous result: ${input.summary}`)
    }
    case 'changes_requested': {
      const loops = fm.review_loops + 1
      const target = cfg.review_loopback[fm.type]
      if (loops > cfg.limits.max_review_loops) {
        log(`${fm.phase}: changes requested (loop ${loops}) - limit reached, blocking. ${input.summary}`)
        set({ status: 'blocked', review_loops: loops })
        return setNextStep(next, `BLOCKED: review loop limit (${cfg.limits.max_review_loops}) reached. Human decision needed. Last findings: ${input.summary}`)
      }
      log(`${fm.phase}: changes requested (loop ${loops}/${cfg.limits.max_review_loops}) - ${input.summary}`)
      set({ phase: target, status: 'in_progress', review_loops: loops, retries: 0 })
      return setNextStep(next, `Back to "${target}" to address review findings: ${input.summary}`)
    }
    case 'failed': {
      const retries = fm.retries + 1
      if (retries > cfg.limits.max_step_retries) {
        log(`${fm.phase}: failed (retry ${retries}) - limit reached, blocking. ${input.summary}`)
        set({ status: 'blocked', retries })
        return setNextStep(next, `BLOCKED: "${fm.phase}" failed ${retries} times. Last error: ${input.summary}`)
      }
      log(`${fm.phase}: failed (retry ${retries}/${cfg.limits.max_step_retries}) - ${input.summary}`)
      set({ status: 'in_progress', retries })
      return setNextStep(next, `Retry "${fm.phase}". Last error: ${input.summary}`)
    }
    case 'needs_input': {
      const q = input.question ?? input.summary
      log(`${fm.phase}: needs input - ${q}`)
      set({ status: 'needs_input' })
      next = { ...next, body: appendToSection(next.body, 'Open questions', `- [ ] ${q}`) }
      return setNextStep(next, `Waiting for the human. Ask: ${q}`)
    }
    case 'blocked': {
      log(`${fm.phase}: blocked - ${input.summary}`)
      set({ status: 'blocked' })
      return setNextStep(next, `BLOCKED: ${input.summary}`)
    }
  }
}

/** The human answered a pending question: resume the same phase. */
export function resolveInput(task: Task, answer: string, now = new Date()): Task {
  if (task.frontmatter.status !== 'needs_input') throw new Error('Task is not waiting for input')
  let next = appendLog(task, 'human', `answered: ${answer}`, now)
  next = { ...next, frontmatter: { ...next.frontmatter, status: 'in_progress', updated: now.toISOString() } }
  return setNextStep(next, `Re-run phase "${next.frontmatter.phase}" with the human's answer: ${answer}`)
}
