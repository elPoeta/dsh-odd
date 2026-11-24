# dsh-plugin-odd

Organic-Driven Development orchestrator for DeepSeek Harness.
**The markdown task file is the source of truth.** Agents are temporary executors.

## Status: phase 3 (skill registry with precedence and validation)

The orchestrator runs in the main agent. It reads and writes `.odd/tasks/<name>.md`
through `odd_task_*` tools, guided by the `odd-orchestrator` skill. Phases listed under
`dispatch:` in `.odd/config.yml` (default: `code-review`) run through `odd_dispatch`.

| Phase | Scope | State |
|---|---|---|
| 1 | templates, config, md format, state machine, commands, tools | done |
| 2 | subagent dispatch for `code-review` via `ctx.subagents` (spawn + outputSchema + toolFilter) | done |
| 3 | skill registry (ODD project > project > user > built-in), validation, duplicate detection | this version |
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

Commands: `/odd-init`, `/odd-status`, `/odd-resume <task>`, `/odd-skills [check]`.
Tools: `odd_task_create`, `odd_task_read`, `odd_task_advance`, `odd_task_answer`,
`odd_task_note`, `odd_task_archive`, `odd_dispatch`, `odd_skill_list`, `odd_skill_load`.

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


### Limits you should know

- A tool filter hides tools from the child; the harness docs describe this as **visibility, not
  authority**. Treat read-only as strong guidance plus loud failure when the provider lacks
  `toolFilter`, not as a sandbox. Real isolation comes with worktrees (phase 5).
- Tool names in the filter are intersected with registered tools (the host rejects unknown names).
- `odd_dispatch` blocks the parent turn while the child runs (foreground collection).
- Existing projects get the `code-review` dispatch default after upgrading, because the config is
  merged over defaults. Set `code-review: null` under `dispatch:` to keep it inline.

## Skill registry (phase 3)

The registry follows DSH's own discovery contract (`dsh-skill-filesystem`), so ODD and the harness agree
on what a skill is: single-level `<name>/SKILL.md` bundles or flat `<name>.md` files, kebab-case names,
`name` + `description` frontmatter, no nested discovery.

Default precedence, first match wins (`skills_paths` in `config.yml`):

| # | Root | Visible to DSH's native skill tool? |
|---|---|---|
| 1 | `.odd/skills` (ODD-only project skills) | no, only through `odd_skill_load` |
| 2 | `{project}/.dsh/skills` | yes |
| 3 | `{project}/.agents/skills` | yes |
| 4 | `{dsh_home}/skills` (`$DSH_HOME`, default `~/.dsh`) | yes |
| 5 | `{agents_home}/skills` (`$DSH_AGENTS_HOME`, default `~/.agents`) | yes |
| 6 | plugin-bundled skills (`builtin`, always last) | no |

`{project}` is the nearest `.git` ancestor (cwd if none), like DSH. `~` and plain relative paths still work.

- **Progressive disclosure:** the index keeps name + description; the body is read from disk only when
  loaded (`odd_skill_load`, or embedded in a dispatch packet). Edits take effect on the next load.
- **Validation** (`/odd-skills check`): errors for missing frontmatter, unparseable YAML, invalid name,
  missing description, and same-name bundle+flat in one root; warnings for missing name, name that
  differs from the directory, very long description, and **shadowed duplicates** (project vs global).
  It also checks that every workflow phase has a valid skill: missing = **error** for dispatched
  phases, warning for inline ones.
- **Fail closed:** if the highest-precedence skill for a phase is invalid, resolution fails with the
  reasons. It never silently falls back to a lower-precedence skill.
- **Why `odd_skill_load` for inline phases:** it applies ODD precedence and can see `.odd/skills`, which
  DSH's native skill tool cannot. The `odd_task_read` header names the skill that will be used.
- To also expose `.odd/skills` to DSH's native tool, add it to `customSkillDirs` of your
  `dsh-skill-filesystem` row (the patch replaces the whole row config; confirm the row id with
  `dsh web --dump-config`). Not required for ODD.
- Heads-up from third-party docs: DSH's web profile may ship with the skill components disabled; ODD does
  not depend on them, but the native skill tool does.
- Configs created by phase 1/2 keep their old `skills_paths` (two entries) and keep working. To adopt
  the new defaults, replace that list with the table above.

## Before you run it in a real harness (IMPORTANT)

The core (`src/core/*`) has no harness dependency and is fully tested.
`src/host/adapter.ts` is the only file that touches the harness API and contains
`TODO(verify)` markers (also in `subagent-client.ts`). Phase 3 added no new harness API assumptions: the registry is plain filesystem code.
Open items: exact field names of `ctx.commands.register` /
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
