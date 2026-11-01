import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderSurface } from 'claude-code'

import {
  readSectionPost,
  sectionCard,
  setFilter,
  toggleFold,
  withModsButton,
  withModsSection,
} from './shared/panel'
import type { SectionRow } from './shared/panel'

const transcriptPath = atom(
  { plugin: 'whereabouts', key: 'transcriptPath' } as const,
  null,
)

// Cached, so typing in the filter doesn't run git on every key.
let branch: { root: string; name: string | null; at: number } | undefined

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await $.command.register({
      name: 'transcript',
      description: 'Copy the path of the file this conversation is stored in',
    })
    // The classic events carry the path only from the next prompt, so a mod
    // loaded mid-session looks for the file.
    if ((await read($, transcriptPath)) === null) {
      const found = await locateTranscript($)
      if (found !== null) await update($, transcriptPath, known => known ?? found)
    }
    return result
  })

  on('command.run', { command: 'transcript' }, async $ => {
    await copyTranscriptPath($)
    return {}
  })

  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    if (e.surface !== 'desktop') return next(e)
    return withModsButton($, $.ui.resolve(e), await next(e))
  })

  on('ui.render', { component: 'Pane', requestId: 'claude-mods' }, async ($, e, next) => {
    if (e.surface !== 'desktop') return next(e)
    const el = $.ui.resolve(e)
    const { rows } = await whereabouts($)
    const heading = { plugin: 'whereabouts', icon: 'mapPin', title: 'Whereabouts' } as const
    return withModsSection(el, await next(e), sectionCard(el, heading, rows))
  })

  on('ui.message', { component: 'Pane' }, async ($, e, next) => {
    const post = readSectionPost(e.data)
    if (post === null) return next(e)
    if (post.kind === 'toggle') {
      toggleFold($)
      return {}
    }
    const { values, path } = await whereabouts($)
    if (post.id === 'open') {
      if (path !== null) await reveal($, path)
      return {}
    }
    const value = values.get(post.id)
    if (value !== undefined) await copyValue($, value.text, value.label, e.surface)
    return {}
  })

  on('ui.input', { element: 'claude-mods-filter' }, async ($, e, next) => {
    setFilter($, e.value)
    return next(e)
  })

  // A failure here must never block the session's own hooks.
  on('classic.SessionStart', async ($, e, next) => {
    const result = await next(e)
    await remember($, e.transcript_path, e.agent_id)
    return result
  }).catch(($, e, next) => next(e))

  on('classic.UserPromptSubmit', async ($, e, next) => {
    const result = await next(e)
    await remember($, e.transcript_path, e.agent_id)
    return result
  }).catch(($, e, next) => next(e))
}

async function whereabouts($: EngineInterface): Promise<{
  rows: SectionRow[]
  values: Map<string, { label: string; text: string }>
  path: string | null
}> {
  const [path, id, cwd, root, model, repo] = await Promise.all([
    read($, transcriptPath),
    $.session.id(),
    $.session.cwd(),
    $.session.root(),
    $.session.model(),
    $.session.repo(),
  ])
  const branchName = repo === null ? null : await branchOf($, repo.root)

  const parts: [string, SectionRow['icon'], string, string | null][] = [
    ['transcript', 'file', 'Transcript', path],
    ['folder', 'folder', 'Conversation folder', path === null ? null : parentOf(path)],
    ['session', 'info', 'Session ID', id],
    ['cwd', 'commandLine', 'Working directory', cwd],
    ['root', 'folder', 'Project root', root === cwd ? null : root],
    ['branch', 'gitBranch', 'Branch', branchName],
    ['remote', 'github', 'Remote', repo?.remote ?? null],
    ['model', 'atom', 'Model', model],
  ]
  const values = new Map<string, { label: string; text: string }>()
  const rows: SectionRow[] = []
  if (path === null) {
    rows.push({ id: 'unknown', icon: 'info', label: "The transcript's path comes with your next prompt.", isHint: true })
  }
  for (const [key, icon, label, text] of parts) {
    if (text === null) continue
    values.set(key, { label, text })
    rows.push({ id: key, icon, label, value: text, trailing: 'copy', flashesCheck: true })
  }
  if (path !== null) {
    rows.push({ id: 'open', icon: 'folderOpen', label: 'Open the conversation folder', trailing: 'folderOpen' })
  }
  return { rows, values, path }
}

async function branchOf($: EngineInterface, root: string): Promise<string | null> {
  const now = await $.clock.now()
  if (branch !== undefined && branch.root === root && now - branch.at < 5000) return branch.name
  const read = await $.process
    .run(['git', '-C', root, 'rev-parse', '--abbrev-ref', 'HEAD'], { timeoutMs: 5000 })
    .catch(() => null)
  const name = read?.exitCode === 0 ? read.stdout.trim() || null : null
  branch = { root, name, at: now }
  return name
}

// The row's icon shows a check, so only a failed copy gets a toast.
async function copyValue($: EngineInterface, value: string, what: string, surface: RenderSurface) {
  const copied = await $.ui.copy({ text: value, surface })
  if (!copied.isCopied) $.ui.toast(`${what} was not copied (${copied.reason})`)
}

async function copyTranscriptPath($: EngineInterface) {
  const path = await read($, transcriptPath)
  if (path === null) {
    $.ui.toast("The transcript's path is known from your next prompt")
    return
  }
  const copied = await $.ui.copy({ text: path })
  $.ui.toast(copied.isCopied ? 'Transcript path copied' : `Nothing was copied (${copied.reason})`)
}

async function reveal($: EngineInterface, path: string) {
  try {
    if ((await $.env.get('OS')) === 'Windows_NT') {
      // Passed in the environment, so no quoting can break the path.
      await $.process.run(
        [
          'powershell.exe',
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          "Start-Process explorer.exe -ArgumentList ('/select,' + [char]34 + $env:WHEREABOUTS_PATH + [char]34)",
        ],
        { env: { WHEREABOUTS_PATH: path }, timeoutMs: 10_000 },
      )
      return
    }
    const { stdout } = await $.process.run(['uname', '-s'])
    const opened =
      stdout.trim() === 'Darwin'
        ? await $.process.run(['open', '-R', path], { timeoutMs: 10_000 })
        : await $.process.run(['xdg-open', parentOf(path)], { timeoutMs: 10_000 })
    if (opened.exitCode !== 0) $.ui.toast(`Couldn't open the folder: ${opened.stderr.trim()}`)
  } catch (error) {
    $.ui.toast(`Couldn't open the folder: ${String(error)}`)
  }
}

async function remember(
  $: EngineInterface,
  path: string | undefined,
  agentId: string | undefined,
) {
  if (agentId !== undefined || !path) return
  await update($, transcriptPath, () => path)
}

// A transcript is <config>/projects/<folder>/<session id>.jsonl, the folder
// named after the directory the session started in. Try the folders named
// after this session's directories first, then every folder.
async function locateTranscript($: EngineInterface): Promise<string | null> {
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))
  const config =
    (await $.env.get('CLAUDE_CONFIG_DIR')) ??
    (home === undefined ? undefined : join(home, '.claude'))
  if (config === undefined) return null

  const projects = join(config, 'projects')
  const file = `${await $.session.id()}.jsonl`
  const likely = [await $.session.root(), await $.session.cwd()].map(dir =>
    dir.replace(/[^a-zA-Z0-9]/g, '-'),
  )
  const listed = await $.fs.list(projects).catch(() => [])
  const folders = [
    ...new Set([
      ...likely,
      ...listed.filter(entry => entry.kind === 'dir').map(entry => entry.name),
    ]),
  ]

  for (const folder of folders) {
    const candidate = join(projects, folder, file)
    if (await $.fs.exists(candidate)) return candidate
  }
  return null
}

function join(base: string, ...parts: string[]): string {
  const sep = base.includes('\\') ? '\\' : '/'
  return [base.replace(/[\\/]+$/, ''), ...parts].join(sep)
}

function parentOf(path: string): string {
  const cut = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'))
  return cut > 0 ? path.slice(0, cut) : path
}
