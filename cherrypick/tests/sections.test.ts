import { describe, expect, test } from 'claude-code/testing'

import { splitSections } from '../hooks/sections'

const kinds = (text: string) => splitSections(text).map(section => section.kind)
const copies = (text: string) => splitSections(text).map(section => section.plain)

describe('splitSections', () => {
  test('a quote copies without its markers, apart from the text around it', () => {
    const reply = 'He wrote:\n> first line\n> second line\n\nThen left.'

    expect(kinds(reply)).toEqual(['text', 'quote', 'text'])
    expect(copies(reply)).toEqual([
      'He wrote:',
      'first line\nsecond line',
      'Then left.',
    ])
  })

  test('a quote keeps a nested quote and its empty marker lines', () => {
    const reply = '> outer\n>\n> > inner'

    expect(copies(reply)).toEqual(['outer\n\n> inner'])
  })

  test('two quotes a blank line apart are two sections', () => {
    expect(kinds('> one\n\n> two')).toEqual(['quote', 'quote'])
  })

  test('a line right after a quote lazily continues it', () => {
    const [quote] = splitSections('> starts here\nand carries on')

    expect(quote?.kind).toBe('quote')
    expect(quote?.plain).toBe('starts here\nand carries on')
  })

  test('blank lines split text into paragraphs', () => {
    expect(copies('One.\nStill one.\n\nTwo.\n\n\nThree.')).toEqual([
      'One.\nStill one.',
      'Two.',
      'Three.',
    ])
  })

  test('a code fence keeps its blank lines and copies only the code', () => {
    const reply = 'Run:\n```bash\nnpm ci\n\nnpm test\n```\nDone.'
    const sections = splitSections(reply)

    expect(sections.map(section => section.kind)).toEqual(['text', 'code', 'text'])
    expect(sections[1]?.plain).toBe('npm ci\n\nnpm test')
    expect(sections[1]?.markdown).toBe('```bash\nnpm ci\n\nnpm test\n```')
  })

  test('a fence closes only on a marker as long as the one that opened it', () => {
    const reply = '````md\n```js\nx\n```\n````'

    expect(copies(reply)).toEqual(['```js\nx\n```'])
  })

  test('a quote marker inside a code fence is code', () => {
    expect(kinds('```\n> not a quote\n```')).toEqual(['code'])
  })

  test('a fence still streaming copies what has arrived', () => {
    expect(copies('```py\nprint(1)\n')).toEqual(['print(1)'])
  })

  test('a heading is its own section, copied without its marks', () => {
    const reply = '## Setup ##\nInstall it.\n\n# C#\n\n### Windows'
    const sections = splitSections(reply)

    expect(sections.map(section => section.kind)).toEqual([
      'heading',
      'text',
      'heading',
      'heading',
    ])
    expect(sections.map(section => section.plain)).toEqual([
      'Setup',
      'Install it.',
      'C#',
      'Windows',
    ])
    expect(sections[0]?.markdown).toBe('## Setup ##')
  })

  test('an indented block stays with the list item above it', () => {
    const reply = '- item\n\n  more about the item\n\n- next item'

    expect(copies(reply)).toEqual(['- item\n\n  more about the item', '- next item'])
  })

  test('a rule draws and has nothing to copy', () => {
    const sections = splitSections('Above.\n\n---\n\nBelow.')

    expect(sections.map(section => section.kind)).toEqual(['text', 'rule', 'text'])
    expect(sections[1]?.plain).toBeNull()
  })

  test('every line of the reply is drawn once, in order', () => {
    const reply =
      '# Title\n\nIntro.\n> quoted\n\n```\ncode\n\nmore\n```\n\n- a\n\n  b\n\n---\nEnd.'
    const written = (text: string) => text.split('\n').filter(line => line.trim() !== '')
    const drawn = splitSections(reply).flatMap(section => written(section.markdown))

    expect(drawn).toEqual(written(reply))
  })

  test('Windows line endings split the same as Unix ones', () => {
    expect(copies('> a\r\n\r\nb')).toEqual(['a', 'b'])
  })

  test('an empty reply has no sections', () => {
    expect(splitSections('')).toEqual([])
    expect(splitSections('\n\n')).toEqual([])
  })
})
