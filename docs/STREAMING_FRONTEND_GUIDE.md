# Streaming Agent Frontend Guide

A complete reference for building a React frontend that matches the real-time responsiveness of Claude Code — every intermediate step visible as it happens, styled like a terminal without being one.

---

## Table of Contents

1. [How the streaming pipeline works](#1-how-the-streaming-pipeline-works)
2. [The message stream — every type explained](#2-the-message-stream--every-type-explained)
3. [Connecting your React frontend via WebSocket](#3-connecting-your-react-frontend-via-websocket)
4. [React state design](#4-react-state-design)
5. [Terminal-inspired UI design](#5-terminal-inspired-ui-design)
6. [Component architecture](#6-component-architecture)
7. [Rendering each message type](#7-rendering-each-message-type)
8. [Handling streaming text (token by token)](#8-handling-streaming-text-token-by-token)
9. [The spinner verb — "Reticulating…"](#9-the-spinner-verb--reticulating)
10. [UX patterns to nail the feel](#10-ux-patterns-to-nail-the-feel)

---

## 1. How the streaming pipeline works

The engine is built around **async generators** — functions that `yield` values continuously instead of returning once at the end. Nothing is buffered. Every event comes out the moment it happens.

```
User submits prompt
        │
        ▼
  QueryEngine.submitMessage()          ← AsyncGenerator<SDKMessage>
        │
        ├─ yields system/init          ← session metadata, tools list
        │
        └─ calls query()              ← AsyncGenerator (inner loop)
                │
                ├─ yields stream_request_start
                │
                ├─ streams model tokens ──► yields assistant messages (partial)
                │
                ├─ model calls a tool ──► yields user messages (tool input)
                │
                ├─ tool executes ──────► yields tool_progress / user (result)
                │
                ├─ tool_use_summary ───► yields Haiku summary of what just ran
                │
                └─ loop again (if more tools)
                        │
                        ▼
                  yields result       ← final message, signals turn is done
```

Every `yield` in the generator becomes a **WebSocket message pushed to the frontend**. The frontend does not poll — it receives. The agent is constantly talking.

### The key files

| File | Role |
|---|---|
| `query.ts` | The core loop — yields every event as it happens |
| `QueryEngine.ts` | Wraps `query()` into typed `SDKMessage` values, manages session state |
| `remote/RemoteSessionManager.ts` | **Client-side bridge** — WebSocket → `onMessage` callbacks |
| `remote/SessionsWebSocket.ts` | WebSocket transport with auth, reconnect, ping |
| `entrypoints/sdk/coreSchemas.ts` | Zod schemas defining every SDKMessage type |

---

## 2. The message stream — every type explained

All messages share `{ type, uuid, session_id }`. The `type` field is your switch key.

### `system` (subtype: `init`)
The very first message. Arrive before any model call. Contains session metadata.

```ts
{
  type: 'system',
  subtype: 'init',
  model: 'claude-opus-4-7',
  tools: ['Bash', 'Read', 'Edit', 'Write', ...],
  cwd: '/home/user/project',
  permissionMode: 'default',
  claude_code_version: '...',
  session_id: '...',
  uuid: '...'
}
```

**UI use:** Show a session header — model name, cwd, tool list. Signals "agent is ready."

---

### `system` (subtype: `status`)
Live status updates during execution.

```ts
{
  type: 'system',
  subtype: 'status',
  status: 'compacting' | null,   // null = idle
  permissionMode: 'default' | 'acceptEdits' | 'plan' | ...
}
```

**UI use:** A small status badge. Show a spinner when `status === 'compacting'`.

---

### `assistant`
A complete content block from the model — text, tool call, or thinking block. Arrives **after** the block finishes streaming (see `stream_event` for token-by-token).

```ts
{
  type: 'assistant',
  message: {
    role: 'assistant',
    content: [
      { type: 'text', text: 'I will read the file first...' },
      // or:
      { type: 'tool_use', id: 'tu_abc', name: 'Read', input: { file_path: '/src/app.ts' } },
      // or:
      { type: 'thinking', thinking: '...' }
    ],
    stop_reason: 'tool_use' | 'end_turn' | null
  },
  parent_tool_use_id: null | string,  // non-null inside a subagent
  uuid: '...'
}
```

**UI use:** Render each content block. Text → markdown bubble. Tool call → a "running tool" row. Thinking → collapsible details block.

---

### `stream_event`
Raw token-by-token streaming events from the Anthropic API. Only emitted when `includePartialMessages: true`. This is what makes text appear letter-by-letter.

```ts
{
  type: 'stream_event',
  event: {
    type: 'content_block_delta',
    delta: { type: 'text_delta', text: 'I will ' }
  }
}
// also: message_start, content_block_start, content_block_stop, message_delta, message_stop
```

**UI use:** Append `delta.text` to the current streaming buffer. Replace with the final `assistant` message when `content_block_stop` arrives. This is how you get the typewriter effect.

---

### `user`
Tool results returning to the model — what the tool actually produced.

```ts
{
  type: 'user',
  message: {
    role: 'user',
    content: [
      {
        type: 'tool_result',
        tool_use_id: 'tu_abc',
        content: 'export function App() { ... }'
      }
    ]
  },
  tool_use_result: '...',    // stringified for display
  isSynthetic: boolean
}
```

**UI use:** Update the corresponding tool row — show result preview, mark as done. Collapse long results behind a "Show output" toggle.

---

### `tool_use_summary`
A Haiku-generated one-line summary of what the last batch of tools did. Arrives **after** tools finish, while the next model call is already in flight.

```ts
{
  type: 'tool_use_summary',
  summary: 'Read 3 files, wrote 1 file, ran 2 bash commands',
  preceding_tool_use_ids: ['tu_abc', 'tu_def', 'tu_ghi'],
  uuid: '...'
}
```

**UI use:** Show as a dim annotation below the tool rows for that batch. Perfect for collapsing verbose tool output into a single line.

---

### `tool_progress`
Heartbeat while a long-running tool (Bash, Agent) is still executing.

```ts
{
  type: 'tool_progress',
  tool_use_id: 'tu_abc',
  tool_name: 'Bash',
  elapsed_time_seconds: 4.2,
  task_id: 'optional-task-id'
}
```

**UI use:** A live timer/spinner next to the running tool row. `elapsed_time_seconds` lets you show "running for 4s..."

---

### `system` (subtype: `task_started` / `task_progress` / `task_notification`)
Lifecycle events for background agent tasks (subagents spun up by the AgentTool).

```ts
// task_started
{ type: 'system', subtype: 'task_started', task_id: '...', description: 'Fixing auth bug', prompt: '...' }

// task_progress (periodic updates)
{ type: 'system', subtype: 'task_progress', task_id: '...', description: '...', last_tool_name: 'Edit', usage: { tool_uses: 5, duration_ms: 12000 } }

// task_notification (done)
{ type: 'system', subtype: 'task_notification', task_id: '...', status: 'completed', summary: 'Fixed the auth bug in middleware.ts' }
```

**UI use:** Render subagents as nested, indented sessions. Show progress inline. A `task_notification` collapses the subagent row.

---

### `system` (subtype: `api_retry`)
The API failed with a retryable error (rate limit, timeout) and will retry.

```ts
{
  type: 'system',
  subtype: 'api_retry',
  attempt: 1,
  max_retries: 3,
  retry_delay_ms: 2000,
  error_status: 429,
  error: 'rate_limit'
}
```

**UI use:** Show a yellow warning row: "Rate limited, retrying in 2s (1/3)". Auto-dismiss when the next `assistant` arrives.

---

### `system` (subtype: `compact_boundary`)
The context was compacted (summarized) to free space. History before this point was replaced with a summary.

```ts
{
  type: 'system',
  subtype: 'compact_boundary',
  compact_metadata: { trigger: 'auto' | 'manual', pre_tokens: 180000, ... }
}
```

**UI use:** A horizontal rule with "Context compacted automatically — earlier history summarized." The chat doesn't break; it just continues.

---

### `system` (subtype: `session_state_changed`)
Authoritative signal that the agent turn is over and the session returned to idle.

```ts
{
  type: 'system',
  subtype: 'session_state_changed',
  state: 'idle' | 'running' | 'requires_action'
}
```

**UI use:** Re-enable the input box when `state === 'idle'`. Block it and show a "thinking..." indicator when `state === 'running'`.

---

### `result`
The final message of every turn. Always the last thing emitted.

```ts
// success
{
  type: 'result',
  subtype: 'success',
  result: 'The bug has been fixed...',
  duration_ms: 14230,
  total_cost_usd: 0.0087,
  num_turns: 6,
  usage: { input_tokens: 12400, output_tokens: 890, ... }
}

// error
{
  type: 'result',
  subtype: 'error_during_execution' | 'error_max_turns' | 'error_max_budget_usd',
  is_error: true,
  errors: ['...diagnostic message...']
}
```

**UI use:** Show cost/duration as a dim footer on the last bubble. Re-enable input. On error, show a red inline error block.

---

## 3. Connecting your React frontend via WebSocket

The pattern is from `remote/RemoteSessionManager.ts`. Adapt it for the browser:

```ts
// useAgentSession.ts
import { useEffect, useRef, useCallback } from 'react'

const WS_URL = 'wss://your-server/v1/sessions/ws/{sessionId}/subscribe'

export function useAgentSession(sessionId: string, onMessage: (msg: SDKMessage) => void) {
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectAttempts = useRef(0)
  const MAX_RECONNECT = 5

  const connect = useCallback(() => {
    const ws = new WebSocket(`${WS_URL.replace('{sessionId}', sessionId)}`)
    wsRef.current = ws

    ws.onopen = () => {
      reconnectAttempts.current = 0
      // Send auth immediately after open
      ws.send(JSON.stringify({
        type: 'auth',
        credential: { type: 'oauth', token: getAccessToken() }
      }))
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        if (typeof msg?.type === 'string') {
          onMessage(msg as SDKMessage)
        }
      } catch { /* malformed frame — ignore */ }
    }

    ws.onclose = (event) => {
      const PERMANENT_CLOSE_CODES = new Set([4003]) // unauthorized
      if (PERMANENT_CLOSE_CODES.has(event.code)) return

      if (reconnectAttempts.current < MAX_RECONNECT) {
        reconnectAttempts.current++
        setTimeout(connect, 2000)
      }
    }

    ws.onerror = (error) => console.error('[AgentSession] WebSocket error', error)
  }, [sessionId, onMessage])

  useEffect(() => {
    connect()
    return () => wsRef.current?.close()
  }, [connect])

  const sendMessage = useCallback(async (content: string) => {
    // POST to HTTP endpoint — WebSocket is receive-only
    await fetch(`/api/sessions/${sessionId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content })
    })
  }, [sessionId])

  const interrupt = useCallback(() => {
    wsRef.current?.send(JSON.stringify({ type: 'control_request', request: { subtype: 'interrupt' } }))
  }, [])

  return { sendMessage, interrupt }
}
```

> **Important:** The WebSocket is **receive-only** for messages. Sending user messages goes through a separate HTTP POST. The WebSocket handles: receiving the stream, sending control signals (interrupt, permission responses).

---

## 4. React state design

Keep state flat and message-driven. Every incoming `SDKMessage` dispatches an action:

```ts
// types.ts
type SessionStatus = 'connecting' | 'idle' | 'running' | 'error'

type ToolRow = {
  id: string           // tool_use_id
  name: string
  input: unknown
  result?: string
  elapsed?: number
  status: 'pending' | 'running' | 'done' | 'error'
}

type MessageBlock =
  | { kind: 'text';    id: string; text: string; streaming: boolean }
  | { kind: 'tools';   id: string; tools: ToolRow[]; summary?: string }
  | { kind: 'result';  id: string; cost: number; duration_ms: number; is_error: boolean }
  | { kind: 'system';  id: string; text: string; variant: 'info' | 'warn' | 'error' | 'compact' }
  | { kind: 'user';    id: string; text: string }

type SessionState = {
  status: SessionStatus
  model: string
  cwd: string
  blocks: MessageBlock[]
  streamingText: string         // accumulates token-by-token, becomes a 'text' block on stop
  activeToolBatch: ToolRow[]    // accumulates current tool calls
}

// reducer.ts
function reducer(state: SessionState, msg: SDKMessage): SessionState {
  switch (msg.type) {
    case 'system':
      if (msg.subtype === 'init') {
        return { ...state, model: msg.model, cwd: msg.cwd }
      }
      if (msg.subtype === 'session_state_changed') {
        return { ...state, status: msg.state === 'idle' ? 'idle' : 'running' }
      }
      if (msg.subtype === 'api_retry') {
        return { ...state, blocks: [...state.blocks, {
          kind: 'system', id: msg.uuid,
          text: `Rate limited, retrying in ${msg.retry_delay_ms / 1000}s (${msg.attempt}/${msg.max_retries})`,
          variant: 'warn'
        }]}
      }
      if (msg.subtype === 'compact_boundary') {
        return { ...state, blocks: [...state.blocks, {
          kind: 'system', id: msg.uuid,
          text: `Context compacted (${(msg.compact_metadata.pre_tokens / 1000).toFixed(0)}k tokens → summary)`,
          variant: 'compact'
        }]}
      }
      return state

    case 'stream_event': {
      const ev = msg.event
      if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') {
        return { ...state, streamingText: state.streamingText + ev.delta.text }
      }
      if (ev.type === 'content_block_stop' && state.streamingText) {
        // Flush streaming buffer to a real block
        const block: MessageBlock = {
          kind: 'text', id: msg.uuid,
          text: state.streamingText, streaming: false
        }
        return { ...state, streamingText: '', blocks: [...state.blocks, block] }
      }
      return state
    }

    case 'assistant': {
      const toolUseBlocks = msg.message.content.filter(b => b.type === 'tool_use')
      if (toolUseBlocks.length > 0) {
        const tools: ToolRow[] = toolUseBlocks.map(b => ({
          id: b.id, name: b.name, input: b.input, status: 'pending'
        }))
        return { ...state, activeToolBatch: [...state.activeToolBatch, ...tools] }
      }
      return state
    }

    case 'tool_progress':
      return {
        ...state,
        activeToolBatch: state.activeToolBatch.map(t =>
          t.id === msg.tool_use_id
            ? { ...t, status: 'running', elapsed: msg.elapsed_time_seconds }
            : t
        )
      }

    case 'user': {
      const toolResults = Array.isArray(msg.message.content)
        ? msg.message.content.filter(b => b.type === 'tool_result')
        : []
      if (toolResults.length > 0) {
        const updatedBatch = state.activeToolBatch.map(t => {
          const result = toolResults.find(r => r.tool_use_id === t.id)
          return result ? { ...t, status: 'done' as const, result: String(result.content ?? '') } : t
        })
        return { ...state, activeToolBatch: updatedBatch }
      }
      return state
    }

    case 'tool_use_summary': {
      // Flush the active tool batch as a 'tools' block, annotated with summary
      const block: MessageBlock = {
        kind: 'tools', id: msg.uuid,
        tools: state.activeToolBatch,
        summary: msg.summary
      }
      return { ...state, activeToolBatch: [], blocks: [...state.blocks, block] }
    }

    case 'result': {
      const block: MessageBlock = {
        kind: 'result', id: msg.uuid,
        cost: msg.total_cost_usd,
        duration_ms: msg.duration_ms,
        is_error: msg.is_error
      }
      return { ...state, blocks: [...state.blocks, block], status: 'idle' }
    }

    default:
      return state
  }
}
```

---

## 5. Terminal-inspired UI design

The goal: **all the information density of a terminal, none of the raw ugliness**. Users see every step as it happens, in a visual hierarchy that's easy to scan.

### Core design principles

**Monospace font, but with hierarchy.** Use a monospace font (`JetBrains Mono`, `Fira Code`, `Geist Mono`) for all agent output. Vary weight and color, not font family. The monospace feel signals "this is live machine output" without looking like a terminal dump.

**Dark background, light foreground.** A near-black background (`#0d0d0f` or `#111113`) with off-white text (`#e8e8e6`). Not pure black/white — that reads as harsh. Think dark IDE, not Terminal.app.

**Color for semantic meaning, not decoration.**
- `#4af5a0` green → success, tool done, result OK
- `#f5a04a` amber → running, warning, retry
- `#f54a4a` red → error, denied
- `#4ab3f5` blue → informational, model text, system init
- `#8a8a8e` muted gray → secondary info, timestamps, cost

**Indentation shows hierarchy.** User prompt at root. Agent thinking/text at 0px indent. Tool calls at 16px indent. Tool results at 32px. Subagent sessions inside a box with their own 0px root.

**Animations that feel alive, not distracting.**
- Cursor blink on the streaming text (CSS `animation: blink 1s step-end infinite`)
- Spinner (not a bar) on running tools — a simple rotating `─┘└─` in monospace
- Smooth height transitions when blocks expand

### Color palette

```css
:root {
  --bg-primary:    #0d0d0f;
  --bg-secondary:  #141417;
  --bg-elevated:   #1c1c20;
  --bg-active:     #232329;

  --text-primary:  #e8e8e6;
  --text-secondary:#a0a0a8;
  --text-muted:    #5c5c64;

  --accent-green:  #4af5a0;
  --accent-amber:  #f5a04a;
  --accent-red:    #f54a4a;
  --accent-blue:   #4ab3f5;
  --accent-purple: #b08cf5;

  --border:        #2a2a30;
  --border-active: #3a3a44;

  --font-mono: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace;
  --font-size-base: 13px;
  --line-height: 1.6;
}
```

### Layout sketch

```
┌─────────────────────────────────────────────────────────┐
│  ● claude-opus-4-7  ·  ~/project  ·  bypassPermissions  │  ← session header
├─────────────────────────────────────────────────────────┤
│                                                          │
│  ❯ fix the auth bug in middleware.ts                     │  ← user message
│                                                          │
│  I'll start by reading the middleware file to understand  │  ← agent text (streaming)
│  the current implementation.▋                            │    ▋ = blinking cursor
│                                                          │
│    ├─ Read  middleware.ts                      ✓  0.3s  │  ← tool row (done)
│    ├─ Read  auth/tokens.ts                     ✓  0.2s  │
│    ├─ Bash  grep -n "verifyToken"              ✓  0.1s  │
│    └─ ─ ─  Read 3 files, ran 1 command                   │  ← summary (dim)
│                                                          │
│  Found the issue. The token expiry check uses `>` instead │
│  of `>=`, which rejects tokens at the exact expiry moment.│
│                                                          │
│    ├─ Edit  middleware.ts                      ↻  2.1s  │  ← running tool (spinner)
│                                                          │
├─────────────────────────────────────────────────────────┤
│  ▸ running  ·  3 tools used  ·  Ctrl+C to stop          │  ← status bar
├─────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────┐               │
│  │  Ask Claude anything...              │  [Send]        │  ← input
│  └──────────────────────────────────────┘               │
└─────────────────────────────────────────────────────────┘
```

---

## 6. Component architecture

```
<AgentSession>
  │
  ├── <SessionHeader>         model, cwd, permission mode, status badge
  │
  ├── <MessageFeed>           scrollable, auto-scroll-to-bottom
  │   │
  │   ├── <UserBubble>        the user's prompt
  │   │
  │   ├── <TextBlock>         agent text (streaming or settled)
  │   │   └── <StreamingCursor>  blinking ▋ when streaming
  │   │
  │   ├── <ToolBatch>         a group of tool calls
  │   │   ├── <ToolRow>       one tool call + result + timer
  │   │   └── <ToolSummary>   dim one-liner from tool_use_summary
  │   │
  │   ├── <SystemRow>         api_retry warning, compact boundary, etc.
  │   │
  │   └── <ResultFooter>      cost, duration, stop_reason
  │
  ├── <StatusBar>             session_state_changed → idle/running/error
  │
  └── <InputArea>
      ├── <Textarea>          disabled when status !== 'idle'
      ├── <SendButton>
      └── <InterruptButton>   visible when status === 'running'
```

---

## 7. Rendering each message type

### TextBlock — settled and streaming

```tsx
function TextBlock({ text, streaming }: { text: string; streaming: boolean }) {
  return (
    <div className="text-block">
      <ReactMarkdown>{text}</ReactMarkdown>
      {streaming && <span className="cursor">▋</span>}
    </div>
  )
}
```

```css
.text-block {
  font-family: var(--font-mono);
  font-size: var(--font-size-base);
  color: var(--text-primary);
  line-height: var(--line-height);
  white-space: pre-wrap;
}

.cursor {
  display: inline-block;
  color: var(--accent-green);
  animation: blink 1s step-end infinite;
}

@keyframes blink {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0; }
}
```

---

### ToolRow

```tsx
const TOOL_ICONS: Record<string, string> = {
  Read: '📖', Edit: '✏️', Write: '📝', Bash: '$', WebSearch: '🔍',
  WebFetch: '⬇', Agent: '⚡', default: '⚙'
}

function ToolRow({ tool }: { tool: ToolRow }) {
  const icon = TOOL_ICONS[tool.name] ?? TOOL_ICONS.default
  const [open, setOpen] = useState(false)

  return (
    <div className={`tool-row tool-row--${tool.status}`}>
      <span className="tool-connector">├─</span>
      <span className="tool-icon">{icon}</span>
      <span className="tool-name">{tool.name}</span>
      <span className="tool-subject">{formatToolInput(tool.name, tool.input)}</span>

      <span className="tool-status">
        {tool.status === 'running' && <Spinner elapsed={tool.elapsed} />}
        {tool.status === 'done'    && <span className="ok">✓</span>}
        {tool.status === 'error'   && <span className="err">✗</span>}
      </span>

      {tool.result && (
        <button className="expand-btn" onClick={() => setOpen(o => !o)}>
          {open ? '▾' : '▸'}
        </button>
      )}

      {open && tool.result && (
        <pre className="tool-result">{truncate(tool.result, 2000)}</pre>
      )}
    </div>
  )
}

function formatToolInput(toolName: string, input: unknown): string {
  if (typeof input !== 'object' || !input) return ''
  const i = input as Record<string, unknown>
  // Show the most useful field per tool
  if (toolName === 'Read'  || toolName === 'Edit' || toolName === 'Write')
    return String(i.file_path ?? i.path ?? '')
  if (toolName === 'Bash')
    return truncate(String(i.command ?? ''), 60)
  if (toolName === 'WebSearch')
    return String(i.query ?? '')
  return ''
}
```

```css
.tool-row {
  display: flex;
  align-items: baseline;
  gap: 6px;
  padding: 2px 0;
  font-family: var(--font-mono);
  font-size: 12px;
  margin-left: 16px;
}

.tool-connector { color: var(--text-muted); }
.tool-name      { color: var(--accent-blue); font-weight: 600; min-width: 80px; }
.tool-subject   { color: var(--text-secondary); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.tool-row--running .tool-name { color: var(--accent-amber); }
.tool-row--done    .ok        { color: var(--accent-green); }
.tool-row--error   .err       { color: var(--accent-red); }

.tool-result {
  width: 100%;
  margin: 4px 0 4px 24px;
  padding: 8px;
  background: var(--bg-elevated);
  border-left: 2px solid var(--border-active);
  font-size: 11px;
  color: var(--text-secondary);
  overflow-x: auto;
  white-space: pre;
}
```

---

### SystemRow

```tsx
function SystemRow({ block }: { block: SystemMessageBlock }) {
  const styles: Record<typeof block.variant, string> = {
    info:    'system-row--info',
    warn:    'system-row--warn',
    error:   'system-row--error',
    compact: 'system-row--compact',
  }
  return (
    <div className={`system-row ${styles[block.variant]}`}>
      <span className="system-bar" />
      <span className="system-text">{block.text}</span>
    </div>
  )
}
```

```css
.system-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 8px 0;
  font-family: var(--font-mono);
  font-size: 11px;
}
.system-bar   { width: 2px; height: 14px; border-radius: 1px; flex-shrink: 0; }

.system-row--info   .system-bar { background: var(--accent-blue); }
.system-row--info   .system-text { color: var(--text-muted); }

.system-row--warn   .system-bar { background: var(--accent-amber); }
.system-row--warn   .system-text { color: var(--accent-amber); }

.system-row--error  .system-bar { background: var(--accent-red); }
.system-row--error  .system-text { color: var(--accent-red); }

.system-row--compact { opacity: 0.5; }
.system-row--compact .system-bar { background: var(--text-muted); }
```

---

### Spinner (monospace style)

```tsx
const SPINNER_FRAMES = ['─', '╲', '│', '╱']

function Spinner({ elapsed }: { elapsed?: number }) {
  const [frame, setFrame] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setFrame(f => (f + 1) % SPINNER_FRAMES.length), 120)
    return () => clearInterval(id)
  }, [])
  return (
    <span className="spinner">
      {SPINNER_FRAMES[frame]}
      {elapsed !== undefined && <span className="elapsed"> {elapsed.toFixed(1)}s</span>}
    </span>
  )
}
```

```css
.spinner        { color: var(--accent-amber); font-family: var(--font-mono); }
.spinner .elapsed { color: var(--text-muted); font-size: 10px; }
```

---

### StatusBar

```tsx
function StatusBar({ status, toolCount }: { status: SessionStatus; toolCount: number }) {
  return (
    <div className={`status-bar status-bar--${status}`}>
      <span className="status-dot" />
      <span className="status-label">
        {status === 'running' ? 'running' : status === 'idle' ? 'idle' : 'error'}
      </span>
      {status === 'running' && toolCount > 0 && (
        <span className="status-detail">· {toolCount} tool{toolCount !== 1 ? 's' : ''} active</span>
      )}
      {status === 'running' && (
        <span className="status-hint">· Ctrl+C to stop</span>
      )}
    </div>
  )
}
```

```css
.status-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 16px;
  border-top: 1px solid var(--border);
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-muted);
}
.status-dot {
  width: 6px; height: 6px;
  border-radius: 50%;
  background: var(--text-muted);
}
.status-bar--running .status-dot { background: var(--accent-green); animation: pulse 1.5s ease-in-out infinite; }
.status-bar--error   .status-dot { background: var(--accent-red); }

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.3; }
}
```

---

## 8. Handling streaming text (token by token)

The key is to handle `stream_event` messages and render the accumulating buffer separately from settled blocks:

```tsx
function MessageFeed({ blocks, streamingText }: {
  blocks: MessageBlock[]
  streamingText: string
}) {
  const bottomRef = useRef<HTMLDivElement>(null)

  // Auto-scroll on new content
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [blocks.length, streamingText])

  return (
    <div className="message-feed">
      {blocks.map(block => <Block key={block.id} block={block} />)}

      {/* Live streaming buffer — always at the bottom, never in blocks[] until settled */}
      {streamingText && (
        <TextBlock text={streamingText} streaming={true} />
      )}

      <div ref={bottomRef} />
    </div>
  )
}
```

The `streamingText` buffer grows with each `content_block_delta`. When `content_block_stop` fires, the reducer moves it into `blocks[]` as a settled `TextBlock` with `streaming: false`. The blinking cursor disappears.

---

## 9. The spinner verb — "Reticulating…"

This is a pure frontend effect — **nothing in the SDKMessage stream tells you what word to show**. The agent picks a random verb from the list and shows it with an ellipsis while the model is working. This is what makes the interface feel alive and playful instead of just showing a generic loading bar.

### How it works in the source

From `constants/spinnerVerbs.ts` + `components/Spinner.tsx`:

```ts
// Picked ONCE when the spinner mounts — not cycling, not changing mid-turn
const [randomVerb] = useState(() => sample(SPINNER_VERBS))
const message = randomVerb + '…'   // e.g. "Reticulating…"
```

The key design decision: **one verb per thinking period, not a rotating sequence**. The verb is sampled when the spinner first appears and stays fixed until the agent produces output. This reads as the agent being in a single state ("it's doing something") rather than anxiously cycling through labels.

### When to show it

Show the spinner verb in the gap between the user sending a message and the agent producing its first visible output — specifically:

| Moment | Show verb? |
|---|---|
| After user sends, before first `stream_event` arrives | ✅ Yes |
| Between tool batch ending and next model text starting | ✅ Yes |
| While `stream_event` text is actively arriving | ❌ No — text is showing |
| While a tool row shows `↻ running` | ❌ No — tool row is the feedback |
| After `result` arrives | ❌ No — turn is done |

In practice: show it whenever `status === 'running'` AND `streamingText === ''` AND `activeToolBatch` is empty.

### Implementation

```tsx
// useSpinnerVerb.ts
import { useState, useEffect } from 'react'

const SPINNER_VERBS = [/* full list below */]

export function useSpinnerVerb(active: boolean): string | null {
  // Pick a new verb each time active transitions false → true
  const [verb, setVerb] = useState<string | null>(null)

  useEffect(() => {
    if (active) {
      setVerb(SPINNER_VERBS[Math.floor(Math.random() * SPINNER_VERBS.length)] ?? 'Thinking')
    } else {
      setVerb(null)
    }
  }, [active])

  return verb
}
```

```tsx
// In your MessageFeed or StatusBar
function AgentStatusLine({ status, streamingText, activeToolCount }: {
  status: 'idle' | 'running'
  streamingText: string
  activeToolCount: number
}) {
  const showVerb = status === 'running' && streamingText === '' && activeToolCount === 0
  const verb = useSpinnerVerb(showVerb)

  if (!showVerb || !verb) return null

  return (
    <div className="spinner-verb">
      <Spinner />
      <span className="verb-text">{verb}…</span>
    </div>
  )
}
```

```css
.spinner-verb {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-muted);
  padding: 4px 0;
  /* Fade in softly so it doesn't pop */
  animation: fade-in 0.3s ease;
}

.verb-text {
  color: var(--text-secondary);
  letter-spacing: 0.01em;
}

@keyframes fade-in {
  from { opacity: 0; transform: translateY(2px); }
  to   { opacity: 1; transform: translateY(0); }
}
```

### User-configurable verbs

The source also supports user-defined verb lists via settings (`settings.spinnerVerbs`), with two modes:

- `{ mode: 'replace', verbs: ['...'] }` — replace the entire list
- `{ mode: 'append', verbs: ['...'] }` — extend the built-in list

If you expose a settings panel, this is a fun personalization option.

### The full verb list

Taken directly from `constants/spinnerVerbs.ts` — the canonical source. A few extras exist here that differ from what users may have seen elsewhere (`Bunning`, `Gesticulating`, `Newspapering`, `Scheming`):

```ts
export const SPINNER_VERBS = [
  'Accomplishing', 'Actioning', 'Actualizing', 'Architecting',
  'Baking', 'Beaming', "Beboppin'", 'Befuddling', 'Billowing',
  'Blanching', 'Bloviating', 'Boogieing', 'Boondoggling', 'Booping',
  'Bootstrapping', 'Brewing', 'Bunning', 'Burrowing',
  'Calculating', 'Canoodling', 'Caramelizing', 'Cascading',
  'Catapulting', 'Cerebrating', 'Channeling', 'Channelling',
  'Choreographing', 'Churning', 'Clauding', 'Coalescing',
  'Cogitating', 'Combobulating', 'Composing', 'Computing',
  'Concocting', 'Considering', 'Contemplating', 'Cooking',
  'Crafting', 'Creating', 'Crunching', 'Crystallizing', 'Cultivating',
  'Deciphering', 'Deliberating', 'Determining', 'Dilly-dallying',
  'Discombobulating', 'Doing', 'Doodling', 'Drizzling',
  'Ebbing', 'Effecting', 'Elucidating', 'Embellishing',
  'Enchanting', 'Envisioning', 'Evaporating',
  'Fermenting', 'Fiddle-faddling', 'Finagling', 'Flambéing',
  'Flibbertigibbeting', 'Flowing', 'Flummoxing', 'Fluttering',
  'Forging', 'Forming', 'Frolicking', 'Frosting',
  'Gallivanting', 'Galloping', 'Garnishing', 'Generating',
  'Gesticulating', 'Germinating', 'Gitifying', 'Grooving', 'Gusting',
  'Harmonizing', 'Hashing', 'Hatching', 'Herding',
  'Honking', 'Hullaballooing', 'Hyperspacing',
  'Ideating', 'Imagining', 'Improvising', 'Incubating',
  'Inferring', 'Infusing', 'Ionizing',
  'Jitterbugging', 'Julienning',
  'Kneading',
  'Leavening', 'Levitating', 'Lollygagging',
  'Manifesting', 'Marinating', 'Meandering', 'Metamorphosing',
  'Misting', 'Moonwalking', 'Moseying', 'Mulling', 'Mustering', 'Musing',
  'Nebulizing', 'Nesting', 'Newspapering', 'Noodling', 'Nucleating',
  'Orbiting', 'Orchestrating', 'Osmosing',
  'Perambulating', 'Percolating', 'Perusing', 'Philosophising',
  'Photosynthesizing', 'Pollinating', 'Pondering', 'Pontificating',
  'Pouncing', 'Precipitating', 'Prestidigitating', 'Processing',
  'Proofing', 'Propagating', 'Puttering', 'Puzzling',
  'Quantumizing',
  'Razzle-dazzling', 'Razzmatazzing', 'Recombobulating', 'Reticulating',
  'Roosting', 'Ruminating',
  'Sautéing', 'Scampering', 'Schlepping', 'Scurrying',
  'Seasoning', 'Shenaniganing', 'Shimmying', 'Simmering',
  'Skedaddling', 'Sketching', 'Slithering', 'Smooshing',
  'Sock-hopping', 'Spelunking', 'Spinning', 'Sprouting',
  'Stewing', 'Sublimating', 'Swirling', 'Swooping',
  'Symbioting', 'Synthesizing',
  'Tempering', 'Thinking', 'Thundering', 'Tinkering',
  'Tomfoolering', 'Topsy-turvying', 'Transfiguring', 'Transmuting', 'Twisting',
  'Undulating', 'Unfurling', 'Unravelling',
  'Vibing',
  'Waddling', 'Wandering', 'Warping', 'Whatchamacalliting',
  'Whirlpooling', 'Whirring', 'Whisking', 'Wibbling',
  'Working', 'Wrangling',
  'Zesting', 'Zigzagging',
]
```

---

## 10. UX patterns to nail the feel

### Auto-scroll with escape hatch
Auto-scroll to the bottom when new content arrives. Stop auto-scrolling if the user scrolls up (they're reading history). Resume when they scroll back to the bottom.

```ts
function useAutoScroll(containerRef: RefObject<HTMLElement>, trigger: unknown) {
  const isAtBottom = useRef(true)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const handler = () => {
      isAtBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    }
    el.addEventListener('scroll', handler)
    return () => el.removeEventListener('scroll', handler)
  }, [])

  useEffect(() => {
    if (isAtBottom.current) {
      containerRef.current?.scrollTo({ top: containerRef.current.scrollHeight, behavior: 'smooth' })
    }
  }, [trigger])
}
```

### Collapse long tool output by default
Most tool results are too long to show inline. Collapse them to a single "Show output (234 lines)" link. Use `<details>` for zero-JS expand.

### Group consecutive tool calls
Don't render each tool call as a separate block. Group all tool calls from one model turn into one `<ToolBatch>` — the reducer's `activeToolBatch` handles this. Then emit the whole batch as one block when `tool_use_summary` arrives.

### Keyboard shortcuts
- `Ctrl+C` / `Escape` → interrupt (send `{ type: 'control_request', request: { subtype: 'interrupt' } }` over WebSocket)
- `↑` → fill input with last user message
- `Enter` → send (no Shift+Enter confusion — let Shift+Enter be newlines)

### Timestamp on hover
Keep timestamps hidden. Show them on row hover as a tooltip or dim inline annotation. They clutter the primary read flow but are useful for debugging.

### Permission request modal
When a `control_request` (permission prompt) arrives over WebSocket, render a modal or inline card that blocks the input area. Show the tool name, the specific input being requested, and Allow / Deny buttons. On click, POST `control_response` back through the WebSocket.

---

## 11. Quick wiring checklist

- [ ] WebSocket connects, sends auth frame immediately after `onopen`
- [ ] `stream_event` with `content_block_delta` appends to `streamingText`
- [ ] `content_block_stop` flushes `streamingText` → settled `TextBlock`
- [ ] `assistant` with `tool_use` content creates entries in `activeToolBatch`
- [ ] `tool_progress` updates `elapsed` on the right `ToolRow`
- [ ] `user` with `tool_result` marks tool rows as done
- [ ] `tool_use_summary` flushes `activeToolBatch` → `ToolBatch` block
- [ ] `session_state_changed` enables/disables the input box
- [ ] `result` shows cost/duration footer, resets status to idle
- [ ] `system/api_retry` shows amber warning row
- [ ] `system/compact_boundary` shows separator with token count
- [ ] WebSocket reconnects on transient close (not on 4003)
- [ ] Interrupt button sends `control_request: interrupt` over WebSocket
