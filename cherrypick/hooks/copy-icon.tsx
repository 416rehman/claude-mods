import type { ClientModule, ElementConstructor, RenderElement, SvgProps } from 'claude-code'

type CopyIconProps = { index: number; isGlyph?: boolean }
type CopyIconState = { isChecked: boolean }

/**
 * The Copy (U+E056) and Check (U+E03B) glyphs of the desktop app's own icon
 * font, Anthropicons, at its default instance: the marks Claude's copy button
 * draws. Font units, y up, on a 1000-unit em.
 */
const COPY = 'M175 903H575Q597 903 614.5 892.5Q632 882 642.5 864.5Q653 847 653 825V425Q653 403 642.5 385.5Q632 368 614.5 357.5Q597 347 575 347H175Q153 347 135.5 357.5Q118 368 107.5 385.5Q97 403 97 425V825Q97 847 107.5 864.5Q118 882 135.5 892.5Q153 903 175 903ZM175 847Q166 847 159.5 840.5Q153 834 153 825V425Q153 416 159.5 409.5Q166 403 175 403H575Q584 403 590.5 409.5Q597 416 597 425V825Q597 834 590.5 840.5Q584 847 575 847ZM625 647V703H775Q797 703 814.5 692.5Q832 682 842.5 664.5Q853 647 853 625V225Q853 203 842.5 185.5Q832 168 814.5 157.5Q797 147 775 147H375Q353 147 335.5 157.5Q318 168 307.5 185.5Q297 203 297 225V375H353V225Q353 216 359.5 209.5Q366 203 375 203H775Q784 203 790.5 209.5Q797 216 797 225V625Q797 634 790.5 640.5Q784 647 775 647Z'
const CHECK = 'M168 505Q159 513 159.0 525.0Q159 537 168 545Q176 553 187.5 553.0Q199 553 207 545L400 352L805 757Q813 766 825.0 766.0Q837 766 845 757Q853 749 853.0 737.5Q853 726 845 718L420 293Q412 284 400.0 284.0Q388 284 380 293Z'

/**
 * A region's Svg is drawn as an image, which reads no theme colour, so the mark
 * is a mid grey that holds 3:1 against a light and a dark background alike.
 */
const INK = '#8a8a8a'

const CHECKED_MS = 1500

function mark(path: string): string {
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000">' +
    `<path fill="${INK}" transform="matrix(1 0 0 -1 0 1000)" d="${path}"/></svg>`
  )
}

/**
 * The copy mark beside a section: a left click copies the section and shows
 * the check for a moment, as Claude's own copy button does. `isGlyph` is set
 * once a surface refused the icon, and the mark is then the nearest glyph.
 */
const CopyIcon: ClientModule<CopyIconProps, CopyIconState> = (props, surface) => {
  surface.onPointer(event => {
    if (event.type !== 'down' || event.button !== 'left') return
    surface.post({ copy: props.index })
    surface.setState({ isChecked: true })
    const stop = surface.every(CHECKED_MS, () => {
      stop()
      surface.setState({ isChecked: false })
    })
  })

  const isChecked = surface.state?.isChecked === true
  const { Box, Text } = surface.elements
  // The mark sits in the middle of its region, as a glyph beside it sits in
  // the middle of its line; an image alone would hang from the region's top.
  const centred = (mark: RenderElement) => (
    <Box width="100%" height="100%" alignItems="center" justifyContent="center">
      {mark}
    </Box>
  )

  if (props.isGlyph === true) {
    return centred(<Text dimColor>{isChecked ? '✓' : '⧉'}</Text>)
  }

  const icon: SvgProps = {
    source: mark(isChecked ? CHECK : COPY),
    alt: isChecked ? 'Copied' : 'Copy',
    width: 14,
    height: 14,
  }
  // The desktop's region renderer draws an Svg though the module's element
  // table names none; an element is plain data, so it is written out here.
  const { Svg } = surface.elements as typeof surface.elements & {
    Svg?: ElementConstructor<SvgProps>
  }
  return centred(
    Svg !== undefined ? <Svg {...icon} /> : ({ type: 'Svg', props: icon } as RenderElement),
  )
}

export default CopyIcon
