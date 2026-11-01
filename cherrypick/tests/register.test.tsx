import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const REPLY = {
  plugin: 'cherrypick',
  component: 'AssistantMessage',
  requestId: 'reply-a',
  props: {
    text: 'He said:\n> keep it simple\n\nSo I did.\n\n---',
    isFirstOfReply: true,
  },
} as const

const LATER_REPLY = {
  ...REPLY,
  requestId: 'reply-b',
  props: { text: 'First.\n\nSecond.', isFirstOfReply: true },
} as const

const CODE_REPLY = {
  ...REPLY,
  requestId: 'reply-c',
  props: { text: 'Run:\n\n```sh\nnpm test\n```', isFirstOfReply: true },
} as const


const PANE = {
  plugin: 'cherrypick',
  component: 'Pane',
  requestId: 'claude-mods',
  props: {
    title: 'Mods',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const BAR = {
  plugin: 'cherrypick',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

/** The drawn element keyed `key`, with its `hover`, which `find` leaves out. */
type Drawn = { props?: Record<string, unknown>; hover?: unknown; children?: unknown[] }
function drawnByKey(node: unknown, key: string): Drawn | undefined {
  if (typeof node !== 'object' || node === null) return undefined
  const element = node as Drawn
  if (element.props?.key === key) return element
  for (const child of element.children ?? []) {
    const found = drawnByKey(child, key)
    if (found !== undefined) return found
  }
  return undefined
}

/** The drawn element whose own children hold the element keyed `key`. */
function parentOfKey(node: unknown, key: string): Drawn | undefined {
  if (typeof node !== 'object' || node === null) return undefined
  const element = node as Drawn
  const children = element.children ?? []
  if (children.some(child => (child as Drawn | null)?.props?.key === key)) return element
  for (const child of children) {
    const found = parentOfKey(child, key)
    if (found !== undefined) return found
  }
  return undefined
}


describe('selecting sections of replies', () => {
  for (const surface of ['desktop', 'vscode'] as const) {
    test(`each section with text gets Copy and a checkbox, on ${surface}`, async ($, on) => {
      on('ui.render', ($, e) => {
        const { Text } = $.ui.resolve(e)
        return <Text>engine</Text>
      })

      const reply = await $.ui.mount({ ...REPLY, surface })

      // A desktop draws a Button's `label` and none of its children, so the
      // label is what must read right. Three sections to copy or check; the
      // rule draws but has nothing to copy. The desktop's copy mark is a
      // region that draws the app's icon; VS Code has no regions, so a Button.
      const label = async (key: string) => (await reply.find({ key }))?.props.label
      const labels = (await reply.findAll({ type: 'Button' })).map(button => button.props.label)
      expect(await reply.findAll({ type: 'Markdown' })).toHaveLength(4)
      if (surface === 'desktop') {
        expect(labels).toEqual(['☐', '☐', '☐'])
        expect(await reply.findAll({ type: 'Client' })).toHaveLength(3)
      } else {
        expect(labels).toEqual(['⧉', '☐', '⧉', '☐', '⧉', '☐'])
      }

      await reply.press({ key: 'pick-1' })
      expect(await label('pick-1')).toBe('☑\u{FE0E}')

      await reply.press({ key: 'pick-1' })
      expect(await label('pick-1')).toBe('☐')
      await reply.unmount()
    })
  }

  test('copies the checked sections in reply order, then clears them', async ($, on) => {
    const copied: string[] = []
    const toasts: string[] = []
    on('ui.copy', (_, e) => {
      copied.push(e.text)
      return { value: { isCopied: true } }
    })
    on('ui.toast', (_, e) => {
      toasts.push(e.text)
      return { value: undefined }
    })
    on('ui.render', ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>engine</Text>
    })

    const first = await $.ui.mount({ ...REPLY, surface: 'desktop' })
    const later = await $.ui.mount({ ...LATER_REPLY, surface: 'desktop' })

    // Checked out of order, within a reply and across the two.
    await first.press({ key: 'pick-2' })
    await later.press({ key: 'pick-1' })
    await first.press({ key: 'pick-1' })

    const bar = await $.ui.mount({ ...BAR, surface: 'desktop' })
    expect((await bar.find({ type: 'Text', text: /selected/ }))?.text).toBe(
      '3 sections selected',
    )

    await bar.press({ key: 'copy-selected' })
    // A quote checked beside text keeps its marker.
    expect(copied).toEqual(['> keep it simple\n\nSo I did.\n\nSecond.'])
    expect(toasts).toEqual(['Copied 3 sections'])

    // Nothing is checked any more: the bar gives way and the boxes are empty.
    expect(await bar.find({ key: 'copy-selected' })).toBeUndefined()
    expect((await first.find({ key: 'pick-1' }))?.text).toBe('☐')

    await bar.unmount()
    await first.unmount()
    await later.unmount()
  })

  test('a refused copy says so and keeps what was checked', async ($, on) => {
    // Stands for the engine beneath every plugin.
    on('ui.render', ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>engine</Text>
    })
    const toasts: string[] = []
    on('ui.copy', () => ({ value: { isCopied: false, reason: 'no-clipboard' } }))
    on('ui.toast', (_, e) => {
      toasts.push(e.text)
      return { value: undefined }
    })

    const reply = await $.ui.mount({ ...REPLY, surface: 'desktop' })
    await reply.press({ key: 'pick-0' })

    const bar = await $.ui.mount({ ...BAR, surface: 'desktop' })
    await bar.press({ key: 'copy-selected' })

    expect(toasts).toEqual(['Nothing was copied (no-clipboard)'])
    expect((await bar.find({ type: 'Text', text: /selected/ }))?.text).toBe(
      '1 section selected',
    )
    await bar.unmount()
    await reply.unmount()
  })

  test("another plugin's band stays in view above the bar while sections are checked", async ($, on) => {
    on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>a game's band</Text>
    })
    on('ui.render', ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>engine</Text>
    })

    const reply = await $.ui.mount({ ...REPLY, surface: 'desktop' })
    await reply.press({ key: 'pick-0' })

    const bar = await $.ui.mount({ ...BAR, surface: 'desktop' })
    const texts = (await bar.findAll({ type: 'Text' })).map(text => text.text)
    expect(texts).toEqual(["a game's band", '1 section selected'])
    expect(await bar.find({ key: 'copy-selected' })).toBeDefined()
    await bar.unmount()
    await reply.unmount()
  })

  test('Clear unchecks everything', async ($, on) => {
    on('ui.render', ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>engine</Text>
    })

    const reply = await $.ui.mount({ ...REPLY, surface: 'desktop' })
    await reply.press({ key: 'pick-0' })
    await reply.press({ key: 'pick-2' })

    const bar = await $.ui.mount({ ...BAR, surface: 'desktop' })
    await bar.press({ key: 'clear-selected' })

    expect(await bar.find({ key: 'copy-selected' })).toBeUndefined()
    expect((await reply.find({ key: 'pick-2' }))?.text).toBe('☐')
    await bar.unmount()
    await reply.unmount()
  })

  test('nothing sits above the prompt while nothing is checked', async ($, on) => {
    on('ui.render', ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>engine</Text>
    })

    const bar = await $.ui.mount({ ...BAR, surface: 'desktop' })

    expect(await bar.find({ type: 'Button' })).toBeUndefined()
    expect((await bar.find({ type: 'Text' }))?.text).toBe('engine')
    await bar.unmount()
  })

  test('the copy mark copies one section without its markers, and checks nothing', async ($, on) => {
    const copied: string[] = []
    const toasts: string[] = []
    on('ui.copy', (_, e) => {
      copied.push(e.text)
      return { value: { isCopied: true } }
    })
    on('ui.toast', (_, e) => {
      toasts.push(e.text)
      return { value: undefined }
    })
    on('ui.render', ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>engine</Text>
    })

    const reply = await $.ui.mount({ ...REPLY, surface: 'desktop' })
    const code = await $.ui.mount({ ...CODE_REPLY, surface: 'desktop' })
    const click = { type: 'down', x: 0, y: 0, button: 'left' } as const
    await reply.pointer({ ...click, in: 'copy-1' })
    await code.pointer({ ...click, in: 'copy-1' })

    expect(copied).toEqual(['keep it simple', 'npm test'])
    // The mark turns to a check instead of a toast, as Claude's own does.
    expect(toasts).toEqual([])

    // Nothing was checked, so no bar appears above the prompt.
    const bar = await $.ui.mount({ ...BAR, surface: 'desktop' })
    expect(await bar.find({ key: 'copy-selected' })).toBeUndefined()
    await bar.unmount()
    await code.unmount()
    await reply.unmount()
  })

  test('the copy mark shows a check for a moment, and ignores a right click', async ($, on) => {
    const copied: string[] = []
    on('ui.copy', (_, e) => {
      copied.push(e.text)
      return { value: { isCopied: true } }
    })
    on('ui.render', ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>engine</Text>
    })

    const reply = await $.ui.mount({ ...REPLY, surface: 'desktop' })
    // The mark is the app's own icon, drawn as an Svg; its alt names which.
    const mark = async () => {
      const icon = await reply.find({ type: 'Svg', in: 'copy-0' })
      return `${icon?.type} ${icon?.props.alt}`
    }

    // Centred in its region, so it lines up with the checkbox beside it.
    const region = (await reply.drawn({ in: 'copy-0' })) as Drawn
    expect(region.props).toMatchObject({
      width: '100%',
      height: '100%',
      alignItems: 'center',
      justifyContent: 'center',
    })

    await reply.pointer({ type: 'down', x: 0, y: 0, button: 'right', in: 'copy-0' })
    expect(copied).toEqual([])
    expect(await mark()).toBe('Svg Copy')

    await reply.pointer({ type: 'down', x: 0, y: 0, button: 'left', in: 'copy-0' })
    expect(copied).toEqual(['He said:'])
    expect(await mark()).toBe('Svg Copied')

    await reply.advance(1500)
    expect(await mark()).toBe('Svg Copy')
    await reply.unmount()
  })

  test('a copy mark whose copy is refused says so', async ($, on) => {
    const toasts: string[] = []
    on('ui.copy', () => ({ value: { isCopied: false, reason: 'no-clipboard' } }))
    on('ui.toast', (_, e) => {
      toasts.push(e.text)
      return { value: undefined }
    })

    const reply = await $.ui.mount({ ...REPLY, surface: 'desktop' })
    await reply.pointer({ type: 'down', x: 0, y: 0, button: 'left', in: 'copy-1' })

    expect(toasts).toEqual(['Nothing was copied (no-clipboard)'])
    await reply.unmount()
  })

  test('VS Code copies with its copy button, and says what it copied', async ($, on) => {
    const copied: string[] = []
    const toasts: string[] = []
    on('ui.copy', (_, e) => {
      copied.push(e.text)
      return { value: { isCopied: true } }
    })
    on('ui.toast', (_, e) => {
      toasts.push(e.text)
      return { value: undefined }
    })

    const code = await $.ui.mount({ ...CODE_REPLY, surface: 'vscode' })
    await code.press({ key: 'copy-1' })

    expect(copied).toEqual(['npm test'])
    expect(toasts).toEqual(['Code copied'])
    await code.unmount()
  })

  test('the copy mark and the checkbox sit side by side, shown together', async ($, on) => {
    on('ui.render', ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>engine</Text>
    })

    const reply = await $.ui.mount({ ...REPLY, surface: 'desktop' })
    const tree = await reply.drawn()

    // One row holds the checkbox and the box around the copy mark, and it is
    // the one thing the pointer reveals, so the two appear at once.
    const row = parentOfKey(tree, 'pick-1')
    expect(row?.props?.flexDirection).toBe('row')
    expect(row?.props?.display).toBe('none')
    expect(row?.hover).toEqual({ display: 'flex' })
    expect(parentOfKey(row, 'copy-1')).toBeDefined()

    // Checked, the box stays in view and the copy mark waits for the pointer.
    await reply.press({ key: 'pick-1' })
    const checked = parentOfKey(await reply.drawn(), 'pick-1')
    expect(checked?.props?.display).toBeUndefined()
    expect(parentOfKey(checked, 'copy-1')?.props?.display).toBe('none')
    await reply.unmount()
  })

  test('desktop lifts the hovered section a shade and tints a checked one', async ($, on) => {
    on('ui.render', ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>engine</Text>
    })

    const reply = await $.ui.mount({ ...REPLY, surface: 'desktop' })

    const hovered = drawnByKey(await reply.drawn(), 'section-1')
    // Translucent, so the app's selection bands beneath still show through.
    expect(hovered?.hover).toEqual({ backgroundColor: 'rgba(128, 128, 128, 0.08)' })
    expect(hovered?.props?.backgroundColor).toBeUndefined()

    // The rule has nothing to check, so nothing lights over it.
    expect(drawnByKey(await reply.drawn(), 'section-3')?.hover).toBeUndefined()

    await reply.press({ key: 'pick-1' })
    const checked = drawnByKey(await reply.drawn(), 'section-1')
    expect(checked?.props?.backgroundColor).toBe('rgba(128, 128, 128, 0.16)')
    expect(checked?.hover).toBeUndefined()
    await reply.unmount()
  })

  test('VS Code draws no tint, and the checkbox still checks', async ($, on) => {
    on('ui.render', ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>engine</Text>
    })

    const reply = await $.ui.mount({ ...REPLY, surface: 'vscode' })

    expect(drawnByKey(await reply.drawn(), 'section-1')?.hover).toBeUndefined()
    await reply.press({ key: 'pick-1' })
    expect((await reply.find({ key: 'pick-1' }))?.text).toBe('☑\u{FE0E}')
    expect(drawnByKey(await reply.drawn(), 'section-1')?.props?.backgroundColor).toBeUndefined()
    await reply.unmount()
  })

  const copiedFrom = async (
    $: Engine,
    checks: ReadonlyArray<readonly [typeof REPLY | typeof CODE_REPLY, string]>,
  ) => {
    for (const [fixture, key] of checks) {
      const reply = await $.ui.mount({ ...fixture, surface: 'desktop' })
      await reply.press({ key })
      await reply.unmount()
    }
    const bar = await $.ui.mount({ ...BAR, surface: 'desktop' })
    await bar.press({ key: 'copy-selected' })
    await bar.unmount()
  }

  test('sections of one kind copy without their markers', async ($, on) => {
    // Stands for the engine beneath every plugin.
    on('ui.render', ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>engine</Text>
    })
    const copied: string[] = []
    on('ui.copy', (_, e) => {
      copied.push(e.text)
      return { value: { isCopied: true } }
    })
    on('ui.toast', () => ({ value: undefined }))

    await copiedFrom($, [[CODE_REPLY, 'pick-1']])
    await copiedFrom($, [[REPLY, 'pick-1']])

    expect(copied).toEqual(['npm test', 'keep it simple'])
  })

  test('mixed kinds keep every marker: fences, quote marks and all', async ($, on) => {
    // Stands for the engine beneath every plugin.
    on('ui.render', ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>engine</Text>
    })
    const copied: string[] = []
    on('ui.copy', (_, e) => {
      copied.push(e.text)
      return { value: { isCopied: true } }
    })
    on('ui.toast', () => ({ value: undefined }))

    await copiedFrom($, [
      [CODE_REPLY, 'pick-0'],
      [CODE_REPLY, 'pick-1'],
    ])

    expect(copied).toEqual(['Run:\n\n```sh\nnpm test\n```'])
  })

  for (const surface of ['terminal', 'mobile'] as const) {
    test(`${surface} keeps the engine's own drawing`, async ($, on) => {
      on('ui.render', ($, e) => {
        const { Text } = $.ui.resolve(e)
        return <Text>engine</Text>
      })

      const reply = await $.ui.mount({ ...REPLY, surface })

      expect(await reply.find({ type: 'Button' })).toBeUndefined()
      expect((await reply.find({ type: 'Text' }))?.text).toBe('engine')
      await reply.unmount()
    })
  }

  test("a summary of the model's text keeps the engine's drawing", async ($, on) => {
    on('ui.render', ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>engine</Text>
    })

    const reply = await $.ui.mount({
      ...REPLY,
      surface: 'desktop',
      props: { ...REPLY.props, isSummary: true },
    })

    expect(await reply.find({ type: 'Button' })).toBeUndefined()
    await reply.unmount()
  })
})

describe('the Cherrypick section of the Mods sidebar', () => {
  const CARD = 'claude-mods-cherrypick'
  type Region = {
    findAll: (q: { type: string; in?: string }) => Promise<{ text: string; props: Record<string, unknown> }[]>
  }
  const cardTexts = async (pane: Region) =>
    (await pane.findAll({ type: 'Text', in: CARD })).map(text => text.text)

  test('with nothing checked, it says how to collect sections', async ($, on) => {
    on('ui.render', ($, e) => {
      const { Box } = $.ui.resolve(e)
      return <Box />
    })

    const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
    expect(await cardTexts(pane)).toEqual(['Cherrypick', 'Tick ☐ on a part of a reply to collect it.'])
    await pane.unmount()
  })

  test('lists the checked sections in reply order; a click removes one, the last rows copy or clear', async ($, on) => {
    const copied: string[] = []
    on('ui.copy', (_, e) => {
      copied.push(e.text)
      return { value: { isCopied: true } }
    })
    on('ui.toast', () => ({ value: undefined }))
    on('ui.render', ($, e) => {
      const { Box, Text } = $.ui.resolve(e)
      return e.component === 'AssistantMessage' ? <Text>engine</Text> : <Box />
    })

    const reply = await $.ui.mount({ ...REPLY, surface: 'desktop' })
    await reply.press({ key: 'pick-2' })
    await reply.press({ key: 'pick-1' })
    await reply.press({ key: 'pick-0' })

    const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
    await pane.resize({ columns: 50, rows: 10, in: CARD })
    expect(await cardTexts(pane)).toEqual([
      'Cherrypick',
      'Text',
      'He said:',
      'Quote',
      'keep it simple',
      'Text',
      'So I did.',
      'Copy 3 sections',
      'Clear checks',
    ])

    // Lines 2-3, the first checked section: a click removes it.
    await pane.pointer({ type: 'down', x: 4, y: 2, button: 'left', in: CARD })
    expect(await cardTexts(pane)).toContain('Copy 2 sections')
    expect((await reply.find({ key: 'pick-0' }))?.props.label).toBe('☐')

    // Lines 6-7 now copy them, which clears them.
    await pane.pointer({ type: 'down', x: 4, y: 6, button: 'left', in: CARD })
    expect(copied).toEqual(['> keep it simple\n\nSo I did.'])
    expect(await cardTexts(pane)).toContain('Tick ☐ on a part of a reply to collect it.')

    // Checked again, then cleared from the last row.
    await reply.press({ key: 'pick-1' })
    await pane.pointer({ type: 'down', x: 4, y: 7, button: 'left', in: CARD })
    expect(await cardTexts(pane)).toContain('Tick ☐ on a part of a reply to collect it.')
    expect(copied).toHaveLength(1)
    await pane.unmount()
    await reply.unmount()
  })
})
