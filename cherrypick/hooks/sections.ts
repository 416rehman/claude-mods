export type SectionKind = 'quote' | 'code' | 'heading' | 'rule' | 'text'

export type Section = {
  kind: SectionKind
  markdown: string
  /** Without its markers (`>`, fences, `#`); null when nothing is left to copy. */
  plain: string | null
}

type Run = {
  kind: SectionKind
  start: number
  end: number
  isClosed?: boolean
}

const OPENING_FENCE = /^ {0,3}(`{3,}|~{3,})/
const CLOSING_FENCE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/
const QUOTE = /^>/
const QUOTE_MARKER = /^ {0,3}> ?/
const HEADING_OPEN = /^ {0,3}#{1,6}(?:[ \t]+|$)/
const HEADING_CLOSE = /[ \t]+#+[ \t]*$/
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/
const BLANK = /^[ \t]*$/
const INDENTED = /^[ \t]/

/**
 * Joining the sections' markdown with blank lines gives back the reply, so
 * drawing them one after another draws the reply. An indented block stays with
 * the block above it: drawn alone, it would become a code block.
 */
export function splitSections(source: string): Section[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const runs: Run[] = []
  let open: Run | null = null
  let fence: { char: string; length: number } | null = null

  const close = () => {
    if (open !== null) {
      runs.push(open)
      open = null
    }
  }

  lines.forEach((line, i) => {
    if (fence !== null && open !== null) {
      open.end = i
      const closing = CLOSING_FENCE.exec(line)?.[1]
      if (
        closing !== undefined &&
        closing.charAt(0) === fence.char &&
        closing.length >= fence.length
      ) {
        open.isClosed = true
        fence = null
        close()
      }
      return
    }

    const opening = OPENING_FENCE.exec(line)?.[1]
    if (opening !== undefined) {
      close()
      fence = { char: opening.charAt(0), length: opening.length }
      open = { kind: 'code', start: i, end: i }
      return
    }

    if (BLANK.test(line)) {
      close()
      return
    }

    if (QUOTE.test(line)) {
      if (open?.kind === 'quote') {
        open.end = i
      } else {
        close()
        open = { kind: 'quote', start: i, end: i }
      }
      return
    }

    if (HEADING_OPEN.test(line)) {
      close()
      runs.push({ kind: 'heading', start: i, end: i })
      return
    }

    if (open === null) {
      if (RULE.test(line)) {
        runs.push({ kind: 'rule', start: i, end: i })
      } else {
        open = { kind: 'text', start: i, end: i }
      }
      return
    }

    // Markdown lets a quoted paragraph's later lines drop the `>`.
    open.end = i
  })
  close()

  const merged: Run[] = []
  for (const run of runs) {
    const previous = merged.at(-1)
    const joins =
      previous !== undefined &&
      previous.kind !== 'heading' &&
      previous.kind !== 'rule' &&
      INDENTED.test(lines[run.start] ?? '')
    if (joins) {
      previous.end = run.end
      previous.kind = 'text'
      continue
    }
    merged.push(run)
  }

  const slice = (start: number, end: number) =>
    lines.slice(start, end + 1).join('\n').replace(/\s+$/, '')

  return merged.map(run => {
    const markdown = slice(run.start, run.end)
    return { kind: run.kind, markdown, plain: nonEmpty(plainOf(run, markdown)) }
  })

  function plainOf(run: Run, markdown: string): string | null {
    switch (run.kind) {
      case 'rule':
        return null
      case 'quote':
        return lines
          .slice(run.start, run.end + 1)
          .map(line => line.replace(QUOTE_MARKER, ''))
          .join('\n')
          .replace(/^\n+|\s+$/g, '')
      case 'code':
        return lines
          .slice(run.start + 1, run.isClosed ? run.end : run.end + 1)
          .join('\n')
          .replace(/\s+$/, '')
      case 'heading':
        return markdown.replace(HEADING_OPEN, '').replace(HEADING_CLOSE, '').trim()
      case 'text':
        return markdown
    }
  }
}

function nonEmpty(text: string | null): string | null {
  return text === null || text.trim() === '' ? null : text
}
