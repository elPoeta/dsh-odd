import { homedir } from 'node:os'
import { parse, resolve } from 'node:path'
import { findProjectRoot } from './registry'

export class ProjectError extends Error {}

/**
 * Where the ODD state lives for ONE call: the project root of the calling session.
 * The session's cwd comes from the agent (agent.session.header.cwd), never from
 * process.cwd() at plugin load time (that is where dsh was launched, often $HOME).
 * Project root = nearest .git ancestor (same rule DSH uses), else the session cwd.
 * An explicit `override` (plugin config `cwd`) wins and is trusted.
 */
export async function resolveProject(
  hint: string | undefined,
  opts: { override?: string; home?: string } = {},
): Promise<string> {
  if (opts.override) return resolve(opts.override)
  const start = resolve(hint || process.cwd())
  const root = await findProjectRoot(start)
  const home = resolve(opts.home ?? homedir())
  if (root === home || root === parse(root).root) {
    throw new ProjectError(
      `ODD keeps its state inside the project, but this session's working directory is ` +
      `${root === home ? 'your home folder' : 'the filesystem root'} (${start}). ` +
      `Start dsh inside the project (ideally a git repository), or set "cwd" in the dsh-odd plugin config.`,
    )
  }
  return root
}
