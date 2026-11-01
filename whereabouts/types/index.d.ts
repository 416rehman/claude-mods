declare module 'claude-code' {
  interface PluginState {
    whereabouts: {
      /** The main conversation's transcript, not a subagent's. */
      transcriptPath: string | null
    }
  }
}
