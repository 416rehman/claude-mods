import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderSurface } from 'claude-code'

import type { CopyKitPick } from '../types'
import { splitSections } from './sections'
import type { Section, SectionKind } from './sections'

const transcriptPath = atom(
  { plugin: 'copy-kit', key: 'transcriptPath' } as const,
  null,
)
// Change the tag when a pick's fields change: it declines what an earlier
// version stored, which outlives a reload.
const picks = atom({ plugin: 'copy-kit', key: 'picks' } as const, [], {
  shape: 'picks-2',
})

/** Each reply block's sections as last drawn, so a click on a copy mark knows its section. */
const drawn = new Map<string, Section[]>()

/** Set once a surface refused the copy icon this load; the copy marks then draw a glyph. */
let isIconRefused = false

/**
 * The checked box, with the text-style variation selector: Windows otherwise
 * draws U+2611 as a colour emoji tile beside the grey copy mark.
 */
const CHECKED_BOX = '☑\u{FE0E}'

/**
 * Surfaces with a pointer to hover a section with. The terminal keeps its own
 * drawing: its reply bullet and indent are the engine's, and only its
 * fullscreen layout reports the pointer at all.
 */
const HOVER_SURFACES: ReadonlySet<string> = new Set(['desktop', 'vscode'])

/** Cells kept free at each section's right for its copy mark and checkbox. */
const GUTTER = 8

const COPIED: Record<SectionKind, string> = {
  quote: 'Quote copied',
  code: 'Code copied',
  heading: 'Heading copied',
  rule: 'Copied',
  text: 'Copied',
}

/**
 * Translucent tints. The desktop paints a text selection as bands in a layer
 * beneath the transcript, so an opaque background over a section hides the
 * person's selection there; these let it show through. A neutral grey at low
 * alpha shades a light theme and lifts a dark one alike. Other surfaces are
 * not known to take an alpha colour, so they draw no tint.
 */
const HOVERED = 'rgba(128, 128, 128, 0.08)'
const PICKED = 'rgba(128, 128, 128, 0.16)'

export const register: Register = on => {
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (!HOVER_SURFACES.has(e.surface) || e.props.isSummary) return next(e)

    const sections = splitSections(e.props.text)
    if (sections.length === 0) return next(e)

    const table = $.ui.resolve(e)
    const { Box, Button, Markdown } = table
    // A Button draws text alone; a Client region draws the app's own copy icon.
    // Only the desktop's table holds Client (another surface's runtime table may
    // carry the key and still refuse it), so elsewhere the mark is a Button.
    const Client = e.surface === 'desktop' && 'Client' in table ? table.Client : undefined
    const isTinted = e.surface === 'desktop'
    const message = e.requestId
    drawn.set(message, sections)
    const picked = new Set(
      (await read($, picks)).filter(pick => pick.message === message).map(pick => pick.index),
    )

    return (
      <Box flexDirection="column" gap="sm">
        {sections.map((section, index) => {
          const isPicked = picked.has(index)
          const canPick = section.plain !== null
          const onPress = () => toggle($, message, index, section)
          // The section under the pointer lifts a shade; a checked one keeps a tint.
          const tint = !isTinted
            ? {}
            : isPicked
              ? { backgroundColor: PICKED }
              : canPick
                ? { hover: { backgroundColor: HOVERED } }
                : {}
          return (
            <Box key={`section-${index}`} flexDirection="row" paddingX={1} {...tint}>
              <Box flexGrow={1} flexShrink={1} minWidth={0}>
                <Markdown text={section.markdown} />
              </Box>
              {/* Copy takes this section alone, now; the box checks it for the bar
                  above the prompt. The two share one row; a checked box stays in
                  view and its copy mark still waits for the pointer. */}
              <Box width={GUTTER} flexShrink={0} flexDirection="row" justifyContent="flex-end">
                {canPick && (
                  <Box
                    flexDirection="row"
                    alignItems="center"
                    columnGap={1}
                    flexShrink={0}
                    {...(isPicked ? {} : { display: 'none', hover: { display: 'flex' } })}
                  >
                    <Box
                      flexShrink={0}
                      {...(isPicked ? { display: 'none', hover: { display: 'flex' } } : {})}
                    >
                      {Client !== undefined ? (
                        <Client
                          key={`copy-${index}`}
                          module="./copy-icon.tsx"
                          props={{ index, isGlyph: isIconRefused }}
                          width={2}
                          height={1}
                        />
                      ) : (
                        <Button
                          key={`copy-${index}`}
                          label="⧉"
                          plain
                          dimColor
                          onPress={press =>
                            copy($, section.plain!, press.surface, COPIED[section.kind])
                          }
                        />
                      )}
                    </Box>
                    <Button
                      key={`pick-${index}`}
                      label={isPicked ? CHECKED_BOX : '☐'}
                      plain
                      dimColor={!isPicked}
                      onPress={onPress}
                    />
                  </Box>
                )}
              </Box>
            </Box>
          )
        })}
      </Box>
    )
  })

  // A click on a section's copy mark. The mark shows the check itself, so only
  // a copy that failed is worth a word.
  on('ui.message', { component: 'AssistantMessage' }, async ($, e, next) => {
    const index = copiedIndex(e.data)
    if (index === null) return next(e)

    const plain = drawn.get(e.requestId)?.[index]?.plain
    if (plain === null || plain === undefined) return {}
    const copied = await $.ui.copy({ text: plain, surface: e.surface })
    if (!copied.isCopied) $.ui.toast(`Nothing was copied (${copied.reason})`)
    return {}
  })

  // A surface that cannot draw the copy icon in a region says so here; the
  // engine then draws the site again, and its marks draw the glyph instead.
  on('ui.fault', ($, e, next) => {
    if (e.module.endsWith('copy-icon.tsx') && !isIconRefused) {
      isIconRefused = true
      $.ui.log(`copy-kit: the copy icon was refused (${e.reason}); copy marks show a glyph`, {
        to: 'debug',
      })
    }
    return next(e)
  })

  // Shown only while something is checked: what is checked, and what to do with
  // it, under whatever other plugins draw in the band.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const checked = await read($, picks)
    if (checked.length === 0 || e.props.hasSurvey) return next(e)

    const theirs = await next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const count = checked.length

    return (
      <Box flexDirection="column">
        {theirs}
        <Box flexDirection="row" alignItems="center" gap={1}>
          <Text>
            {count} {count === 1 ? 'section' : 'sections'} selected
          </Text>
          <Box flexGrow={1} />
          <Button
            key="copy-selected"
            label="Copy"
            variant="primary"
            onPress={press => copyPicks($, press.surface)}
          />
          <Button
            key="clear-selected"
            label="Clear"
            plain
            dimColor
            onPress={() => update($, picks, () => [])}
          />
        </Box>
      </Box>
    )
  })

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await $.command.register({
      name: 'transcript',
      description: 'Copy the path of the file this conversation is stored in',
    })
    // The classic events carry the path from the next prompt on; a mod loaded
    // into a running session finds the file the session already writes.
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

  // A quiet entry after the footer's own line: one press copies the path.
  // Other plugins draw this site too (a launcher, the mode labels), so what
  // they drew comes first and whole; the desktop keeps the site to one line
  // and cuts its end with an ellipsis, so this entry stays one short word.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    if (e.surface !== 'desktop') return next(e)

    const theirs = await next(e)
    const { Box, Button } = $.ui.resolve(e)

    return (
      <Box flexDirection="row" alignItems="center" columnGap={1}>
        {theirs}
        <Box flexShrink={0}>
          <Button
            key="copy-transcript"
            label="Transcript"
            plain
            dimColor
            onPress={press => copyTranscriptPath($, press.surface)}
          />
        </Box>
      </Box>
    )
  })

  // Remembering the path never holds up or refuses the session's own hooks.
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

async function toggle($: EngineInterface, message: string, index: number, section: Section) {
  const { plain } = section
  if (plain === null) return

  await update($, picks, list => {
    if (list.some(one => one.message === message && one.index === index)) {
      return list.filter(one => one.message !== message || one.index !== index)
    }
    const known = list.find(one => one.message === message)
    const messageOrder =
      known?.messageOrder ?? Math.max(0, ...list.map(one => one.messageOrder)) + 1
    const { kind, markdown } = section
    return [...list, { message, index, messageOrder, kind, markdown, plain }]
  })
}

function copiedIndex(data: unknown): number | null {
  if (typeof data !== 'object' || data === null || !('copy' in data)) return null
  return typeof data.copy === 'number' ? data.copy : null
}

async function copyTranscriptPath($: EngineInterface, surface?: RenderSurface) {
  const path = await read($, transcriptPath)
  if (path === null) {
    $.ui.toast("The transcript's path is known from your next prompt")
    return
  }
  await copy($, path, surface, 'Transcript path copied')
}

/**
 * The checked sections in the order the replies show them, a blank line apart.
 * Sections all of one kind copy without their markers; a mix keeps every
 * section's markdown, so a code block stays a code block beside the text.
 */
function joinPicks(list: readonly CopyKitPick[]): string {
  const isOneKind = new Set(list.map(one => one.kind)).size === 1
  return [...list]
    .sort((a, b) => a.messageOrder - b.messageOrder || a.index - b.index)
    .map(one => (isOneKind ? one.plain : one.markdown))
    .join('\n\n')
}

async function copyPicks($: EngineInterface, surface: RenderSurface) {
  const list = await read($, picks)
  if (list.length === 0) return

  const copied = await $.ui.copy({ text: joinPicks(list), surface })
  if (!copied.isCopied) {
    $.ui.toast(`Nothing was copied (${copied.reason})`)
    return
  }
  $.ui.toast(list.length === 1 ? 'Copied 1 section' : `Copied ${list.length} sections`)
  await update($, picks, () => [])
}

async function copy(
  $: EngineInterface,
  text: string,
  surface: RenderSurface | undefined,
  done: string,
) {
  const copied = await $.ui.copy({ text, surface })
  $.ui.toast(copied.isCopied ? done : `Nothing was copied (${copied.reason})`)
}

async function remember(
  $: EngineInterface,
  path: string | undefined,
  agentId: string | undefined,
) {
  if (agentId !== undefined || !path) return
  await update($, transcriptPath, () => path)
}

/**
 * The transcript is `<config>/projects/<project folder>/<session id>.jsonl`.
 * The project folder's name is derived from the directory the session started
 * in, so look in the folders named after this session's directories first,
 * then in every project folder.
 */
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

function separatorOf(path: string): string {
  return path.includes('\\') ? '\\' : '/'
}

function join(base: string, ...parts: string[]): string {
  const sep = separatorOf(base)
  return [base.replace(/[\\/]+$/, ''), ...parts].join(sep)
}
