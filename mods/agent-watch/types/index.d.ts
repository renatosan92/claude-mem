export type AgentRow = {
  id: string
  /** The Agent call's short description, or 'Main thread'. */
  description: string
  type: string
  status: string
  /** The tool it runs right now, with what it acts on. */
  current?: string
  /** The last few things it did, newest last. */
  recent: string[]
  toolCount: number
  startedAt: number
  updatedAt: number
}

declare module 'claude-code' {
  interface PluginState {
    'agent-watch': { agents: Shaped<AgentRow[]> }
  }
}
