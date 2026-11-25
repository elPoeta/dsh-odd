/**
 * Harness API shapes used by the adapter. Every shape here was checked against
 * the harness docs (docs/subsystems/tools.md, dsh-commands README) and third-party
 * plugins that state they were verified against 0.2.1-rc.2. NOT yet smoke-tested on
 * 0.2.2-rc.5: run the checklist in README.md after installing.
 */

// Deliberately loose: the real Context type is not imported, so the core never
// depends on harness internals.
export type AnyCtx = any

/** ContentBlock text shape (also used by the SDK: {"type":"text","text":...}). */
export const textBlock = (text: string) => ({ type: 'text' as const, text })

/** CommandResult: the registry only accepts { kind: 'success' | 'error', text }. */
export const ok = (text: string) => ({ kind: 'success' as const, text })
export const fail = (text: string) => ({ kind: 'error' as const, text })

/** Registrations go through ctx.effect so they unload with the plugin. */
export function effect<T>(ctx: AnyCtx, fn: () => T, label: string): T {
  return typeof ctx.effect === 'function' ? ctx.effect(fn, label) : fn()
}

export interface PropSpec { type: 'string'; description?: string; enum?: readonly string[] }
export interface ObjectSchema {
  type: 'object'
  properties: Record<string, PropSpec>
  required: string[]
  additionalProperties: false
}

/** Raw JSON Schema root for ToolSchema.parameters (inside the enforced subset). */
export function objectSchema(properties: Record<string, PropSpec>, required: string[] = []): ObjectSchema {
  return { type: 'object', properties, required, additionalProperties: false }
}

/**
 * A raw ToolDefinition validates its own input ("execute receives args: unknown").
 * Strict on purpose: unknown keys, wrong types and bad enum values throw, which
 * the registry turns into a normal tool error for the model.
 */
export function checkArgs(args: unknown, schema: ObjectSchema): Record<string, string> {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) throw new Error('Arguments must be an object')
  const a = args as Record<string, unknown>
  for (const key of Object.keys(a)) if (!(key in schema.properties)) throw new Error(`Unknown argument "${key}"`)
  for (const key of schema.required) {
    if (typeof a[key] !== 'string' || !(a[key] as string).trim()) throw new Error(`"${key}" is required (non-empty string)`)
  }
  for (const [key, spec] of Object.entries(schema.properties)) {
    const v = a[key]
    if (v === undefined) continue
    if (typeof v !== 'string') throw new Error(`"${key}" must be a string`)
    if (spec.enum && !spec.enum.includes(v)) throw new Error(`"${key}" must be one of: ${spec.enum.join(', ')}`)
  }
  return a as Record<string, string>
}

/**
 * Submit a user message to an agent. dsh-plan-mode does the same for /plan <message>
 * ("submitted through agent.steer() as one trimmed user text block").
 * TODO(verify on 0.2.2-rc.5): the exact steer() argument type (block array assumed).
 */
export async function steerAgent(agent: AnyCtx, text: string): Promise<void> {
  if (!agent || typeof agent.steer !== 'function') throw new Error('agent.steer is not available')
  await agent.steer([textBlock(text)])
}

/**
 * Working directory of the session that owns an agent: agent.session.header.cwd
 * (documented in the harness note on session identity). Undefined when not available.
 */
export function sessionCwd(agent: unknown): string | undefined {
  const cwd = (agent as any)?.session?.header?.cwd
  return typeof cwd === 'string' && cwd ? cwd : undefined
}
