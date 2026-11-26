import { expect } from 'vitest'

/** Minimal fake of the harness ctx: records registrations, enforces the output contract on tools. */
export function fakeCtx() {
  const commands = new Map<string, any>()
  const tools = new Map<string, any>()
  const ctx = {
    effect: (fn: () => unknown) => fn(),
    commands: { register: (d: any) => { commands.set(d.name, d); return () => commands.delete(d.name) } },
    tools: {
      register: (d: any) => { tools.set(d.name, d); return () => tools.delete(d.name) },
      schemas: () => [...tools.values()].map((t) => ({ name: t.name })),
    },
  }
  const call = async (name: string, args: any = {}, exec: any = {}) => {
    const def = tools.get(name)
    if (!def) throw new Error(`tool ${name} is not registered`)
    const value = await def.execute(args, exec)
    expect(typeof value).toBe('string')
    return value as string
  }
  return { ctx, commands, tools, call }
}

export const sessionExec = (cwd: string, agentPreset = 'odd') => ({
  agent: { session: { header: { cwd, agentPreset } } },
  signal: new AbortController().signal,
})
