import { parse } from 'yaml'
import { memoryDeny } from './memory-tools'
import type { TaskType } from './task'

/** How one phase is dispatched to a clean-context subagent. */
export interface RoleConfig {
  /** Registry name on ctx.subagents (e.g. "spawn" = fresh in-process child). */
  provider: string
  /** Read-only role: the READONLY_DENY tools are always removed from the child. */
  readonly: boolean
  /** Orchestrator runs `diff_command` and embeds the diff in the handoff packet. */
  include_diff: boolean
  /** Absolute delegation-depth cap for the child (blocks grandchildren). */
  max_depth: number
  /** Extra tool names to hide from the child. */
  tool_deny: string[]
  /**
   * Read-only roles normally lose the shell. A role that must RUN things to observe behavior
   * (verify) keeps bash/pwsh but still cannot write or edit files through tools. A shell can
   * write, so this is guidance plus tool-level hiding, not a sandbox.
   */
  allow_shell: boolean
  /** Extra skills embedded in the handoff packet next to the phase skill (e.g. "testing"). */
  skills: string[]
  persona?: string
  /**
   * Engram access for the child: 'none' hides every mem_* tool (default: the child
   * gets only its handoff packet), 'read' allows searching but never writing.
   */
  memory: 'none' | 'read'
  /** Orchestrator runs this itself after the subagent reports done; failure => failed. */
  verify_command?: string
}

/** Engram integration. Opt-in: the task md stays the source of truth, Engram is derived memory. */
export interface MemoryConfig {
  enabled: boolean
  /** Must match `serverName` of the mcp-client row; tools are mcp__<server_name>__mem_*. */
  server_name: string
  scope: 'project' | 'personal'
  /** Optional. When omitted Engram detects the project from the cwd. */
  project?: string
  /** Hard cap per saved observation. */
  max_item_chars: number
  recall_limit: number
}

export interface BootstrapConfig {
  /** Keep a managed ODD block in the project's AGENTS.md so every session acts as the orchestrator. */
  agents_md: boolean
  /**
   * Sessions running one of these agent presets already carry the ODD protocol in their
   * prompt, so the AGENTS.md block is not added for them (keeps your repos untouched).
   */
  skip_presets: string[]
}

export interface OddConfig {
  version: number
  /** manual = ask the human between phases; auto = only for low-risk phases. */
  mode: 'manual' | 'auto'
  limits: { max_review_loops: number; max_step_retries: number }
  /** Ordered phases per task type. Each phase maps to a skill name. */
  workflows: Record<TaskType, string[]>
  /** Phase to return to when code-review requests changes. */
  review_loopback: Record<TaskType, string>
  /** Skill search paths, highest precedence first. */
  skills_paths: string[]
  /** Phases that run in a subagent. Phases not listed run inline in the main agent. */
  dispatch: Record<string, RoleConfig>
  /** Map a phase to a skill with a different name (use your own skills without renaming them). */
  phase_skills: Record<string, string>
  /** Command whose stdout is the change set handed to reviewers. */
  diff_command: string
  memory: MemoryConfig
  bootstrap: BootstrapConfig
}

/**
 * Tools hidden from every read-only child: file mutation, shell (can write),
 * further delegation, and ALL orchestrator tools (only the orchestrator writes the md).
 * Names that are not registered in the host are dropped before start (see pickKnown).
 */
/** Tokens usable in skills_paths. {project} = nearest .git ancestor (or cwd), like DSH itself. */
export const SKILL_PATH_TOKENS = ['project', 'dsh_home', 'agents_home']

export const SHELL_TOOLS = ['bash', 'pwsh']

export const READONLY_DENY = [
  'write', 'edit', 'apply_patch', 'str_replace_editor', 'bash', 'pwsh',
  'subagent', 'subagent_fork', 'ask_user_question',
  'odd_task_create', 'odd_task_read', 'odd_task_advance', 'odd_task_answer',
  'odd_task_note', 'odd_task_archive', 'odd_dispatch',
]

export const ROLE_DEFAULTS: RoleConfig = {
  provider: 'spawn', readonly: true, include_diff: false, max_depth: 1, tool_deny: [], allow_shell: false, skills: [], memory: 'none',
}

/**
 * Precedence, highest first. Mirrors DSH's own roots (project-dsh, project-agents,
 * user-dsh, user-agents) with the ODD project root on top; the plugin's bundled
 * skills are always appended last as "builtin".
 */
export const DEFAULT_SKILLS_PATHS = [
  '.odd/skills',
  '{project}/.dsh/skills',
  '{project}/.agents/skills',
  '{dsh_home}/skills',
  '{agents_home}/skills',
]

export const DEFAULT_CONFIG: OddConfig = {
  version: 1,
  mode: 'manual',
  limits: { max_review_loops: 3, max_step_retries: 2 },
  workflows: {
    plan: ['grill', 'to-tickets'],
    feature: ['story', 'pair', 'code-review', 'verify', 'ship'],
    hotfix: ['fix', 'code-review', 'verify', 'ship'],
    refactor: ['refactor', 'code-review', 'ship'],
  },
  review_loopback: { plan: 'grill', feature: 'pair', hotfix: 'fix', refactor: 'refactor' },
  skills_paths: [...DEFAULT_SKILLS_PATHS],
  dispatch: {
    'code-review': { ...ROLE_DEFAULTS, include_diff: true, skills: ['testing'] },
    verify: { ...ROLE_DEFAULTS, allow_shell: true },
  },
  phase_skills: {},
  diff_command: 'git diff HEAD',
  memory: { enabled: false, server_name: 'engram', scope: 'project', max_item_chars: 1500, recall_limit: 5 },
  bootstrap: { agents_md: true, skip_presets: ['odd'] },
}

export const DEFAULT_CONFIG_YAML = `# ODD configuration. Markdown task files are the source of truth.
version: 1
mode: manual            # manual | auto
limits:
  max_review_loops: 3   # pair <-> code-review iterations before the task is blocked
  max_step_retries: 2   # failed retries per phase before the task is blocked
workflows:
  plan: [grill, to-tickets]   # an idea becomes tickets; each ticket is a feature task
  feature: [story, pair, code-review, verify, ship]
  hotfix: [fix, code-review, verify, ship]
  refactor: [refactor, code-review, ship]
review_loopback:       # where a failed review or verification sends the task back to
  plan: grill
  feature: pair
  hotfix: fix
  refactor: refactor
skills_paths:           # precedence: first match wins (ODD project > project > user > built-in)
  - .odd/skills                  # ODD-only project skills (relative to where .odd lives)
  - "{project}/.dsh/skills"      # {project} = nearest .git ancestor, like DSH
  - "{project}/.agents/skills"
  - "{dsh_home}/skills"          # $DSH_HOME or ~/.dsh
  - "{agents_home}/skills"       # $DSH_AGENTS_HOME or ~/.agents
# phase_skills:         # use your own skills under other names: phase -> skill name
#   grill: grill-me
diff_command: git diff HEAD   # change set embedded in the reviewer's handoff packet
dispatch:               # phases run in a clean-context subagent; others run inline
  code-review:
    provider: spawn     # fresh child, sees no parent history
    readonly: true      # hides write/edit/shell/delegation/odd tools from the child
    include_diff: true
    max_depth: 1
    skills: [testing]   # extra skills embedded in the packet (the child cannot load skills itself)
    # tool_deny: []     # extra tools to hide
    # memory: none      # none | read: whether the child may search Engram (it never writes)
    # verify_command: "" # orchestrator-run check after the child reports done
  verify:
    provider: spawn
    readonly: true      # no write/edit tools...
    allow_shell: true   # ...but it may run commands to observe behavior (curl, the app, the CLI)
    include_diff: false # it judges behavior, not the diff
  # to disable: set a phase to null, e.g.  code-review: null
bootstrap:
  agents_md: true       # managed ODD block in AGENTS.md: sessions in this project act as the orchestrator
  skip_presets: [odd]   # not added when the session runs these agent presets (their prompt already has it)
memory:                 # Engram integration (opt-in). The task md stays the source of truth.
  enabled: false
  server_name: engram   # must match serverName of the @deepseek-ai/dsh-mcp-client row
  scope: project        # project | personal
  # project: ""         # optional; Engram detects it from the cwd when omitted
  max_item_chars: 1500
  recall_limit: 5
`

type RawConfig = Partial<Omit<OddConfig, 'dispatch' | 'memory' | 'bootstrap'>> & {
  dispatch?: Record<string, Partial<RoleConfig> | null>
  memory?: Partial<MemoryConfig>
  bootstrap?: Partial<BootstrapConfig>
}

export function mergeConfig(user: RawConfig | null | undefined): OddConfig {
  const u = user ?? {}
  const dispatch: Record<string, RoleConfig> = {}
  const rawDispatch = { ...DEFAULT_CONFIG.dispatch, ...(u.dispatch ?? {}) } as Record<string, Partial<RoleConfig> | null>
  for (const [phase, role] of Object.entries(rawDispatch)) {
    if (role === null || role === undefined) continue
    dispatch[phase] = { ...ROLE_DEFAULTS, ...(DEFAULT_CONFIG.dispatch[phase] ?? {}), ...role } as RoleConfig
  }
  const cfg: OddConfig = {
    ...DEFAULT_CONFIG,
    ...u,
    limits: { ...DEFAULT_CONFIG.limits, ...(u.limits ?? {}) },
    workflows: { ...DEFAULT_CONFIG.workflows, ...(u.workflows ?? {}) },
    review_loopback: { ...DEFAULT_CONFIG.review_loopback, ...(u.review_loopback ?? {}) },
    dispatch,
    phase_skills: { ...DEFAULT_CONFIG.phase_skills, ...(u.phase_skills ?? {}) },
    memory: { ...DEFAULT_CONFIG.memory, ...(u.memory ?? {}) },
    bootstrap: { ...DEFAULT_CONFIG.bootstrap, ...(u.bootstrap ?? {}) },
  }
  validateConfig(cfg)
  return cfg
}

export function parseConfig(yamlText: string): OddConfig {
  return mergeConfig(parse(yamlText) as RawConfig | null)
}

export function validateConfig(cfg: OddConfig): void {
  const allPhases = new Set<string>()
  for (const [type, phases] of Object.entries(cfg.workflows)) {
    if (!Array.isArray(phases) || phases.length === 0) throw new Error(`Workflow "${type}" must list at least one phase`)
    phases.forEach((p) => allPhases.add(p))
    const lb = cfg.review_loopback[type as TaskType]
    if (lb && !phases.includes(lb)) throw new Error(`review_loopback "${lb}" is not a phase of workflow "${type}"`)
  }
  if (cfg.limits.max_review_loops < 1 || cfg.limits.max_step_retries < 0) throw new Error('Invalid limits')
  if (cfg.mode !== 'manual' && cfg.mode !== 'auto') throw new Error(`Invalid mode: ${String(cfg.mode)}`)
  for (const p of cfg.skills_paths) {
    for (const m of p.matchAll(/\{(\w+)\}/g)) {
      if (!SKILL_PATH_TOKENS.includes(m[1]!)) throw new Error(`Unknown token {${m[1]}} in skills_paths (allowed: ${SKILL_PATH_TOKENS.join(', ')})`)
    }
  }
  for (const [phase, role] of Object.entries(cfg.dispatch)) {
    if (!allPhases.has(phase)) throw new Error(`dispatch."${phase}" is not a phase of any workflow`)
    if (!role.provider) throw new Error(`dispatch."${phase}".provider is required`)
    if (!Number.isInteger(role.max_depth) || role.max_depth < 0) throw new Error(`dispatch."${phase}".max_depth must be a non-negative integer`)
    if (role.memory !== 'none' && role.memory !== 'read') throw new Error(`dispatch."${phase}".memory must be "none" or "read"`)
    if (typeof role.allow_shell !== 'boolean') throw new Error(`dispatch."${phase}".allow_shell must be true or false`)
    if (!Array.isArray(role.skills) || role.skills.some((n) => typeof n !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(n))) {
      throw new Error(`dispatch."${phase}".skills must be a list of skill names`)
    }
  }
  for (const [phase, skill] of Object.entries(cfg.phase_skills)) {
    if (!allPhases.has(phase)) throw new Error(`phase_skills."${phase}" is not a phase of any workflow`)
    if (typeof skill !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(skill)) throw new Error(`phase_skills."${phase}" must be a skill name (lowercase letters, digits, hyphens)`)
  }
  if (typeof cfg.bootstrap.agents_md !== 'boolean') throw new Error('bootstrap.agents_md must be true or false')
  if (!Array.isArray(cfg.bootstrap.skip_presets) || cfg.bootstrap.skip_presets.some((p) => typeof p !== 'string')) {
    throw new Error('bootstrap.skip_presets must be a list of preset ids')
  }
  const m = cfg.memory
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(m.server_name)) throw new Error('memory.server_name must match [A-Za-z0-9_-]{1,32}')
  if (m.scope !== 'project' && m.scope !== 'personal') throw new Error('memory.scope must be "project" or "personal"')
  if (!Number.isInteger(m.max_item_chars) || m.max_item_chars < 200) throw new Error('memory.max_item_chars must be an integer >= 200')
  if (!Number.isInteger(m.recall_limit) || m.recall_limit < 1 || m.recall_limit > 20) throw new Error('memory.recall_limit must be 1-20')
}

/** Name of the skill that runs a phase: the mapped one, else the phase name itself. */
export function skillFor(cfg: OddConfig, phase: string): string {
  return cfg.phase_skills[phase] ?? phase
}

/** Tools to hide from the child of this role (before intersecting with registered tools). */
export function effectiveDeny(role: RoleConfig, memoryServer = 'engram'): string[] {
  return [...new Set([
    ...(role.readonly ? READONLY_DENY.filter((n) => !(role.allow_shell && SHELL_TOOLS.includes(n))) : []),
    ...role.tool_deny,
    ...memoryDeny(memoryServer, role.memory),
  ])]
}

/**
 * The host rejects unknown tool names in a toolFilter, and some names only exist
 * on some platforms (pwsh on Windows). Keep only names that are registered.
 */
export function pickKnown(deny: string[], known: string[] | undefined): string[] {
  if (!known) return deny
  const set = new Set(known)
  return deny.filter((n) => set.has(n))
}
