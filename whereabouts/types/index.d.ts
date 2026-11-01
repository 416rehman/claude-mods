declare module 'claude-code' {
  interface PluginState {
    whereabouts: {
      /** The main conversation's transcript file, absolute; null until known. */
      transcriptPath: string | null
    }
  }
}
