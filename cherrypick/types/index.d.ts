export type CherrypickPick = {
  /** The reply's render requestId. */
  message: string
  index: number
  /** When its reply was first picked from, so a copy keeps replies in order. */
  messageOrder: number
  /** A SectionKind. A copy drops markers only when every pick is one kind. */
  kind: string
  markdown: string
  plain: string
}

declare module 'claude-code' {
  interface PluginState {
    cherrypick: {
      picks: Shaped<CherrypickPick[]>
    }
  }
}
