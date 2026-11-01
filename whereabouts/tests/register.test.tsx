import { describe, expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

const FOOTER = {
  plugin: 'whereabouts',
  component: 'SessionMode',
  props: { modes: [] },
} as const

const PANE = {
  plugin: 'whereabouts',
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

const PATH = 'C:\\Users\\me\\.claude\\projects\\D--work-app\\0f3c.jsonl'
const FOLDER = 'C:\\Users\\me\\.claude\\projects\\D--work-app'

type On = Parameters<TestBody>[1]
type Drawing = {
  findAll: (q: { type: string }) => Promise<{ text: string; props: Record<string, unknown> }[]>
}
const labelsOf = async (drawing: Drawing) =>
  (await drawing.findAll({ type: 'Button' })).map(button => button.props.label)
const textsOf = async (drawing: Drawing) =>
  (await drawing.findAll({ type: 'Text' })).map(text => text.text)

type Drawn = { props?: Record<string, unknown>; children?: unknown[] }

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

// `ran` collects the commands the mod runs.
function aSession(on: On, path: string | null = PATH, ran: string[][] = []) {
  if (path !== null) {
    on('state.get', { plugin: 'whereabouts', key: 'transcriptPath' }, () => ({
      value: { value: path, version: 1 },
    }))
  }
  on('session.id', () => ({ value: '0f3c' }))
  on('session.cwd', () => ({ value: 'D:\\work\\app' }))
  on('session.root', () => ({ value: 'D:\\work\\app' }))
  on('session.model', () => ({ value: 'Opus 5.5' }))
  on('session.repo', () => ({
    value: { root: 'D:\\work\\app', remote: 'git@github.com:me/app.git', internal: false, name: null },
  }))
  on('clock.now', () => ({ value: 1_000 }))
  on('process.run', (_, e) => {
    ran.push([...e.argv])
    return {
      value: { exitCode: 0, stdout: 'main\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
    }
  })
}

describe('the Mods button', () => {
  test('the footer keeps what others drew there, first, and adds one Mods button', async ($, on) => {
    on('ui.render', ($, e) => {
      const { Button } = $.ui.resolve(e)
      return <Button key="launcher" label="Spinlings" plain onPress={() => {}} />
    })

    const footer = await $.ui.mount({ ...FOOTER, surface: 'desktop' })
    expect(await labelsOf(footer)).toEqual(['Spinlings', 'Mods'])
    await footer.unmount()

    const terminal = await $.ui.mount({ ...FOOTER, surface: 'terminal' })
    expect(await labelsOf(terminal)).toEqual(['Spinlings'])
    await terminal.unmount()
  })

  test('a mod beneath that drew Mods already keeps the only one', async ($, on) => {
    // Beneath: another mod of the collection, which drew the button first.
    on('ui.render', ($, e) => {
      const { Button } = $.ui.resolve(e)
      return <Button key="claude-mods-open" label="Mods" plain onPress={() => {}} />
    })

    const footer = await $.ui.mount({ ...FOOTER, surface: 'desktop' })
    expect(await labelsOf(footer)).toEqual(['Mods'])
    await footer.unmount()
  })

  test('Mods opens the sidebar, and closes it when it is open', async ($, on) => {
    const opened: string[] = []
    const closed: string[] = []
    const open = { now: [] as { id: string }[] }
    on('ui.render', ($, e) => {
      const { Box } = $.ui.resolve(e)
      return <Box />
    })
    on('ui.panes', () => ({
      value: open.now.map(pane => ({ ...pane, title: 'Mods', isShown: true, isFocused: false, isPlaced: true })),
    }))
    on('ui.open', (_, e) => {
      opened.push(e.id)
      return { value: { isPlaced: true } }
    })
    on('ui.close', (_, e) => {
      closed.push(e.id)
      return { value: undefined }
    })

    const footer = await $.ui.mount({ ...FOOTER, surface: 'desktop' })
    await footer.press({ key: 'claude-mods-open' })
    expect(opened).toEqual(['claude-mods'])

    open.now = [{ id: 'claude-mods' }]
    await footer.press({ key: 'claude-mods-open' })
    expect(closed).toEqual(['claude-mods'])
    await footer.unmount()
  })
})

const REGION = 'claude-mods-whereabouts'

type Region = {
  findAll: (q: { type: string; in?: string }) => Promise<{ text: string; props: Record<string, unknown> }[]>
}
const regionTexts = async (pane: Region) =>
  (await pane.findAll({ type: 'Text', in: REGION })).map(text => text.text)

describe('the Whereabouts section', () => {
  test('the sidebar opens on the filter, then a card of where the conversation lives', async ($, on) => {
    aSession(on)
    on('ui.render', ($, e) => {
      const { Box } = $.ui.resolve(e)
      return <Box />
    })

    const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })

    expect(await pane.findAll({ type: 'Input' })).toHaveLength(1)
    expect(await regionTexts(pane)).toEqual([
      'Whereabouts',
      'Transcript',
      PATH,
      'Conversation folder',
      FOLDER,
      'Session ID',
      '0f3c',
      'Working directory',
      'D:\\work\\app',
      'Branch',
      'main',
      'Remote',
      'git@github.com:me/app.git',
      'Model',
      'Opus 5.5',
      'Open the conversation folder',
    ])
    // Two in the header, then each row's icon and the icon at its right edge:
    // seven parts (the project root is the working directory), then Open.
    expect(await pane.findAll({ type: 'Svg', in: REGION })).toHaveLength(2 + 7 * 2 + 2)
    await pane.unmount()
  })

  test('a click anywhere on a row copies its part, and its icon turns to a check', async ($, on) => {
    const copied: string[] = []
    const toasts: string[] = []
    aSession(on)
    on('ui.copy', (_, e) => {
      copied.push(e.text)
      return { value: { isCopied: true } }
    })
    on('ui.toast', (_, e) => {
      toasts.push(e.text)
      return { value: undefined }
    })
    on('ui.render', ($, e) => {
      const { Box } = $.ui.resolve(e)
      return <Box />
    })

    const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
    await pane.resize({ columns: 50, rows: 10, in: REGION })
    const trailingOf = async (row: number) =>
      (await pane.findAll({ type: 'Svg', in: REGION }))[2 + row * 2 + 1]?.props.alt

    // Each row is two lines: the header 0-1, then the Session ID row 6-7.
    // A click on either of its lines, at its label, copies it.
    await pane.pointer({ type: 'down', x: 4, y: 7, button: 'left', in: REGION })
    expect(copied).toEqual(['0f3c'])
    expect(await trailingOf(2)).toBe('check')

    // The Transcript row's copy icon, at the right edge.
    await pane.pointer({ type: 'down', x: 48, y: 2, button: 'left', in: REGION })
    expect(copied).toEqual(['0f3c', PATH])

    await pane.advance(1500)
    expect(await trailingOf(0)).toBe('copy')
    // The icon says it was copied: no toast on top of it.
    expect(toasts).toEqual([])
    await pane.unmount()
  })

  test('the row under the pointer lights as one rounded block; the others stay clear', async ($, on) => {
    aSession(on)
    on('ui.render', ($, e) => {
      const { Box } = $.ui.resolve(e)
      return <Box />
    })

    const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
    await pane.resize({ columns: 50, rows: 20, in: REGION })
    await pane.pointer({ type: 'move', x: 4, y: 7, in: REGION })

    const rowProps = async (key: string) => {
      const found = drawnByKey(await pane.drawn({ in: REGION }), key)
      return found?.props
    }
    expect(await rowProps('session')).toMatchObject({
      borderStyle: 'round',
      borderColor: 'rgba(128, 128, 128, 0.10)',
      backgroundColor: 'rgba(128, 128, 128, 0.10)',
      paddingY: 0,
    })
    const atRest = await rowProps('cwd')
    expect(atRest).toMatchObject({ borderStyle: 'round', borderColor: 'rgba(0, 0, 0, 0)', paddingY: 0 })
    expect(atRest?.backgroundColor).toBeUndefined()

    await pane.pointer({ type: 'leave', x: 4, y: 7, in: REGION })
    expect((await rowProps('session'))?.backgroundColor).toBeUndefined()
    await pane.unmount()
  })

  test('the last row opens the conversation folder', async ($, on) => {
    const ran: string[][] = []
    aSession(on, PATH, ran)
    on('env.get', () => ({ value: 'Windows_NT' }))
    on('ui.render', ($, e) => {
      const { Box } = $.ui.resolve(e)
      return <Box />
    })

    const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
    await pane.resize({ columns: 50, rows: 10, in: REGION })
    // Lines 16-17: the header, seven parts, then Open.
    await pane.pointer({ type: 'down', x: 4, y: 16, button: 'left', in: REGION })

    expect(ran.some(argv => argv[0] === 'powershell.exe')).toBe(true)
    await pane.unmount()
  })

  test('the header folds the section and opens it again', async ($, on) => {
    aSession(on)
    on('ui.render', ($, e) => {
      const { Box } = $.ui.resolve(e)
      return <Box />
    })

    const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
    await pane.pointer({ type: 'down', x: 2, y: 1, button: 'left', in: REGION })
    expect(await regionTexts(pane)).toEqual(['Whereabouts'])
    expect((await pane.find({ type: 'Client' }))?.props.height).toBe(2)

    await pane.pointer({ type: 'down', x: 2, y: 0, button: 'left', in: REGION })
    expect(await regionTexts(pane)).toContain('Session ID')
    await pane.unmount()
  })

  test('the arrow keys walk the rows and Enter acts on one', async ($, on) => {
    const copied: string[] = []
    aSession(on)
    on('ui.copy', (_, e) => {
      copied.push(e.text)
      return { value: { isCopied: true } }
    })
    on('ui.render', ($, e) => {
      const { Box } = $.ui.resolve(e)
      return <Box />
    })

    const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
    await pane.key({ key: 'down', in: REGION })
    await pane.key({ key: 'down', in: REGION })
    await pane.key({ key: 'return', in: REGION })
    expect(copied).toEqual([PATH])
    await pane.unmount()
  })

  test('typing in the filter keeps only the rows it matches', async ($, on) => {
    aSession(on)
    on('ui.render', ($, e) => {
      const { Box } = $.ui.resolve(e)
      return <Box />
    })

    const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
    await pane.input({ key: 'claude-mods-filter', text: 'Branch', kind: 'change' })
    expect(await regionTexts(pane)).toEqual(['Whereabouts', 'Branch', 'main'])

    await pane.input({ key: 'claude-mods-filter', text: 'nothing like it', kind: 'change' })
    expect(await pane.find({ type: 'Client' })).toBeUndefined()
    await pane.unmount()
  })

  test('a mod beneath heads the sidebar; this card goes after its own, under one filter', async ($, on) => {
    aSession(on)
    // Beneath: another mod of the collection, the lowest, with the filter and its section.
    on('ui.render', ($, e) => {
      const table = $.ui.resolve(e)
      if (!('Input' in table)) return <table.Box />
      const { Box, Input, Text } = table
      return (
        <Box flexDirection="column">
          <Input key="claude-mods-filter" placeholder="Filter" onSubmit={() => {}} />
          <Text>Cherrypick</Text>
        </Box>
      )
    })

    const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
    expect(await pane.findAll({ type: 'Input' })).toHaveLength(1)
    const drawn = JSON.stringify(await pane.drawn())
    expect(drawn.indexOf('Cherrypick')).toBeLessThan(drawn.indexOf(REGION))
    await pane.unmount()
  })

  test('before the path is known, the card says when it will be', async ($, on) => {
    aSession(on, null)
    on('ui.render', ($, e) => {
      const { Box } = $.ui.resolve(e)
      return <Box />
    })

    const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
    const texts = await regionTexts(pane)
    expect(texts).toContain("The transcript's path comes with your next prompt.")
    expect(texts).not.toContain('Transcript')
    await pane.unmount()
  })
})

describe('/transcript', () => {
  test('copies the path and puts nothing in the conversation', async ($, on) => {
    const copied: string[] = []
    on('ui.copy', (_, e) => {
      copied.push(e.text)
      return { value: { isCopied: true } }
    })
    on('ui.toast', () => ({ value: undefined }))
    on('classic.UserPromptSubmit', () => ({})) // no settings hook beneath

    await $.classic.UserPromptSubmit({ prompt: 'hi', transcript_path: PATH })
    const result = await $.command.run({
      command: 'transcript',
      args: '',
      origin: { kind: 'composer' },
      presentation: { isFullscreen: false, columns: 120 },
    })

    expect(result).toEqual({})
    expect(copied).toEqual([PATH])
  })

  test("a subagent's prompt does not replace the conversation's path", async ($, on) => {
    const copied: string[] = []
    on('ui.copy', (_, e) => {
      copied.push(e.text)
      return { value: { isCopied: true } }
    })
    on('ui.toast', () => ({ value: undefined }))
    on('classic.UserPromptSubmit', () => ({})) // no settings hook beneath

    await $.classic.UserPromptSubmit({ prompt: 'hi', transcript_path: PATH })
    await $.classic.UserPromptSubmit({
      prompt: 'sub',
      transcript_path: 'C:\\elsewhere\\agent.jsonl',
      agent_id: 'a1',
    })
    await $.command.run({
      command: 'transcript',
      args: '',
      origin: { kind: 'composer' },
      presentation: { isFullscreen: false, columns: 120 },
    })

    expect(copied).toEqual([PATH])
  })

  test('says when the path is not known yet, and copies nothing', async ($, on) => {
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

    await $.command.run({
      command: 'transcript',
      args: '',
      origin: { kind: 'composer' },
      presentation: { isFullscreen: false, columns: 120 },
    })

    expect(copied).toEqual([])
    expect(toasts).toEqual(["The transcript's path is known from your next prompt"])
  })
})
