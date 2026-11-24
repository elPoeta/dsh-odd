import { parse } from 'yaml'
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
  persona?: string
  /** Orchestrator runs this itself after the subagent reports done; failure => failed. */
  verify_command?: string
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
  /** Command whose stdout is the change set handed to reviewers. */
  diff_command: string
}

/**
 * Tools hidden from every read-only child: file mutation, shell (can write),
 * further delegation, and ALL orchestrator tools (only the orchestrator writes the md).
 * Names that are not registered in the host are dropped before start (see pickKnown).
 */
/** Tokens usable in skills_paths. {project} = nearest .git ancestor (or cwd), like DSH itself. */
export const SKILL_PATH_TOKENS = ['project', 'dsh_home', 'agents_home']

export const READONLY_DENY = [
  'write', 'edit', 'str_replace_editor', 'bash', 'pwsh',
  'subagent',
  'odd_task_create', 'odd_task_read', 'odd_task_advance', 'odd_task_answer',
  'odd_task_note', 'odd_task_archive', 'odd_dispatch',
]

export const ROLE_DEFAULTS: RoleConfig = {
  provider: 'spawn', readonly: true, include_diff: false, max_depth: 1, tool_deny: [],
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
    feature: ['grill', 'story', 'pair', 'code-review', 'ship'],
    hotfix: ['fix', 'code-review', 'ship'],
    refactor: ['refactor', 'code-review', 'ship'],
  },
  review_loopback: { feature: 'pair', hotfix: 'fix', refactor: 'refactor' },
  skills_paths: [...DEFAULT_SKILLS_PATHS],
  dispatch: {
    'code-review': { ...ROLE_DEFAULTS, include_diff: true },
  },
  diff_command: 'git diff HEAD',
}

export const DEFAULT_CONFIG_YAML = `# ODD configuration. Markdown task files are the source of truth.
version: 1
mode: manual            # manual | auto
limits:
  max_review_loops: 3   # pair <-> code-review iterations before the task is blocked
  max_step_retries: 2   # failed retries per phase before the task is blocked
workflows:
  feature: [grill, story, pair, code-review, ship]
  hotfix: [fix, code-review, ship]
  refactor: [refactor, code-review, ship]
review_loopback:
  feature: pair
  hotfix: fix
  refactor: refactor
skills_paths:           # precedence: first match wins (ODD project > project > user > built-in)
  - .odd/skills                  # ODD-only project skills (relative to where .odd lives)
  - "{project}/.dsh/skills"      # {project} = nearest .git ancestor, like DSH
  - "{project}/.agents/skills"
  - "{dsh_home}/skills"          # $DSH_HOME or ~/.dsh
  - "{agents_home}/skills"       # $DSH_AGENTS_HOME or ~/.agents
diff_command: git diff HEAD   # change set embedded in the reviewer's handoff packet
dispatch:               # phases run in a clean-context subagent; others run inline
  code-review:
    provider: spawn     # fresh child, sees no parent history
    readonly: true      # hides write/edit/shell/delegation/odd tools from the child
    include_diff: true
    max_depth: 1
    # tool_deny: []     # extra tools to hide
    # verify_command: "" # orchestrator-run check after the child reports done
  # to disable: set a phase to null, e.g.  code-review: null
`

type RawConfig = Partial<Omit<OddConfig, 'dispatch'>> & { dispatch?: Record<string, Partial<RoleConfig> | null> }

export function mergeConfig(user: RawConfig | null | undefined): OddConfig {
  const u = user ?? {}
  const dispatch: Record<string, RoleConfig> = {}
  const rawDispatch = { ...DEFAULT_CONFIG.dispatch, ...(u.dispatch ?? {}) } as Record<string, Partial<RoleConfig> | null>
  for (const [phase, role] of Object.entries(rawDispatch)) {
    if (role === null || role === undefined) continue
    dispatch[phase] = { ...ROLE_DEFAULTS, ...role } as RoleConfig
  }
  const cfg: OddConfig = {
    ...DEFAULT_CONFIG,
    ...u,
    limits: { ...DEFAULT_CONFIG.limits, ...(u.limits ?? {}) },
    workflows: { ...DEFAULT_CONFIG.workflows, ...(u.workflows ?? {}) },
    review_loopback: { ...DEFAULT_CONFIG.review_loopback, ...(u.review_loopback ?? {}) },
    dispatch,
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
  }
}

/** Tools to hide from the child of this role (before intersecting with registered tools). */
export function effectiveDeny(role: RoleConfig): string[] {
  return [...new Set([...(role.readonly ? READONLY_DENY : []), ...role.tool_deny])]
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
