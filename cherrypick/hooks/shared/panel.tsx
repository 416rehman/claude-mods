// The Mods sidebar every mod of claude-mods shares. Each mod carries this file;
// none needs another installed. Where several are, they settle it in the render
// chain: the lowest of them draws the footer's Mods button and the filter that
// heads the panel, and each draws its own section after what the ones beneath
// drew. Keep the copies in step with scripts/sync-shared.mjs.

import type { ElementTable, EngineInterface, RenderElement, RenderNode } from 'claude-code'

import { iconSource } from './icons'
import type { IconName } from './icons'
import { ROW_LINES } from './layout'
import type { SectionPost, SectionProps, SectionRow } from './section'

export type { SectionRow }

/** The sidebar's pane id, the same in every mod so they draw into one pane. */
export const PANE_ID = 'claude-mods'

const OPEN_KEY = 'claude-mods-open'
const FILTER_KEY = 'claude-mods-filter'

/** The filter text, lower-cased: each mod hears it typed at `ui.input`. */
let query = ''

/** Whether this mod's section is folded, as the person left it this load. */
let isFolded = false

export type El = ElementTable<'desktop'>

/** Whether `node` holds an element keyed `key`: a mod beneath drew it already. */
function holds(node: unknown, key: string): boolean {
  if (typeof node !== 'object' || node === null) return false
  const props = (node as { props?: { key?: unknown } }).props
  if (props?.key === key) return true
  const children = (node as { children?: unknown }).children
  return Array.isArray(children) && children.some(child => holds(child, key))
}

/** Whether `node` is the engine's own drawing, which a pane of a plugin's has nothing in. */
function isEngines(node: RenderElement): boolean {
  return (node as { type?: unknown }).type === 'engine'
}

/** Whether any of `texts` holds the filter text; all do while it is empty. */
export function matches(...texts: readonly string[]): boolean {
  return query === '' || texts.some(text => text.toLowerCase().includes(query))
}

/** Keeps what was typed in the filter and draws the sections again. */
export function noteFilter($: EngineInterface, value: string): void {
  query = value.trim().toLowerCase()
  $.ui.invalidate('ui.render')
}

/** The footer as the plugins beneath drew it, with one Mods button after it. */
export function withModsButton($: EngineInterface, el: El, theirs: RenderElement): RenderElement {
  if (holds(theirs, OPEN_KEY)) return theirs
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

/**
 * The panel as the mods beneath drew it, with this mod's section after it.
 * The lowest of them heads it with the filter.
 */
export function withModsSection(el: El, theirs: RenderElement, section: RenderNode | null): RenderElement {
  const { Box, Input } = el
  const isLowest = !holds(theirs, FILTER_KEY)
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
      {!(isLowest && isEngines(theirs)) && theirs}
      {section}
    </Box>
  )
}

/** One of the app's own icons, in the colour of the text around it. */
export function icon(el: El, name: IconName, size = 14): RenderElement {
  const { Svg } = el
  return <Svg source={iconSource(name)} alt={name} width={size} height={size} />
}

/**
 * A mod's section: a card holding the region that draws its header and rows,
 * folded as the person left it and open while the filter is in use. Null when
 * the filter leaves it no row.
 */
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

/** What a section's region posted, or null for a message of another kind. */
export function readSectionPost(data: unknown): SectionPost | null {
  if (typeof data !== 'object' || data === null || !('kind' in data)) return null
  if (data.kind === 'toggle') return { kind: 'toggle' }
  if (data.kind !== 'row' || !('id' in data) || !('part' in data)) return null
  const { id, part } = data
  if (typeof id !== 'string' || (part !== 'row' && part !== 'trailing')) return null
  return { kind: 'row', id, part }
}

/** Folds this mod's section, or opens it. */
export function toggleFold($: EngineInterface): void {
  isFolded = !isFolded
  $.ui.invalidate('ui.render')
}
