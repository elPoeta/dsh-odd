import { describe, expect, it } from 'vitest'
import { REPORT_SCHEMA } from '../src/core/contract'
import { ROLE_DEFAULTS, effectiveDeny } from '../src/core/config'
import type { RunRequest } from '../src/core/dispatch'
import { createSubagentClient, registeredToolNames } from '../src/host/subagent-client'

const role = { ...ROLE_DEFAULTS, include_diff: true }
const req = (over: Partial<RunRequest> = {}): RunRequest => ({
  label: 't:code-review', prompt: 'PACKET', outputSchema: REPORT_SCHEMA, role, toolDeny: effectiveDeny(role),
  signal: new AbortController().signal, ...over,
})

function fakeCtx(opts: { tools?: string[]; result?: () => Promise<any>; startError?: Error } = {}) {
  const starts: any[] = []
  const state = { disposed: 0 }
  const ctx = {
    tools: { schemas: () => (opts.tools ?? ['read', 'grep', 'write', 'edit', 'bash', 'subagent', 'odd_task_advance']).map((name) => ({ name })) },
    subagents: {
      start: async (provider: string, request: any) => {
        starts.push({ provider, request })
        if (opts.startError) throw opts.startError
        return {
          result: (opts.result ?? (async () => ({ stopReason: 'completed', structured: { status: 'done', summary: 's' }, output: [{ type: 'text', text: 'hi' }] })))(),
          dispose: async () => { state.disposed++ },
        }
      },
    },
  }
  return { ctx, starts, state }
}

describe('subagent client (ctx.subagents.start contract)', () => {
  it('sends a text-block prompt, outputSchema, maxDepth, parent, signal and a deny-only toolFilter', async () => {
    const { ctx, starts, state } = fakeCtx()
    const parent = { id: 'agent-1' }
    const r = await createSubagentClient(ctx, parent).run(req())
    expect(starts[0].provider).toBe('spawn')
    const s = starts[0].request
    expect(s.prompt).toEqual([{ type: 'text', text: 'PACKET' }])
    expect(s.outputSchema).toBe(REPORT_SCHEMA)
    expect(s.maxDepth).toBe(1)
    expect(s.parent).toBe(parent)
    expect(s.signal).toBeInstanceOf(AbortSignal)
    expect(s.toolFilter).toEqual({ deny: ['write', 'edit', 'bash', 'subagent', 'odd_task_advance'] }) // intersected with registered tools, no pwsh
    expect(r).toEqual({ stopReason: 'completed', structured: { status: 'done', summary: 's' }, outputText: 'hi' })
    expect(state.disposed).toBe(1)
  })

  it('omits toolFilter when no denied tool is registered (restrict() rejects empty filters)', async () => {
    const { ctx, starts } = fakeCtx({ tools: ['read', 'grep'] })
    await createSubagentClient(ctx, {}).run(req())
    expect('toolFilter' in starts[0].request).toBe(false)
  })

  it('always disposes the run, even when the result rejects', async () => {
    const { ctx, state } = fakeCtx({ result: () => Promise.reject(new Error('child crashed')) })
    await expect(createSubagentClient(ctx, {}).run(req())).rejects.toThrow(/child crashed/)
    expect(state.disposed).toBe(1)
  })

  it('propagates start rejections such as UNSUPPORTED_CAPABILITY', async () => {
    const { ctx } = fakeCtx({ startError: new Error('UNSUPPORTED_CAPABILITY: toolFilter') })
    await expect(createSubagentClient(ctx, {}).run(req())).rejects.toThrow(/UNSUPPORTED_CAPABILITY/)
  })

  it('explains a missing subagents service', async () => {
    await expect(createSubagentClient({ tools: { schemas: () => [] } }, {}).run(req())).rejects.toThrow(/subagents service is not available/)
  })

  it('forwards persona and reads tool names from ctx.tools.schemas()', async () => {
    const { ctx, starts } = fakeCtx()
    await createSubagentClient(ctx, {}).run(req({ role: { ...role, persona: 'strict-reviewer' } }))
    expect(starts[0].request.persona).toBe('strict-reviewer')
    expect(registeredToolNames(ctx)).toContain('write')
    expect(registeredToolNames({ tools: {} })).toBeUndefined()
    expect(registeredToolNames({ tools: { schemas: () => { throw new Error('x') } } })).toBeUndefined()
  })
})
