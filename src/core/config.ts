import { parse } from 'yaml'
import type { TaskType } from './task'

export interface OddConfig {
  version: number
  /** manual = ask the human between phases; auto = only for low-risk phases. */
  mode: 'manual' | 'auto'
  limits: { max_review_loops: number; max_step_retries: number }
  /** Ordered phases per task type. Each phase maps to a skill name. */
  workflows: Record<TaskType, string[]>
  /** Phase to return to when code-review requests changes. */
  review_loopback: Record<TaskType, string>
  /** Skill search paths, highest precedence first (used from phase 3). */
  skills_paths: string[]
}

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
  skills_paths: ['.odd/skills', '~/.agents/skills'],
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
skills_paths:           # precedence: first match wins (project > user > built-in)
  - .odd/skills
  - ~/.agents/skills
`

export function mergeConfig(user: Partial<OddConfig> | null | undefined): OddConfig {
  const u = user ?? {}
  const cfg: OddConfig = {
    ...DEFAULT_CONFIG,
    ...u,
    limits: { ...DEFAULT_CONFIG.limits, ...(u.limits ?? {}) },
    workflows: { ...DEFAULT_CONFIG.workflows, ...(u.workflows ?? {}) },
    review_loopback: { ...DEFAULT_CONFIG.review_loopback, ...(u.review_loopback ?? {}) },
  }
  validateConfig(cfg)
  return cfg
}

export function parseConfig(yamlText: string): OddConfig {
  return mergeConfig(parse(yamlText) as Partial<OddConfig> | null)
}

export function validateConfig(cfg: OddConfig): void {
  for (const [type, phases] of Object.entries(cfg.workflows)) {
    if (!Array.isArray(phases) || phases.length === 0) throw new Error(`Workflow "${type}" must list at least one phase`)
    const lb = cfg.review_loopback[type as TaskType]
    if (lb && !phases.includes(lb)) throw new Error(`review_loopback "${lb}" is not a phase of workflow "${type}"`)
  }
  if (cfg.limits.max_review_loops < 1 || cfg.limits.max_step_retries < 0) throw new Error('Invalid limits')
  if (cfg.mode !== 'manual' && cfg.mode !== 'auto') throw new Error(`Invalid mode: ${String(cfg.mode)}`)
}
