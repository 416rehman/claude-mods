// One mod's section of the Mods sidebar, drawn in a region of its own so a
// whole row is a target and carries icons: a header that folds the section,
// then its rows. A click or Enter posts to the mod that drew the region, which
// acts on it; the region only draws and reports.

import type { ClientModule, RenderElement, SvgProps } from 'claude-code'

import { iconSource } from './icons'
import type { IconName } from './icons'
import { ROW_LINES } from './layout'

export type SectionRow = {
  /** The row's address within its section, what a post names. */
  id: string
  icon: IconName
  label: string
  /** Drawn dim after the label, cut in the middle where it is long. */
  value?: string
  /** The icon at the right edge; a click on it posts the row's `trailing` part. */
  trailing?: IconName
  /** A copy: the trailing icon shows a check for a moment after a click. */
  confirms?: true
  /** Guidance, dim, and no target. */
  isHint?: true
}

export type SectionProps = {
  title: string
  icon: IconName
  isCollapsed: boolean
  rows: SectionRow[]
}

/** What the region posts: the header folds the section; a row acts. */
export type SectionPost = { kind: 'toggle' } | { kind: 'row'; id: string; part: 'row' | 'trailing' }

type SectionState = { hover: number | null; focus: number | null; flashed: string | null }

const AT_REST: SectionState = { hover: null, focus: null, flashed: null }

/**
 * A region's Svg is an image that reads no theme colour, so the icons are a
 * mid grey that holds 3:1 against a light and a dark background alike.
 */
const INK = '#8a8a8a'

/** A lit row: translucent, as the desktop paints a selection beneath the text. */
const LIT = 'rgba(128, 128, 128, 0.10)'

/**
 * The desktop rounds a Box's corners only where it draws a border, so every
 * row has a round one: the lit row's in its tint, which rounds the tint; the
 * others' clear. No vertical padding, so the border takes no height.
 */
const AT_REST_EDGE = 'rgba(0, 0, 0, 0)'

const FLASH_MS = 1500

/** Cells at a row's right edge where a click counts as on its trailing icon. */
const TRAILING_CELLS = 5

/** The icons' size, and the caret's beside the header's. */
const ICON_PX = 16
const CARET_PX = 14

const Section: ClientModule<SectionProps, SectionState> = (props, surface) => {
  const lines = props.isCollapsed ? 0 : props.rows.length
  const rowAt = (line: number) => (line >= 1 && line <= lines ? props.rows[line - 1] : undefined)
  const isTarget = (line: number) => line === 0 || (rowAt(line) !== undefined && rowAt(line)?.isHint !== true)
  const now = () => surface.state ?? AT_REST

  const activate = (line: number, part: 'row' | 'trailing') => {
    if (line === 0) {
      surface.post({ kind: 'toggle' })
      return
    }
    const row = rowAt(line)
    if (row === undefined || row.isHint === true) return
    surface.post({ kind: 'row', id: row.id, part })
    if (row.confirms === true) {
      surface.setState({ ...now(), flashed: row.id })
      const stop = surface.every(FLASH_MS, () => {
        stop()
        surface.setState({ ...now(), flashed: null })
      })
    }
  }

  surface.onPointer(event => {
    const state = now()
    if (event.type === 'leave') {
      if (state.hover !== null) surface.setState({ ...state, hover: null })
      return
    }
    const at = Math.floor(event.y / ROW_LINES)
    const line = isTarget(at) ? at : null
    if (event.type === 'move' && line !== state.hover) surface.setState({ ...state, hover: line })
    if (event.type === 'down' && event.button === 'left' && line !== null) {
      const onTrailing =
        rowAt(line)?.trailing !== undefined && event.x >= surface.columns - TRAILING_CELLS
      activate(line, onTrailing ? 'trailing' : 'row')
    }
  })

  surface.onKey(event => {
    const state = now()
    const targets = [...Array(lines + 1).keys()].filter(isTarget)
    const at = state.focus === null ? -1 : targets.indexOf(state.focus)
    if (event.key === 'down' || event.key === 'up') {
      const step = event.key === 'down' ? 1 : -1
      const next = targets[Math.min(targets.length - 1, Math.max(0, at + step))] ?? null
      surface.setState({ ...state, focus: next })
    } else if ((event.key === 'return' || event.key === ' ') && state.focus !== null) {
      activate(state.focus, 'row')
    }
  })

  const state = now()
  const { Box, Text } = surface.elements
  const isLit = (line: number) => line === state.hover || line === state.focus
  const tint = (line: number) =>
    isLit(line)
      ? { borderStyle: 'round', borderColor: LIT, backgroundColor: LIT, paddingY: 0 }
      : { borderStyle: 'round', borderColor: AT_REST_EDGE, paddingY: 0 }

  return (
    <Box flexDirection="column" width="100%">
      <Box
        key="header"
        flexDirection="row"
        alignItems="center"
        columnGap={1}
        height={ROW_LINES}
        paddingX={1}
        {...tint(0)}
      >
        {icon(props.isCollapsed ? 'caretRight' : 'caretDown', CARET_PX)}
        {icon(props.icon, ICON_PX)}
        <Text weight="semibold">{props.title}</Text>
      </Box>
      {props.rows.slice(0, lines).map((row, i) => (
        <Box
          key={row.id}
          flexDirection="row"
          alignItems="center"
          columnGap={1}
          height={ROW_LINES}
          paddingX={1}
          {...tint(i + 1)}
        >
          <Box flexShrink={0}>{icon(row.icon, ICON_PX)}</Box>
          <Box flexShrink={0} marginRight={1}>
            <Text dimColor={row.isHint === true}>{row.label}</Text>
          </Box>
          <Box flexGrow={1} flexShrink={1} minWidth={0}>
            {row.value !== undefined && (
              <Text dimColor wrap="truncate-middle">
                {row.value}
              </Text>
            )}
          </Box>
          {row.trailing !== undefined && (
            <Box flexShrink={0} marginLeft={1}>
              {icon(state.flashed === row.id ? 'check' : row.trailing, ICON_PX)}
            </Box>
          )}
        </Box>
      ))}
    </Box>
  )
}

/**
 * One of the app's own icons. A region's element table names no Svg, though
 * the desktop's region renderer draws one; an element is plain data, so it is
 * written out here.
 */
function icon(name: IconName, size: number): RenderElement {
  const props: SvgProps = { source: iconSource(name, INK), alt: name, width: size, height: size }
  return { type: 'Svg', props } as RenderElement
}

export default Section
