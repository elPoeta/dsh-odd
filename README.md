# dsh-plugin-odd

Organic-Driven Development orchestrator for DeepSeek Harness.
**The markdown task file is the source of truth.** Agents are temporary executors.

## Status: phase 2 (code-review runs in a clean-context subagent)

The orchestrator runs in the main agent. It reads and writes `.odd/tasks/<name>.md`
through `odd_task_*` tools, guided by the `odd-orchestrator` skill. Phases listed under
`dispatch:` in `.odd/config.yml` (default: `code-review`) run through `odd_dispatch`.

| Phase | Scope | State |
|---|---|---|
| 1 | templates, config, md format, state machine, commands, tools | done |
| 2 | subagent dispatch for `code-review` via `ctx.subagents` (spawn + outputSchema + toolFilter) | this version |
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

## How dispatch works (phase 2)

1. `odd_dispatch <task>` reads the md and builds a **handoff packet**: Goal, Decisions, Evidence,
   the diff (`diff_command`, run by the orchestrator), the skill text and the output contract.
   It deliberately excludes Log, Handoffs and Open questions.
2. It starts a child with `ctx.subagents.start("spawn", ...)` (fresh session, no parent history),
   `outputSchema` = the report contract, `maxDepth: 1`, and a `toolFilter` hiding write/edit/shell,
   delegation and every `odd_*` tool. The run is always disposed.
3. The report is validated strictly. Any failure (non-`completed` stop reason, invalid or missing
   structured output, start rejection such as `UNSUPPORTED_CAPABILITY`, missing verdict) counts as a
   **failed attempt**: it is logged and retried up to `max_step_retries`, never silently advanced.
4. Optional `verify_command` is run by the orchestrator, not the child; a failure overrides a "done".
5. Results land in the md (Handoffs, Decisions, Evidence/findings, Log) and the state machine advances.
   `changes_requested` returns to `pair`/`fix`/`refactor` and counts toward `max_review_loops`.

Skills are resolved first-match along `skills_paths` (project `.odd/skills` > `~/.agents/skills`),
and their full text is embedded in the packet. Phase 3 turns this into a validated registry.

### Limits you should know

- A tool filter hides tools from the child; the harness docs describe this as **visibility, not
  authority**. Treat read-only as strong guidance plus loud failure when the provider lacks
  `toolFilter`, not as a sandbox. Real isolation comes with worktrees (phase 5).
- Tool names in the filter are intersected with registered tools (the host rejects unknown names).
- `odd_dispatch` blocks the parent turn while the child runs (foreground collection).
- Existing projects get the `code-review` dispatch default after upgrading, because the config is
  merged over defaults. Set `code-review: null` under `dispatch:` to keep it inline.

## Before you run it in a real harness (IMPORTANT)

The core (`src/core/*`) has no harness dependency and is fully tested.
`src/host/adapter.ts` is the only file that touches the harness API and contains
`TODO(verify)` markers (also in `subagent-client.ts`): exact field names of `ctx.commands.register` /
`ctx.tools.register` definitions, the tool schema format, the disposer shape, how a tool handler
receives its calling Agent, the `ContentBlock` text shape, the `ToolRestriction` shape, and how to
list registered tools. The `ctx.subagents.start` request/result contract itself is taken from the
harness's `docs/subsystems/subagent.md` (compat target seen: `@deepseek-ai/dsh-subagent@0.1.0-rc.7`).
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
