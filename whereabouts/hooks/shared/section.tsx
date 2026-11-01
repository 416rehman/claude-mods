// One mod's section, drawn in a Client region so a whole row is clickable and
// can show icons. The region only draws and posts; the mod that drew it acts.

import type { ClientModule } from 'claude-code'

import { regionIcon } from './icons'
import type { IconName } from './icons'
import { ROW_LINES } from './layout'

export type SectionRow = {
  id: string
  icon: IconName
  label: string
  value?: string
  trailing?: IconName
  flashesCheck?: true
  isHint?: true
}

export type SectionProps = {
  title: string
  icon: IconName
  isCollapsed: boolean
  rows: SectionRow[]
}

export type SectionPost = { kind: 'toggle' } | { kind: 'row'; id: string; part: 'row' | 'trailing' }

type SectionState = { hover: number | null; focus: number | null; flashed: string | null }

const INITIAL_STATE: SectionState = { hover: null, focus: null, flashed: null }

// Translucent, because the desktop draws a text selection beneath the background.
const HIGHLIGHT = 'rgba(128, 128, 128, 0.10)'

// The desktop rounds a Box only when it has a border, so every row has one,
// clear at rest. `paddingY: 0` stops the border adding height.
const CLEAR_BORDER = 'rgba(0, 0, 0, 0)'

const CHECK_SHOWN_MS = 1500

const TRAILING_CELLS = 5
const ICON_PX = 16
const CARET_PX = 14

const Section: ClientModule<SectionProps, SectionState> = (props, surface) => {
  const rowCount = props.isCollapsed ? 0 : props.rows.length
  const rowAt = (line: number) => (line >= 1 && line <= rowCount ? props.rows[line - 1] : undefined)
  const isClickable = (line: number) => line === 0 || (rowAt(line) !== undefined && rowAt(line)?.isHint !== true)
  const currentState = () => surface.state ?? INITIAL_STATE

  const activate = (line: number, part: 'row' | 'trailing') => {
    if (line === 0) {
      surface.post({ kind: 'toggle' })
      return
    }
    const row = rowAt(line)
    if (row === undefined || row.isHint === true) return
    surface.post({ kind: 'row', id: row.id, part })
    if (row.flashesCheck === true) {
      surface.setState({ ...currentState(), flashed: row.id })
      const stop = surface.every(CHECK_SHOWN_MS, () => {
        stop()
        surface.setState({ ...currentState(), flashed: null })
      })
    }
  }

  surface.onPointer(event => {
    const state = currentState()
    if (event.type === 'leave') {
      if (state.hover !== null) surface.setState({ ...state, hover: null })
      return
    }
    const at = Math.floor(event.y / ROW_LINES)
    const line = isClickable(at) ? at : null
    if (event.type === 'move' && line !== state.hover) surface.setState({ ...state, hover: line })
    if (event.type === 'down' && event.button === 'left' && line !== null) {
      const onTrailing =
        rowAt(line)?.trailing !== undefined && event.x >= surface.columns - TRAILING_CELLS
      activate(line, onTrailing ? 'trailing' : 'row')
    }
  })

  surface.onKey(event => {
    const state = currentState()
    const clickable = [...Array(rowCount + 1).keys()].filter(isClickable)
    const at = state.focus === null ? -1 : clickable.indexOf(state.focus)
    if (event.key === 'down' || event.key === 'up') {
      const step = event.key === 'down' ? 1 : -1
      const next = clickable[Math.min(clickable.length - 1, Math.max(0, at + step))] ?? null
      surface.setState({ ...state, focus: next })
    } else if ((event.key === 'return' || event.key === ' ') && state.focus !== null) {
      activate(state.focus, 'row')
    }
  })

  const state = currentState()
  const { Box, Text } = surface.elements
  const isHighlighted = (line: number) => line === state.hover || line === state.focus
  const rowStyle = (line: number) =>
    isHighlighted(line)
      ? { borderStyle: 'round', borderColor: HIGHLIGHT, backgroundColor: HIGHLIGHT, paddingY: 0 }
      : { borderStyle: 'round', borderColor: CLEAR_BORDER, paddingY: 0 }

  return (
    <Box flexDirection="column" width="100%">
      <Box
        key="header"
        flexDirection="row"
        alignItems="center"
        columnGap={1}
        height={ROW_LINES}
        paddingX={1}
        {...rowStyle(0)}
      >
        {regionIcon(props.isCollapsed ? 'caretRight' : 'caretDown', CARET_PX)}
        {regionIcon(props.icon, ICON_PX)}
        <Text weight="semibold">{props.title}</Text>
      </Box>
      {props.rows.slice(0, rowCount).map((row, i) => (
        <Box
          key={row.id}
          flexDirection="row"
          alignItems="center"
          columnGap={1}
          height={ROW_LINES}
          paddingX={1}
          {...rowStyle(i + 1)}
        >
          <Box flexShrink={0}>{regionIcon(row.icon, ICON_PX)}</Box>
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
              {regionIcon(state.flashed === row.id ? 'check' : row.trailing, ICON_PX)}
            </Box>
          )}
        </Box>
      ))}
    </Box>
  )
}

export default Section
