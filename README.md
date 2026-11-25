# dsh-plugin-odd

Organic-Driven Development orchestrator for DeepSeek Harness.
**The markdown task file is the source of truth.** Agents are temporary executors.

## Status: phase 4 (Engram memory) + project-scoped autonomy, targeting dsh 0.2.2-rc.5

The orchestrator runs in the main agent. It reads and writes `.odd/tasks/<name>.md`
through `odd_task_*` tools, guided by the `odd-orchestrator` skill. Phases listed under
`dispatch:` in `.odd/config.yml` (default: `code-review`) run through `odd_dispatch`.

| Phase | Scope | State |
|---|---|---|
| 1 | templates, config, md format, state machine, commands, tools | done |
| 2 | subagent dispatch for `code-review` via `ctx.subagents` (spawn + outputSchema + toolFilter) | done |
| 3 | skill registry (ODD project > project > user > built-in), validation, duplicate detection | this version |
| 4 | Engram memory: recall before a task, capture when it closes; md wins on conflict | this version |
| 5 | auto gates, git worktrees, parallelism | todo |

## Where state lives, and how the orchestrator sets itself up

- **Per project, resolved per call.** The project is the nearest `.git` ancestor of the *session's* working
  directory (`agent.session.header.cwd`, the same rule DSH uses for project roots), else the session cwd.
  The plugin never uses the directory dsh was launched from. Two sessions in two projects keep separate state.
- **It refuses to use your home folder or `/`** and tells you to start dsh inside a project. (An explicit
  `cwd` in the plugin config row overrides this and is trusted.)
- **No manual setup.** `odd_task_create` initializes `.odd/` by itself and says so; `odd_init` does it explicitly;
  `/odd-init` still exists for humans. `odd_task_list`, `odd_skill_list` and `odd_skill_load` work before
  initialization and never create anything.
- **Sessions act as the orchestrator without commands.** Initialization adds a small managed block to the
  project's `AGENTS.md` (DSH injects it into every session under that project). It tells the agent: list tasks,
  resume or create one, load the `odd-orchestrator` skill. Only the block between `<!-- odd:begin ... -->` and
  `<!-- odd:end -->` is ever touched; the rest of your file is preserved byte for byte. Opt out with
  `bootstrap.agents_md: false` in `.odd/config.yml` or delete the block.
- `.odd/` is meant to be committed (the task files are the trace). `.odd/.gitignore` excludes lock/temp files.

### Why not an agent preset (yet)

A preset would give a dedicated "ODD mode" session (own prompt, tool allowlist, model). Presets are per-session
Cordis compositions, and their mechanism changed across DSH releases (directory-based, then registry-based), with
user reports of custom presets silently not registering or mounting only partially. Services with consumers outside
the agent plane (the subagent registry, MCP) cannot live inside a preset, so ODD would split into a host half and a
preset half. The AGENTS.md block gives most of the benefit with a verified mechanism. A preset is a good later
step once the smoke test passes: it needs the preset directory/format of your installed version.

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

Commands: `/odd-init`, `/odd-status`, `/odd-resume <task>`, `/odd-skills [check]`, `/odd-memory`.
Tools: `odd_task_create`, `odd_task_read`, `odd_task_advance`, `odd_task_answer`,
`odd_task_note`, `odd_task_archive`, `odd_dispatch`, `odd_skill_list`, `odd_skill_load`,
`odd_memory_recall`, `odd_memory_capture`, `odd_init`, `odd_task_list`.

`/odd-resume <task>` now steers the agent into resuming (read `odd-orchestrator`, then the task file).

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
- ODD tools are intentionally not concurrency-safe (`isConcurrencySafe` omitted), so the harness runs them one at a time.
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

## Engram memory (phase 4)

**The md is the source of truth; Engram is derived memory.** If they disagree the task file wins, and the
agent is told never to edit the task file from memory alone. Opt-in: `memory.enabled: true` in `.odd/config.yml`.

### Mount Engram (one row, stdio only)

Engram's MCP transport is stdio. Add `examples/engram.patch.yml` to your profile `cordis.patch.yml`
(`/odd-memory` prints it too). It must sit inside `insert:`; a bare top-level row is an override of a row that
doesn't exist, so dsh prints `patch: entry "mcp-engram" not found` and boots with no tools. Tools appear as
`mcp__engram__mem_save`, `mcp__engram__mem_search`, ... and `memory.server_name` must equal the row's `serverName`.
`--tools=agent` exposes only the 11 tools agents need, which keeps the tool schema small in every request.

### Flow

| When | Tool | What it does |
|---|---|---|
| after creating a task | `odd_memory_recall` | returns the exact `mem_context` / `mem_search` calls (keywords from title + goal; `decision` type for features, `bugfix` for hotfixes) and the md-wins rule |
| while working | `odd_task_note` | durable knowledge goes into the task file: `Decisions`, `Lessons`, and `Root cause` (hotfix) |
| task is `done` or `blocked` | `odd_memory_capture` | returns the exact `mem_save` calls, and traces the prepared keys in a `## Memory` section |

The agent performs the Engram calls (ODD cannot confirm a save succeeded, so the md says "prepared").

### What is saved, and what never is

Topic keys follow Engram's convention (`family/description`, kebab-case, max 2 levels) and are deterministic,
so re-running capture updates observations in place instead of duplicating them:

| Source | topic_key | type |
|---|---|---|
| task digest | `odd/<task>` | `architecture` (`bugfix` for hotfixes) |
| each bullet in `## Decisions` | `decision/<task>-<slug>-<hash6>` | `decision` |
| `## Root cause` | `bug/<task>-root-cause` | `bugfix` |
| each bullet in `## Lessons` | `learning/<task>-<slug>-<hash6>` | `discovery` |

- **Never saved:** Log, Handoffs, Evidence, Open questions, Next step. History stays in the md, not in memory.
- All saves use `capture_prompt: false` (Engram's recommendation for automated saves), scope `project` by default,
  and `project` only if you set it (otherwise Engram detects it from the cwd).
- **Secrets are redacted** (API keys, tokens, JWTs, private keys, `password=`/`token:` values) before anything is
  derived, including the topic key. It is conservative pattern matching, not a DLP system: don't put secrets in
  the task file. Items are capped at `memory.max_item_chars` and 25 per task.
- Rewording a decision creates a new key (the old observation stays); a whitespace or case edit does not.
- **Subagents get no Engram tools by default.** The reviewer's clean context is the point, and a "read-only"
  child must not be able to `mem_save`. Set `memory: read` on a role to let it search; writers stay hidden.
- New templates ship `## Lessons` (and `## Root cause` for hotfixes). Existing `.odd/templates/*.md` are not
  overwritten; `odd_task_note` creates the sections on demand.

## Harness compatibility (target: dsh 0.2.2-rc.5)

DSH is a developer preview and its API moves between rc releases. Pin it: `@deepseek-ai/dsh` is declared
as an optional peer at exactly `0.2.2-rc.5`, and nothing in this plugin imports harness packages at runtime
(the core is plain Node; `src/host/*` talks to `ctx` through duck-typed calls).

**Verified against the harness docs (master) and third-party plugins that state they ran on 0.2.1-rc.2.**
Not yet executed on 0.2.2-rc.5 itself; do the smoke test below once.

| Surface | Shape used | Where |
|---|---|---|
| `ctx.commands.register` | `{ name, description, input?: { hint }, handler(inv) }`, `inv = { commandId, agent, rawInput, signal }`, result `{ kind: 'success' \| 'error', text }` | `adapter.ts` |
| `ctx.tools.register` | raw `ToolDefinition`: `name`, `description`, JSON-Schema `parameters`, mandatory `output: { schema, render }`, `execute(args, exec)` returning a string; own argument validation | `adapter.ts`, `api.ts` |
| `exec` in a tool | `exec.agent` (calling Agent) and `exec.signal` | `odd_dispatch` |
| `ctx.effect(fn, label)` | wraps every registration so it unloads with the plugin | `api.ts` |
| `ctx.subagents.start(name, req)` | `prompt` as `{type:'text',text}` blocks, `parent`, `signal`, `outputSchema` (object root), `maxDepth`, `toolFilter` as `ToolRestriction { allow?, deny? }`; `run.result`, `run.dispose()` | `subagent-client.ts` |
| `ctx.tools.schemas()` | global tool names, used to intersect the deny list (`restrict` rejects unknown names and empty filters) | `subagent-client.ts` |

| Engram tools | `mcp__<serverName>__<tool>` via `@deepseek-ai/dsh-mcp-client` rows | `memory-tools.ts` |

**Still an assumption:** the Engram parameter names (`title`, `content`, `type`, `scope`, `topic_key`, `project`,
`capture_prompt` for `mem_save`; `query`, `type`, `project`, `limit` for `mem_search`) come from Engram's docs, not
from a live server. The agent sees the real tool schema, so a rename would surface as a tool error, not a silent
failure. Also: `agent.steer([{ type: 'text', text }])` in `/odd-resume`. dsh-plan-mode documents using
`agent.steer()` with one user text block, but I did not see its signature. If it fails, `/odd-resume` falls back
to printing the instruction for you to send, so nothing breaks.

### Smoke test (5 minutes, on 0.2.2-rc.5)

1. `dsh --version` shows `0.2.2-rc.5`. Install: `dsh plugin --profile web add /path/to/dsh-odd`, then start `dsh web`.
2. `/odd-init`, then `/odd-skills check`. Expect the plugin-bundled `odd-orchestrator` listed as `builtin`.
3. Ask the agent to create a hotfix task with `odd_task_create`; confirm `.odd/tasks/<name>.md` appears and the
   tool result renders as text (this exercises `output.render`).
4. `/odd-resume <name>`. Expect the agent to start by loading `odd-orchestrator`. If it prints "Tell the agent",
   `steer()` has a different signature: fix `steerAgent()` in `src/host/api.ts` (one function).
5. (Engram) Mount the row from `examples/engram.patch.yml`, set `memory.enabled: true`, run `/odd-memory`:
   it should say all required tools are registered (MCP tools connect asynchronously: retry after a moment).
   Create a task: the result should end with the `odd_memory_recall` hint. Close a hotfix with a Root cause and a
   Lesson, call `odd_memory_capture`, and have the agent run the `mcp__engram__mem_save` calls. Run capture
   twice: Engram should show `revision_count` going up, not duplicate rows.
6. With a valid `code-review` skill in `.odd/skills/`, advance the task to code-review and ask the agent to call
   `odd_dispatch`. Expect a Handoffs entry in the md. A failure here with `UNSUPPORTED_CAPABILITY` or an unknown
   tool name in the filter is recorded in the Log as a failed attempt (fail closed), not swallowed.

If the web profile does not expose `commands`/`tools` the plugin will not load (`inject`); `subagents` is only
needed at `odd_dispatch` time and gives a clear error if missing.

## Develop

```sh
pnpm install && pnpm test && pnpm build
dsh plugin --profile web add /path/to/dsh-odd
```

Then copy `skills/odd-orchestrator` to `$DSH_HOME/skills/` (or `~/.agents/skills/`) until
the plugin registers it through `ctx.skills` (planned for phase 3).
