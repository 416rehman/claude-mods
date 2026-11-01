// The Mods sidebar. scripts/sync-shared.mjs copies this folder into every mod,
// so edit it here, not in a copy. With several mods installed, the lowest in the
// render chain draws the Mods button and the filter; each adds its own section.

import type { ElementTable, EngineInterface, RenderElement, RenderNode } from 'claude-code'

import { iconSource } from './icons'
import type { IconName } from './icons'
import { ROW_LINES } from './layout'
import type { SectionPost, SectionProps, SectionRow } from './section'

export type { SectionRow }

/** The same in every mod, so they all draw into one pane. */
export const PANE_ID = 'claude-mods'

const OPEN_KEY = 'claude-mods-open'
const FILTER_KEY = 'claude-mods-filter'

let query = ''
let isFolded = false

export type El = ElementTable<'desktop'>

function containsKey(node: unknown, key: string): boolean {
  if (typeof node !== 'object' || node === null) return false
  const props = (node as { props?: { key?: unknown } }).props
  if (props?.key === key) return true
  const children = (node as { children?: unknown }).children
  return Array.isArray(children) && children.some(child => containsKey(child, key))
}

/** The engine draws nothing in a plugin's pane, so only a mod's drawing is kept. */
function isEngineDrawing(node: RenderElement): boolean {
  return (node as { type?: unknown }).type === 'engine'
}

export function matches(...texts: readonly string[]): boolean {
  return query === '' || texts.some(text => text.toLowerCase().includes(query))
}

export function setFilter($: EngineInterface, value: string): void {
  query = value.trim().toLowerCase()
  $.ui.invalidate('ui.render')
}

export function withModsButton($: EngineInterface, el: El, theirs: RenderElement): RenderElement {
  if (containsKey(theirs, OPEN_KEY)) return theirs
  const { Box, Button } = el
  return (
    <Box flexDirection="row" alignItems="center" columnGap={1}>
      {theirs}
      <Box flexShrink={0}>
        <Button key={OPEN_KEY} label="Mods" plain dimColor onPress={() => togglePanel($)} />
      </Box>
    </Box>
  )
}

async function togglePanel($: EngineInterface): Promise<void> {
  const isOpen = (await $.ui.panes()).some(pane => pane.id === PANE_ID)
  if (isOpen) await $.ui.close({ id: PANE_ID })
  else await $.ui.open({ id: PANE_ID, title: 'Mods' })
}

export function withModsSection(el: El, theirs: RenderElement, section: RenderNode | null): RenderElement {
  const { Box, Input } = el
  const isLowest = !containsKey(theirs, FILTER_KEY)
  return (
    <Box flexDirection="column" rowGap="lg" paddingY="sm">
      {isLowest && (
        <Box key={FILTER_KEY + '-row'} flexDirection="row" alignItems="center" columnGap={1} paddingX={1}>
          {icon(el, 'search', 16)}
          <Box flexGrow={1} minWidth={0}>
            <Input
              key={FILTER_KEY}
              placeholder="Filter"
              value={query}
              onInput={() => {}}
              onSubmit={() => {}}
            />
          </Box>
        </Box>
      )}
      {!(isLowest && isEngineDrawing(theirs)) && theirs}
      {section}
    </Box>
  )
}

export function icon(el: El, name: IconName, size = 14): RenderElement {
  const { Svg } = el
  return <Svg source={iconSource(name)} alt={name} width={size} height={size} />
}

export function sectionCard(
  el: El,
  heading: { plugin: string; icon: IconName; title: string },
  rows: readonly SectionRow[],
): RenderElement | null {
  const shown = rows.filter(row => (row.isHint === true ? query === '' : matches(row.label, row.value ?? '')))
  if (query !== '' && shown.length === 0) return null
  const isCollapsed = isFolded && query === ''
  const props: SectionProps = { title: heading.title, icon: heading.icon, isCollapsed, rows: shown }
  const { Box, Client } = el
  return (
    <Box key={`claude-mods-card-${heading.plugin}`} flexDirection="column" borderStyle="round" borderDimColor>
      <Client
        key={`claude-mods-${heading.plugin}`}
        module="./section.tsx"
        props={props}
        width="100%"
        height={ROW_LINES * (1 + (isCollapsed ? 0 : shown.length))}
      />
    </Box>
  )
}

export function readSectionPost(data: unknown): SectionPost | null {
  if (typeof data !== 'object' || data === null || !('kind' in data)) return null
  if (data.kind === 'toggle') return { kind: 'toggle' }
  if (data.kind !== 'row' || !('id' in data) || !('part' in data)) return null
  const { id, part } = data
  if (typeof id !== 'string' || (part !== 'row' && part !== 'trailing')) return null
  return { kind: 'row', id, part }
}

export function toggleFold($: EngineInterface): void {
  isFolded = !isFolded
  $.ui.invalidate('ui.render')
}
