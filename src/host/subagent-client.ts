/**
 * SubagentClient over ctx.subagents, per docs/subsystems/subagent.md:
 *   ctx.subagents.start(providerName, { label?, prompt: ContentBlock[], parent: Agent,
 *     signal, outputSchema?, maxDepth?, toolFilter?, persona? }) -> Promise<SubagentRun>
 *   run.result -> { output: ContentBlock[], structured?, stopReason }
 *   run.dispose() MUST always be called.
 * toolFilter is a ToolRestriction ({ allow?, deny? }). ctx.tools.restrict rejects
 * unknown names and empty filters, so deny names are intersected with the tools the
 * registry actually exposes (ctx.tools.schemas()) and an empty filter is omitted.
 * Unsupported start-time capabilities reject loudly (UNSUPPORTED_CAPABILITY), which
 * fails closed for read-only roles: the orchestrator records a failed attempt.
 */
import { pickKnown } from '../core/config'
import type { RunRequest, RunResult, SubagentClient } from '../core/dispatch'
import { textBlock, type AnyCtx } from './api'

function blocksToText(blocks: unknown): string {
  if (!Array.isArray(blocks)) return ''
  return blocks.map((b) => (b && typeof b === 'object' && typeof (b as any).text === 'string' ? (b as any).text : '')).join('')
}

/** Global view of registered tool names. Undefined when the registry cannot be read. */
export function registeredToolNames(ctx: AnyCtx): string[] | undefined {
  try {
    const schemas = ctx.tools?.schemas?.()
    if (!Array.isArray(schemas)) return undefined
    return schemas.map((s: any) => s?.name).filter((n: unknown): n is string => typeof n === 'string')
  } catch { return undefined }
}

export function createSubagentClient(ctx: AnyCtx, parent: unknown): SubagentClient {
  return {
    async run(req: RunRequest): Promise<RunResult> {
      if (!ctx.subagents || typeof ctx.subagents.start !== 'function') {
        throw new Error('The subagents service is not available in this profile (enable the subagent plugins)')
      }
      const deny = pickKnown(req.toolDeny, registeredToolNames(ctx))
      const run = await ctx.subagents.start(req.role.provider, {
        label: req.label,
        prompt: [textBlock(req.prompt)],
        parent,
        signal: req.signal,
        outputSchema: req.outputSchema,
        maxDepth: req.role.max_depth,
        ...(deny.length ? { toolFilter: { deny } } : {}),
        ...(req.role.persona ? { persona: req.role.persona } : {}),
      })
      try {
        const r = await run.result
        return { stopReason: String(r.stopReason), structured: r.structured, outputText: blocksToText(r.output) }
      } finally {
        await run.dispose()
      }
    },
  }
}
