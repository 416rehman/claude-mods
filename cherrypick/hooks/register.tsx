import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderSurface } from 'claude-code'

import type { CherrypickPick } from '../types'
import { splitSections } from './sections'
import type { Section, SectionKind } from './sections'
import {
  noteFilter,
  readSectionPost,
  sectionCard,
  toggleFold,
  withModsButton,
  withModsSection,
} from './shared/panel'
import type { SectionRow } from './shared/panel'

// Change the tag when a pick's fields change: it declines what an earlier
// version stored, which outlives a reload.
const picks = atom({ plugin: 'cherrypick', key: 'picks' } as const, [], {
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
      $.ui.log(`cherrypick: the copy icon was refused (${e.reason}); copy marks show a glyph`, {
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

  // The footer's Mods button and the Mods sidebar, shared with the other mods.
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

  // A click on a row of this mod's section: a checked one is removed; the last
  // two copy all of them or clear them.
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
    noteFilter($, e.value)
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

/** This mod's section of the Mods sidebar: the checked sections, then what to do with them. */
function cherrypickRows(checked: readonly CherrypickPick[]): SectionRow[] {
  if (checked.length === 0) {
    return [{ id: 'empty', icon: 'info', label: "Tick ☐ on a part of a reply to collect it.", isHint: true }]
  }
  const list = [...checked].sort((a, b) => a.messageOrder - b.messageOrder || a.index - b.index)
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

/** A section's first line, as the sidebar previews it. */
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

/**
 * The checked sections in the order the replies show them, a blank line apart.
 * Sections all of one kind copy without their markers; a mix keeps every
 * section's markdown, so a code block stays a code block beside the text.
 */
function joinPicks(list: readonly CherrypickPick[]): string {
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
  surface: RenderSurface,
  done: string,
) {
  const copied = await $.ui.copy({ text, surface })
  $.ui.toast(copied.isCopied ? done : `Nothing was copied (${copied.reason})`)
}
