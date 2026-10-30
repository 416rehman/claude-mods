/** One section the person checked, in both of the forms a copy can take. */
export type CopyKitPick = {
  /** The reply block it is in (the render site's requestId). */
  message: string
  /** Its place among the block's sections. */
  index: number
  /** The order its reply block was first picked from, so copies follow the reply. */
  messageOrder: number
  /** `quote`, `code`, `heading` or `text`: copies of one kind drop the markers. */
  kind: string
  /** As the reply wrote it, markers and all. */
  markdown: string
  /** Without its quote marker, code fences or heading marks. */
  plain: string
}

declare module 'claude-code' {
  interface PluginState {
    'copy-kit': {
      /** The main conversation's transcript file, absolute; null until known. */
      transcriptPath: string | null
      /** The checked sections, in the order they were checked. */
      picks: Shaped<CopyKitPick[]>
    }
  }
}
