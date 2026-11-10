import { atom, read, update } from 'claude-code'
import type { AgentInfo, EngineInterface, Register } from 'claude-code'

import type { AgentRow } from '../types'

const PANE = 'agent-watch'
const TITLE = 'Agents'
const MAIN = 'main'
const RECENT = 4

// Bump the tag when AgentRow changes: it declines rows an older version stored.
const agents = atom({ plugin: 'agent-watch', key: 'agents' } as const, [], {
  shape: 'agents-1',
})

const ACTIVE = new Set(['pending', 'running', 'waiting'])

function clip(text: string, max = 60): string {
  const one = text.replace(/\s+/g, ' ').trim()
  return one.length > max ? one.slice(0, max - 1) + '…' : one
}

function base(path: string): string {
  return path.split('/').filter(Boolean).pop() ?? path
}

/** One line saying what a tool call acts on: `Bash npm test`, `Read app.ts`. */
export function describeCall(e: Record<string, unknown>): string {
  const tool = String(e.tool)
  const s = (k: string) => (typeof e[k] === 'string' ? (e[k] as string) : '')
  let what = ''
  if (s('command')) what = s('command')
  else if (s('file_path')) what = base(s('file_path'))
  else if (s('notebook_path')) what = base(s('notebook_path'))
  else if (s('pattern')) what = s('pattern')
  else if (s('url')) what = s('url')
  else if (s('query')) what = s('query')
  else if (s('description')) what = s('description')
  else if (s('prompt')) what = s('prompt')
  const name = tool.startsWith('mcp__') ? tool.split('__').slice(1).join(':') : tool
  return clip(what ? `${name} ${what}` : name)
}

function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h${m % 60}m`
}

function blank(id: string, now: number, from?: Partial<AgentRow>): AgentRow {
  return {
    id,
    description: id === MAIN ? 'Main thread' : 'Agent',
    type: id === MAIN ? 'main' : 'agent',
    status: 'running',
    recent: [],
    toolCount: 0,
    startedAt: now,
    updatedAt: now,
    ...from,
  }
}

/** Folds `$.agent.list()` into the rows: new agents appear, statuses follow. */
export function mergeList(rows: AgentRow[], list: AgentInfo[], now: number): AgentRow[] {
  const out = rows.map(r => ({ ...r }))
  for (const a of list) {
    const row = out.find(r => r.id === a.id)
    const fields = {
      description: a.description || a.name || 'Agent',
      type: a.type,
      status: a.status,
    }
    if (row) {
      const changed = row.status !== a.status
      Object.assign(row, fields)
      if (!ACTIVE.has(a.status)) row.current = undefined
      if (changed) row.updatedAt = now
    } else {
      out.push(blank(a.id, now, fields))
    }
  }
  // An agent the engine dropped from its list has finished.
  for (const row of out) {
    if (row.id !== MAIN && ACTIVE.has(row.status) && !list.some(a => a.id === row.id)) {
      row.status = 'completed'
      row.current = undefined
      row.updatedAt = now
    }
  }
  return out.slice(-50)
}

/** Runs bookkeeping that must never break the call it watches. */
async function safe(fn: () => Promise<void>): Promise<void> {
  try {
    await fn()
  } catch {
    // The pane misses one update; the agent's work goes on.
  }
}

async function refresh($: EngineInterface): Promise<void> {
  try {
    const list = await $.agent.list()
    const now = await $.clock.now()
    await update($, agents, rows => mergeList(rows, list, now))
  } catch {
    // A list that fails this tick is asked again on the next.
  }
}

export const register: Register = on => {
  let stopPoll: (() => void) | undefined

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'agent-watch',
      description: 'Show what your agents are working on, live',
    })
    void $.ui.open({ id: PANE, title: TITLE })
    stopPoll?.()
    const timer = $.clock.every(2000, () => void refresh($))
    stopPoll = () => timer.cancel()

    return next(e)
  })

  on('command.run', { command: 'agent-watch' }, async ($, e) => {
    await refresh($)
    await $.ui.open({ id: PANE, title: TITLE })
    const rows = await read($, agents)
    const live = rows.filter(r => r.id !== MAIN && ACTIVE.has(r.status)).length

    return { text: `Agents pane opened: ${live} running.` }
  })

  on('agent.spawn', async ($, e, next) => {
    const ran = await next(e)
    const id = (ran as { agentId?: string }).agentId
    if (id)
      await safe(async () => {
        const now = await $.clock.now()
        await update($, agents, rows =>
          rows.some(r => r.id === id)
            ? rows
            : [
                ...rows,
                blank(id, now, {
                  description: e.description || 'Agent',
                  type: e.subagentType || 'general-purpose',
                }),
              ].slice(-50),
        )
      })
    return ran
  })

  on('tool.call', async ($, e, next) => {
    const id = e.agentId ?? MAIN
    const line = describeCall(e as unknown as Record<string, unknown>)
    await safe(async () => {
      const now = await $.clock.now()
      await update($, agents, rows => {
        const has = rows.some(r => r.id === id)
        const list = has ? rows : [...rows, blank(id, now)]
        return list.map(r =>
          r.id === id
            ? {
                ...r,
                status: ACTIVE.has(r.status) ? r.status : 'running',
                current: line,
                recent: [...r.recent, line].slice(-RECENT),
                toolCount: r.toolCount + 1,
                updatedAt: now,
              }
            : r,
        )
      })
    })
    try {
      return await next(e)
    } finally {
      await safe(async () => {
        const done = await $.clock.now()
        await update($, agents, rows =>
          rows.map(r =>
            r.id === id && r.current === line ? { ...r, current: undefined, updatedAt: done } : r,
          ),
        )
      })
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const rows = await read($, agents)
    const now = await $.clock.now()
    const subs = rows.filter(r => r.id !== MAIN)
    const main = rows.find(r => r.id === MAIN)
    const live = subs.filter(r => ACTIVE.has(r.status))
    const done = subs
      .filter(r => !ACTIVE.has(r.status))
      .slice(-8)
      .reverse()

    const icon = (s: string) =>
      s === 'failed' || s === 'killed' ? '✗' : ACTIVE.has(s) ? '●' : s === 'idle' ? '◌' : '✓'
    const color = (s: string) =>
      s === 'failed' || s === 'killed' ? 'red' : ACTIVE.has(s) ? 'green' : undefined

    const card = (r: AgentRow, isLive: boolean) => (
      <Box flexDirection="column" marginBottom={isLive ? 1 : 0}>
        <Box flexDirection="row" gap={1}>
          <Text color={color(r.status)}>{icon(r.status)}</Text>
          <Text bold={isLive} dimColor={!isLive}>
            {clip(r.description, 40)}
          </Text>
          <Text dimColor>
            {r.type} · {r.status} · {r.toolCount} tools · {ago(now - r.startedAt)}
          </Text>
        </Box>
        {isLive && (
          <Text color="cyan">
            {'  '}
            {r.current ? `▸ ${r.current}` : `thinking… (${ago(now - r.updatedAt)})`}
          </Text>
        )}
        {isLive &&
          r.recent
            .slice(0, r.current ? -1 : undefined)
            .slice(-3)
            .map(line => (
              <Text dimColor>
                {'    '}
                {line}
              </Text>
            ))}
        {isLive && (
          <Button
            key={`view-${r.id}`}
            label="View transcript"
            onPress={async () => {
              await $.ui.view({ agentId: r.id })
            }}
          />
        )}
      </Box>
    )

    return (
      <Box flexDirection="column">
        <Text bold>
          {live.length} running · {done.length} finished
        </Text>
        {main && (
          <Text dimColor>
            Main: {main.current ? main.current : 'idle'} ({main.toolCount} tools)
          </Text>
        )}
        <Text> </Text>
        {live.length === 0 && <Text dimColor>No agents running right now.</Text>}
        {live.map(r => card(r, true))}
        {done.length > 0 && <Text bold>Finished</Text>}
        {done.map(r => card(r, false))}
      </Box>
    )
  })
}
