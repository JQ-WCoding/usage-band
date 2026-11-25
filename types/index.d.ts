export type Usage = {
  tokens?: number
  window: number
  percent?: number
  /** Token count at which auto-compaction runs; null when it is off, undefined while unknown. */
  compactAt?: number | null
  limits: { kind: string; percentUsed: number; resetsAt?: string }[]
}

declare module 'claude-code' {
  interface PluginState {
    'usage-band': { usage: Usage | null }
  }
}
