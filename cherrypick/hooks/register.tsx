import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderSurface } from 'claude-code'

import type { CherrypickPick } from '../types'
import { splitSections } from './sections'
import type { Section, SectionKind } from './sections'
import {
  readSectionPost,
  sectionCard,
  setFilter,
  toggleFold,
  withModsButton,
  withModsSection,
} from './shared/panel'
import type { SectionRow } from './shared/panel'

// Bump when a pick's fields change, so values an earlier version stored are dropped.
const picks = atom({ plugin: 'cherrypick', key: 'picks' } as const, [], {
  shape: 'picks-2',
})

const drawnSections = new Map<string, Section[]>()

let isIconRefused = false

// U+FE0E asks for text style: Windows draws a bare ☑ as a colour emoji.
const CHECKED_BOX = '☑\u{FE0E}'

// Not the terminal: it reports the pointer only in fullscreen, and its reply
// bullet and indent are the engine's.
const HOVER_SURFACES: ReadonlySet<string> = new Set(['desktop', 'vscode'])

const GUTTER = 8

const COPIED: Record<SectionKind, string> = {
  quote: 'Quote copied',
  code: 'Code copied',
  heading: 'Heading copied',
  rule: 'Copied',
  text: 'Copied',
}

// Translucent, because the desktop draws a text selection beneath the
// background. Other surfaces may not take an alpha colour, so only the desktop
// is tinted.
const HOVERED = 'rgba(128, 128, 128, 0.08)'
const PICKED = 'rgba(128, 128, 128, 0.16)'

export const register: Register = on => {
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (!HOVER_SURFACES.has(e.surface) || e.props.isSummary) return next(e)

    const sections = splitSections(e.props.text)
    if (sections.length === 0) return next(e)

    const table = $.ui.resolve(e)
    const { Box, Button, Markdown } = table
    // Other surfaces' tables can list Client and still refuse it, so only the
    // desktop draws the copy icon; elsewhere it is a ⧉ Button.
    const Client = e.surface === 'desktop' && 'Client' in table ? table.Client : undefined
    const isTinted = e.surface === 'desktop'
    const message = e.requestId
    drawnSections.set(message, sections)
    const picked = new Set(
      (await read($, picks)).filter(pick => pick.message === message).map(pick => pick.index),
    )

    return (
      <Box flexDirection="column" gap="sm">
        {sections.map((section, index) => {
          const isPicked = picked.has(index)
          const canPick = section.plain !== null
          const onPress = () => toggle($, message, index, section)
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
              {/* Both show on hover; a checked box stays shown, its copy icon still on hover. */}
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

  // The copy icon shows its own check, so only a failed copy gets a toast.
  on('ui.message', { component: 'AssistantMessage' }, async ($, e, next) => {
    const index = copiedIndex(e.data)
    if (index === null) return next(e)

    const plain = drawnSections.get(e.requestId)?.[index]?.plain
    if (plain === null || plain === undefined) return {}
    const copied = await $.ui.copy({ text: plain, surface: e.surface })
    if (!copied.isCopied) $.ui.toast(`Nothing was copied (${copied.reason})`)
    return {}
  })

  // A surface that can't draw the copy icon reports it here; the redraw uses the glyph.
  on('ui.fault', ($, e, next) => {
    if (e.module.endsWith('copy-icon.tsx') && !isIconRefused) {
      isIconRefused = true
      $.ui.log(`cherrypick: the copy icon was refused (${e.reason}); copy marks show a glyph`, {
        to: 'debug',
      })
    }
    return next(e)
  })

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

  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    if (e.surface !== 'desktop') return next(e)
    return withModsButton($, $.ui.resolve(e), await next(e))
  })

  on('ui.render', { component: 'Pane', requestId: 'claude-mods' }, async ($, e, next) => {
    if (e.surface !== 'desktop') return next(e)
    const el = $.ui.resolve(e)
    const heading = { plugin: 'cherrypick', icon: 'checklist', title: 'Cherrypick' } as const
    return withModsSection(el, await next(e), sectionCard(el, heading, cherrypickRows(await read($, picks))))
  })

  on('ui.message', { component: 'Pane' }, async ($, e, next) => {
    const post = readSectionPost(e.data)
    if (post === null) return next(e)
    if (post.kind === 'toggle') toggleFold($)
    else if (post.id === 'copy') await copyPicks($, e.surface)
    else if (post.id === 'clear') await update($, picks, () => [])
    else {
      const pick = (await read($, picks)).find(one => pickId(one) === post.id)
      if (pick !== undefined) await unpick($, pick.message, pick.index)
    }
    return {}
  })

  on('ui.input', { element: 'claude-mods-filter' }, async ($, e, next) => {
    setFilter($, e.value)
    return next(e)
  })
}

const KIND_LABEL: Record<SectionKind, string> = {
  quote: 'Quote',
  code: 'Code',
  heading: 'Heading',
  rule: 'Rule',
  text: 'Text',
}

function cherrypickRows(checked: readonly CherrypickPick[]): SectionRow[] {
  if (checked.length === 0) {
    return [{ id: 'empty', icon: 'info', label: "Tick ☐ on a part of a reply to collect it.", isHint: true }]
  }
  const list = inReplyOrder(checked)
  const count = list.length === 1 ? '1 section' : `${list.length} sections`
  return [
    ...list.map(
      (pick): SectionRow => ({
        id: pickId(pick),
        icon: 'check',
        label: KIND_LABEL[pick.kind as SectionKind] ?? 'Text',
        value: firstLine(pick.plain),
        trailing: 'x',
      }),
    ),
    { id: 'copy', icon: 'copy', label: `Copy ${count}` },
    { id: 'clear', icon: 'x', label: 'Clear checks' },
  ]
}

function pickId(pick: CherrypickPick): string {
  return `pick:${pick.message}:${pick.index}`
}

function firstLine(text: string): string {
  return text.split('\n').find(line => line.trim() !== '')?.trim() ?? ''
}

async function unpick($: EngineInterface, message: string, index: number) {
  await update($, picks, list => list.filter(one => one.message !== message || one.index !== index))
}

async function toggle($: EngineInterface, message: string, index: number, section: Section) {
  const { plain } = section
  if (plain === null) return

  await update($, picks, list => {
    const rest = list.filter(one => one.message !== message || one.index !== index)
    if (rest.length < list.length) return rest
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

function inReplyOrder(list: readonly CherrypickPick[]): CherrypickPick[] {
  return [...list].sort((a, b) => a.messageOrder - b.messageOrder || a.index - b.index)
}

// A mix keeps every section's markdown, so a code block stays a code block beside text.
function joinPicks(list: readonly CherrypickPick[]): string {
  const isOneKind = new Set(list.map(one => one.kind)).size === 1
  return inReplyOrder(list)
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
  surface: RenderSurface,
  done: string,
) {
  const copied = await $.ui.copy({ text, surface })
  $.ui.toast(copied.isCopied ? done : `Nothing was copied (${copied.reason})`)
}
