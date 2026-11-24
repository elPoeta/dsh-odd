# dsh-plugin-odd

Organic-Driven Development orchestrator for DeepSeek Harness.
**The markdown task file is the source of truth.** Agents are temporary executors.

## Status: phase 1 (no subagents yet)

The orchestrator runs in the main agent. It reads and writes `.odd/tasks/<name>.md`
through `odd_task_*` tools, guided by the `odd-orchestrator` skill.

| Phase | Scope | State |
|---|---|---|
| 1 | templates, config, md format, state machine, commands, tools | this scaffold |
| 2 | subagent dispatch for `/code-review` via `ctx.subagents` (spawn + outputSchema + toolFilter) | todo |
| 3 | skill registry (project > user > built-in) | todo |
| 4 | Engram adapter (`odd/<task>` keys; md wins on conflict) | todo |
| 5 | auto gates, git worktrees, parallelism | todo |

## Layout it creates (`/odd-init`)

```
.odd/
  config.yml        workflows, limits, skill paths
  templates/        feature.md hotfix.md refactor.md (editable per project)
  tasks/<name>.md   type lives in the frontmatter
  tasks/archive/
  skills/           project-specific skills (used from phase 3)
```

## Commands (human) and tools (model)

Commands: `/odd-init`, `/odd-status`, `/odd-resume <task>`.
Tools: `odd_task_create`, `odd_task_read`, `odd_task_advance`, `odd_task_answer`,
`odd_task_note`, `odd_task_archive`.

Circuit breakers (config.yml): `max_review_loops` (pair <-> code-review) and
`max_step_retries`. When exceeded the task becomes `blocked`.

## Before you run it in a real harness (IMPORTANT)

The core (`src/core/*`) has no harness dependency and is fully tested.
`src/host/adapter.ts` is the only file that touches the harness API and contains
`TODO(verify)` markers: exact field names of `ctx.commands.register` /
`ctx.tools.register` definitions, the tool schema format, and the disposer shape.
DSH is a developer preview; read the installed `.d.ts` first:

```sh
node -p "require.resolve('@deepseek-ai/dsh/package.json')"   # then lib/types/**/*.d.ts
dsh --version                                                 # pin this version
dsh web --dump-config
```

## Develop

```sh
pnpm install && pnpm test && pnpm build
dsh plugin --profile web add /path/to/dsh-odd
```

Then copy `skills/odd-orchestrator` to `$DSH_HOME/skills/` (or `~/.agents/skills/`) until
the plugin registers it through `ctx.skills` (planned for phase 3).
