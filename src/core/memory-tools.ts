/**
 * Engram MCP tools, as DSH registers them: mcp__<serverName>__<tool>
 * (serverName is the `serverName` of the @deepseek-ai/dsh-mcp-client row).
 * Tool list from the Engram docs (20 tools; the `agent` profile exposes 11).
 */
export const MEMORY_READ_TOOLS = [
  'mem_search', 'mem_context', 'mem_timeline', 'mem_get_observation', 'mem_stats',
  'mem_current_project', 'mem_doctor', 'mem_suggest_topic_key',
]
export const MEMORY_WRITE_TOOLS = [
  'mem_save', 'mem_update', 'mem_delete', 'mem_session_start', 'mem_session_end', 'mem_session_summary',
  'mem_save_prompt', 'mem_capture_passive', 'mem_merge_projects', 'mem_judge', 'mem_compare', 'mem_review',
]

export const mcpToolName = (server: string, tool: string) => `mcp__${server}__${tool}`

/** What the orchestrator itself needs from Engram. All are in the `agent` profile. */
export const REQUIRED_MEMORY_TOOLS = ['mem_save', 'mem_search', 'mem_get_observation', 'mem_context']

/** Tools hidden from a subagent: 'none' hides everything, 'read' hides only the writers. */
export function memoryDeny(server: string, mode: 'none' | 'read'): string[] {
  const names = mode === 'read' ? MEMORY_WRITE_TOOLS : [...MEMORY_READ_TOOLS, ...MEMORY_WRITE_TOOLS]
  return names.map((n) => mcpToolName(server, n))
}
