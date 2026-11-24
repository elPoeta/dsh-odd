import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '../src/core/config'
import { renderTask } from '../src/core/templates'
import { getSection, type Task } from '../src/core/task'
import { advance, resolveInput } from '../src/core/workflow'

const vars = { id: 'x', title: 'X', goal: 'g', branch: 'feat/x', created: '2026-11-24T10:00:00.000Z' }
const feature = () => renderTask('feature', DEFAULT_CONFIG, vars)
const at = (t: Task, phase: string): Task => ({ ...t, frontmatter: { ...t.frontmatter, phase, status: 'in_progress' } })

describe('workflow', () => {
  it('walks the feature workflow to done', () => {
    let t = feature()
    for (const phase of DEFAULT_CONFIG.workflows.feature) {
      expect(t.frontmatter.phase).toBe(phase)
      t = advance(t, DEFAULT_CONFIG, { outcome: 'done', summary: `${phase} ok` })
    }
    expect(t.frontmatter.status).toBe('done')
    expect(getSection(t.body, 'Plan')).not.toContain('[ ]')
  })

  it('hotfix skips grill/story/pair', () => {
    const t = renderTask('hotfix', DEFAULT_CONFIG, vars)
    expect(t.frontmatter.phase).toBe('fix')
  })

  it('sends changes_requested back to pair and counts loops', () => {
    const t = advance(at(feature(), 'code-review'), DEFAULT_CONFIG, { outcome: 'changes_requested', summary: 'missing tests' })
    expect(t.frontmatter).toMatchObject({ phase: 'pair', review_loops: 1, status: 'in_progress' })
    expect(getSection(t.body, 'Next step')).toContain('missing tests')
  })

  it('blocks when the review loop limit is exceeded', () => {
    let t = at(feature(), 'code-review')
    for (let i = 0; i < DEFAULT_CONFIG.limits.max_review_loops; i++) {
      t = advance(t, DEFAULT_CONFIG, { outcome: 'changes_requested', summary: 'again' })
      t = at(t, 'code-review')
    }
    t = advance(t, DEFAULT_CONFIG, { outcome: 'changes_requested', summary: 'again' })
    expect(t.frontmatter.status).toBe('blocked')
    expect(getSection(t.body, 'Next step')).toContain('BLOCKED')
  })

  it('retries a failed phase, then blocks', () => {
    let t = at(feature(), 'pair')
    for (let i = 1; i <= DEFAULT_CONFIG.limits.max_step_retries; i++) {
      t = advance(t, DEFAULT_CONFIG, { outcome: 'failed', summary: 'tests red' })
      expect(t.frontmatter).toMatchObject({ status: 'in_progress', phase: 'pair', retries: i })
    }
    t = advance(t, DEFAULT_CONFIG, { outcome: 'failed', summary: 'tests red' })
    expect(t.frontmatter.status).toBe('blocked')
  })

  it('needs_input records the question and resumes the same phase', () => {
    let t = advance(at(feature(), 'story'), DEFAULT_CONFIG, { outcome: 'needs_input', summary: 'q', question: 'Which provider?' })
    expect(t.frontmatter.status).toBe('needs_input')
    expect(getSection(t.body, 'Open questions')).toContain('Which provider?')
    t = resolveInput(t, 'Google')
    expect(t.frontmatter).toMatchObject({ status: 'in_progress', phase: 'story' })
  })

  it('refuses to advance a finished task', () => {
    const done = { ...feature(), frontmatter: { ...feature().frontmatter, status: 'done' as const } }
    expect(() => advance(done, DEFAULT_CONFIG, { outcome: 'done', summary: '' })).toThrow(/already done/)
  })
})
