/**
 * SubagentClient over ctx.subagents. Based on the documented contract in
 * docs/subsystems/subagent.md of deepseek-harness:
 *   ctx.subagents.start(providerName, { label?, prompt: ContentBlock[], parent: Agent,
 *     signal, outputSchema?, maxDepth?, toolFilter?, persona? }) -> Promise<SubagentRun>
 *   run.result -> { output: ContentBlock[], structured?, stopReason }
 *   run.dispose() MUST always be called.
 * Unsupported start-time capabilities reject loudly (UNSUPPORTED_CAPABILITY),
 * which fails closed for read-only roles: the orchestrator records a failure.
 *
 * Still NOT verified (TODO(verify)): ContentBlock text shape, ToolRestriction
 * shape, how a tool handler receives its parent Agent, and how to list tools.
 */
import { pickKnown } from '../core/config'
import type { RunRequest, RunResult, SubagentClient } from '../core/dispatch'

type AnyCtx = any // TODO(verify): Context from '@deepseek-ai/cordis'

const textBlock = (text: string) => ({ type: 'text', text }) // TODO(verify): ContentBlock text shape

function blocksToText(blocks: unknown): string {
  if (!Array.isArray(blocks)) return ''
  return blocks.map((b) => (b && typeof b === 'object' && typeof (b as any).text === 'string' ? (b as any).text : '')).join('')
}

/** TODO(verify): real API for enumerating registered tool names. */
function registeredToolNames(ctx: AnyCtx): string[] | undefined {
  try {
    const list = ctx.tools?.list?.() ?? ctx.tools?.names?.()
    if (!Array.isArray(list)) return undefined
    return list.map((t: any) => (typeof t === 'string' ? t : t?.name)).filter((n: unknown): n is string => typeof n === 'string')
  } catch { return undefined }
}

export function createSubagentClient(ctx: AnyCtx, parent: unknown): SubagentClient {
  return {
    async run(req: RunRequest): Promise<RunResult> {
      const deny = pickKnown(req.toolDeny, registeredToolNames(ctx))
      const run = await ctx.subagents.start(req.role.provider, {
        label: req.label,
        prompt: [textBlock(req.prompt)],
        parent,
        signal: req.signal,
        outputSchema: req.outputSchema,
        maxDepth: req.role.max_depth,
        // TODO(verify): ToolRestriction shape (docs mention an allow/deny contract).
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
