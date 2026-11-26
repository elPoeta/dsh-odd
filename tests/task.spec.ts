import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '../src/core/config'
import { renderTask } from '../src/core/templates'
import {
  appendLog, appendToSection, checkItem, getSection, parseChecklist, parseTask, progress, serializeTask, setSection,
} from '../src/core/task'

const vars = { id: 'login-oauth', title: 'Login OAuth', goal: 'Sign in with Google', branch: 'feat/login-oauth', created: '2026-11-24T10:00:00.000Z' }
const fresh = () => renderTask('feature', DEFAULT_CONFIG, vars)

describe('task markdown', () => {
  it('renders a valid task from the template', () => {
    const t = fresh()
    expect(t.frontmatter).toMatchObject({ id: 'login-oauth', type: 'feature', status: 'todo', phase: 'story' })
    expect(getSection(t.body, 'Goal')).toBe('Sign in with Google')
    expect(progress(t)).toEqual({ done: 0, total: 5 })
  })

  it('round-trips without drift', () => {
    const once = serializeTask(fresh())
    expect(serializeTask(parseTask(once))).toBe(once)
  })

  it('keeps all sections when editing one', () => {
    let t = fresh()
    t = { ...t, body: setSection(t.body, 'Decisions', '- use PKCE') }
    t = { ...t, body: appendToSection(t.body, 'Decisions', '- no sessions') }
    expect(getSection(t.body, 'Decisions')).toBe('- use PKCE\n- no sessions')
    expect(getSection(t.body, 'Evidence')).toBe('')
    expect(getSection(t.body, 'Goal')).toBe('Sign in with Google')
  })

  it('appends to the log with actor and timestamp', () => {
    const t = appendLog(fresh(), 'pair', 'started', new Date('2026-11-24T11:00:00Z'))
    expect(getSection(t.body, 'Log')).toContain('- 2026-11-24T11:00:00.000Z [pair] started')
  })

  it('ticks checklist items by prefix', () => {
    const t = fresh()
    const body = checkItem(t.body, 'Plan', 'story')
    expect(parseChecklist(getSection(body, 'Plan')!)[0]).toEqual({ done: true, text: 'story' })
  })

  it('rejects invalid frontmatter', () => {
    expect(() => parseTask('no frontmatter')).toThrow()
    expect(() => parseTask('---\nid: Bad Name\ntype: feature\nstatus: todo\nphase: x\n---\n')).toThrow(/Invalid task id/)
  })
})
