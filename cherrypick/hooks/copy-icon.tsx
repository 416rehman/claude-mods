import type { ClientModule, RenderElement } from 'claude-code'

import { regionIcon } from './shared/icons'

type CopyIconProps = { index: number; isGlyph?: boolean }
type CopyIconState = { isChecked: boolean }

const CHECK_SHOWN_MS = 1500

const CopyIcon: ClientModule<CopyIconProps, CopyIconState> = (props, surface) => {
  surface.onPointer(event => {
    if (event.type !== 'down' || event.button !== 'left') return
    surface.post({ copy: props.index })
    surface.setState({ isChecked: true })
    const stop = surface.every(CHECK_SHOWN_MS, () => {
      stop()
      surface.setState({ isChecked: false })
    })
  })

  const isChecked = surface.state?.isChecked === true
  const { Box, Text } = surface.elements
  // Centred, or an image hangs from the top of its region.
  const centred = (mark: RenderElement) => (
    <Box width="100%" height="100%" alignItems="center" justifyContent="center">
      {mark}
    </Box>
  )

  if (props.isGlyph === true) {
    return centred(<Text dimColor>{isChecked ? '✓' : '⧉'}</Text>)
  }
  return centred(regionIcon(isChecked ? 'check' : 'copy', 14, isChecked ? 'Copied' : 'Copy'))
}

export default CopyIcon
