# agent-watch

A live **Agents** pane beside the chat that shows what every agent in your session is working on.

- Each running subagent gets a card: its description, type, status, how many tools it has used, how long it has run, the tool it is running right now (`▸ Bash npm test`, `▸ Read app.ts`), and its last few actions.
- A **View transcript** button switches the main view to that agent.
- Finished and failed agents move to a "Finished" list.
- The top line shows what the main thread is doing.

Open it with `/agent-watch`; it also opens when the session starts. It refreshes every 2 seconds from the engine's agent list and on every tool call.

## Install

At the prompt of a terminal session:

```
/plugin install agent-watch --marketplace renatosan92/claude-mem
```

From a shell:

```
claude plugin install agent-watch --marketplace renatosan92/claude-mem
```

In the desktop app: click + next to the prompt box, then Plugins, Add marketplace with `renatosan92/claude-mem`, then Add plugin.

## Develop

```
claude plugin validate mods/agent-watch
claude plugin test mods/agent-watch
```
