import { expect, mock, test } from 'claude-code/testing'
import type { AgentInfo } from 'claude-code'

const PANE = {
  plugin: 'agent-watch',
  component: 'Pane',
  requestId: 'agent-watch',
  props: {
    title: 'Agents',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const SURFACES = ['terminal', 'desktop', 'vscode', 'mobile'] as const

test('a running agent shows its current tool on every surface', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  let listed: AgentInfo[] = [
    { id: 'a1', description: 'Fix login bug', type: 'general-purpose', status: 'running' },
  ]
  const viewed: unknown[] = []
  on('command.register', () => ({ value: { command: 'agent-watch' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.view', (_, e) => (viewed.push(e), { value: {} }))
  on('agent.list', () => ({ value: listed }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  // The Bash call holds still while we look at the pane.
  let release!: () => void
  const held = new Promise<void>(r => (release = r))
  on('tool.call', async (_, e) => {
    if (e.tool === 'Bash') await held
    return { result: {} }
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  // The 2s poll finds the agent the engine lists.
  await clock.advance(2000)
  await $.tool.call({ tool: 'Read', file_path: '/repo/src/login.ts', agentId: 'a1' })
  const running = $.tool.call({ tool: 'Bash', command: 'npm test', agentId: 'a1' })
  await clock.advance(5000)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /running ·/ }))?.text).toBe('1 running · 0 finished')
    expect((await ui.find({ type: 'Text', text: /Fix login bug/ }))?.text).toBe('Fix login bug')
    expect((await ui.find({ type: 'Text', text: /2 tools/ }))?.text).toBe(
      'general-purpose · running · 2 tools · 5s',
    )
    expect((await ui.find({ type: 'Text', text: /▸/ }))?.text).toContain('▸ Bash npm test')
    expect((await ui.find({ type: 'Text', text: /Read login\.ts/ }))?.text).toContain('Read login.ts')
    await ui.unmount()
  }

  // View transcript switches the main view to the agent.
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'view-a1' })
  expect(viewed).toEqual([expect.objectContaining({ agentId: 'a1' })])
  await ui.unmount()

  release()
  await running

  // The agent finishes: the next poll moves it to Finished.
  listed = [{ ...listed[0]!, status: 'completed' }]
  await clock.advance(2000)
  const after = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await after.find({ type: 'Text', text: /running ·/ }))?.text).toBe('0 running · 1 finished')
  expect((await after.find({ type: 'Text', text: /^Finished$/ }))?.text).toBe('Finished')
  expect((await after.find({ type: 'Text', text: /completed/ }))?.text).toContain('completed · 2 tools')
  await after.unmount()
})

test('the main thread line follows main-loop tool calls', async ($, on) => {
  mock.clock(on)
  on('tool.call', () => ({ result: {} }))
  await $.tool.call({ tool: 'Grep', pattern: 'TODO' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /^Main:/ }))?.text).toBe('Main: idle (1 tools)')
  expect((await ui.find({ type: 'Text', text: /No agents/ }))?.text).toBe('No agents running right now.')
  await ui.unmount()
})

test('rows an older version stored are declined', async ($, on) => {
  mock.clock(on)
  on('state.get', () => ({ value: { value: [{ bogus: true }], version: 1 } }))
  const ui = await $.ui.mount({ ...PANE, surface: 'mobile' })
  expect((await ui.find({ type: 'Text', text: /No agents/ }))?.text).toBe('No agents running right now.')
  await ui.unmount()
})
