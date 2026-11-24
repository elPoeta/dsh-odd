import { describe, expect, it } from 'vitest'
import { effectiveDeny, mergeConfig, pickKnown, READONLY_DENY } from '../src/core/config'
import { parseReport, toAdvanceInput } from '../src/core/contract'

const ok = { status: 'done', verdict: 'approve', summary: 'looks good' }

describe('report contract', () => {
  it('accepts a minimal valid report and defaults arrays', () => {
    expect(parseReport(ok)).toMatchObject({ status: 'done', findings: [], decisions: [] })
  })
  it.each([
    [null], ['x'], [[]],
    [{ status: 'nope', summary: 's' }],
    [{ status: 'done' }],
    [{ status: 'done', summary: '  ' }],
    [{ status: 'done', summary: 's', verdict: 'maybe' }],
    [{ status: 'needs_input', summary: 's' }],
    [{ status: 'done', summary: 's', findings: [1] }],
  ])('rejects malformed report %#', (bad) => {
    expect(() => parseReport(bad)).toThrow()
  })
  it('maps verdicts to workflow outcomes', () => {
    expect(toAdvanceInput('code-review', parseReport(ok), 's').outcome).toBe('done')
    expect(toAdvanceInput('code-review', parseReport({ ...ok, verdict: 'changes_requested' }), 's').outcome).toBe('changes_requested')
    expect(toAdvanceInput('code-review', parseReport({ status: 'done', summary: 's' }), 's').outcome).toBe('failed')
    expect(toAdvanceInput('pair', parseReport({ status: 'done', summary: 's' }), 's').outcome).toBe('done')
    expect(toAdvanceInput('pair', parseReport({ status: 'blocked', summary: 's' }), 's').outcome).toBe('blocked')
  })
})

describe('dispatch config', () => {
  it('ships code-review as a read-only dispatched role by default', () => {
    const cfg = mergeConfig({})
    expect(cfg.dispatch['code-review']).toMatchObject({ provider: 'spawn', readonly: true, include_diff: true, max_depth: 1 })
    expect(effectiveDeny(cfg.dispatch['code-review']!)).toEqual(expect.arrayContaining(READONLY_DENY))
  })
  it('can disable a role with null and adds extra denies', () => {
    expect(mergeConfig({ dispatch: { 'code-review': null } }).dispatch).toEqual({})
    const cfg = mergeConfig({ dispatch: { 'code-review': { tool_deny: ['web_fetch'] } } })
    expect(effectiveDeny(cfg.dispatch['code-review']!)).toContain('web_fetch')
  })
  it('rejects dispatch for phases that are not in any workflow', () => {
    expect(() => mergeConfig({ dispatch: { nope: { provider: 'spawn' } } })).toThrow(/not a phase/)
  })
  it('drops tool names that are not registered (host rejects unknown names)', () => {
    expect(pickKnown(['write', 'pwsh', 'bash'], ['write', 'bash', 'read'])).toEqual(['write', 'bash'])
    expect(pickKnown(['write', 'pwsh'], undefined)).toEqual(['write', 'pwsh'])
  })
})
