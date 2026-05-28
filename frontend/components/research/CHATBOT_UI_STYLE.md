# Research Chatbot — UI Style Guide

Reference for anyone (humans, Claude) touching `research-chatbot.jsx` or its
sibling renderers. Read this before adding a new message type, status line,
or system bubble.

The guiding principle is **"continuous text flow, no bubbles, no boxes"** —
the chatbot is closer to a streaming terminal than a chat app. Assistant
text blends into the panel; only the user's own input gets a real container.

---

## Palette

The only non-greyscale colour the panel uses is one turquoise accent. There is
no second accent. Every "amber", "purple", "green" CSS variable currently
resolves to the same `#4effd0` — don't add new colours without checking with
the design owner.

| Token / value                | Where it's used                                                   |
| ---------------------------- | ----------------------------------------------------------------- |
| `#4effd0`                    | Single accent: borders, links, spinners, OK ticks, user-bubble outline |
| `rgba(78, 255, 208, 0.08)`   | User-bubble background                                            |
| `rgba(78, 255, 208, 0.15)`   | Hover / interactive fill (close button, tab pill)                 |
| `rgba(78, 255, 208, 0.45)`   | `--rcc-muted` — tool-row connectors                               |
| `rgba(78, 255, 208, 0.75)`   | `--rcc-secondary` — tool-row subject text                          |
| `#44546a`                    | Panel + input-area background (slate)                             |
| `rgba(40, 50, 65, 0.95)`     | Sub-panel / sidebar surface                                       |
| `rgba(0, 0, 0, 0.15)`        | Tab bar surface (slightly darker than panel)                      |
| `rgba(255, 255, 255, 0.82)`  | Assistant body text                                                |
| `rgba(255, 255, 255, 0.50)`  | System / intermediate text (muted)                                |
| `rgba(255, 255, 255, 0.1)`   | Subtle headers/controls                                            |
| `#ef4444` / `rgba(239,68,68,0.1)` | **Only** colour besides turquoise — reserved for errors      |

Backgrounds use `backdrop-filter: blur(8px)` over the panel slate to keep the
panel visually layered without competing with map content underneath.

---

## Typography

```
font-family: 'Inter', 'Lato', 'Helvetica Neue', Helvetica, Arial, sans-serif;
```

There is one font stack across the panel. Don't introduce a second.

Default sizes (current state — large because the panel was scaled up):

| Element                                   | Size    | Weight    | Notes                       |
| ----------------------------------------- | ------- | --------- | --------------------------- |
| Message body (`.message-content`)         | 26 px   | 400       | User + assistant            |
| System / intermediate message             | 16 px   | 400 italic| Muted, italicised           |
| Tool-row text (`.rcc-tool-*`)             | 26 px   | 400 / 600 | `name` is 600 + uppercase   |
| Tool-row name chip                        | 26 px   | 600 caps  | letter-spacing `0.04em`     |
| Header retry / action buttons             | 22 px   | 300 caps  | letter-spacing `0.3px`      |
| Spinner verb row                          | 26 px   | 400       |                             |

**Documents tab** uses smaller sizes (deliberate — see the dedicated reduction
in that tab; don't expand to match chat sizes).

Light weights (`300`) and `text-transform: uppercase` come from the Climate
TRACE design lineage — reserve them for action buttons, not body text.

---

## Composition rules

1. **Assistant text has no bubble.** No background, no border. It flows
   directly into the panel slate. `padding: 2px 0;` only.
2. **User text has a soft outlined bubble.** `rgba(78,255,208,0.08)` background,
   `1px solid rgba(78,255,208,0.5)` border, `border-radius: 8px`.
3. **System text has a left-accent rule, not a bubble.** `border-left: 2px
   solid rgba(78,255,208,0.5)`, italic, muted. Padding only on the left.
4. **Error text uses the red accent.** `rgba(239,68,68,0.1)` background,
   `1px solid #ef4444` border. Used for both inline error bubbles and the
   global retry banner.
5. **No drop shadows on inline elements.** The container has one; nothing
   inside should add more depth.
6. **`border-radius: 8px`** for any rounded surface. The container itself is
   `15px`. Buttons are `5–6px`. Don't invent new radii.

---

## Message types catalogue

The chatbot multiplexes many "system" message types through one renderer.
Each `messageType` selects a specific subtree in `research-chatbot.jsx`
(grep `msg.messageType ===` for the switch).

| `messageType`        | Visual                                                              | When to use                                                       |
| -------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `'user_query'`       | Soft turquoise-outline user bubble                                  | User's submitted message                                          |
| _(no messageType)_   | Assistant body — flowing, no bubble                                 | Default assistant text                                            |
| `'research_result'`  | Same as assistant body; passed through MessageRenderer (markdown)   | Final assistant answer                                            |
| `'intermediate'`     | Generic tool-row: `<subject>  <spinner?>` (no name chip)            | Generic "agent is working" status                                 |
| `'completed'`        | Tool-row: `<subject>` (no spinner)                                  | Closing line after a successful intermediate step                 |
| `'pdf_rag'`          | Same shape as `intermediate`: `Indexing "<file>"…  <spinner>`       | Document ingestion progress                                       |
| `'geojson_rag'`      | Same shape as `intermediate`                                        | GeoJSON ingestion progress                                        |
| `'json_rag'`         | Same shape as `intermediate`                                        | JSON ingestion progress                                           |
| `'web_search'`       | Branded tool-row: `WEB SEARCH  <subject>  <spinner>`                | OpenAI hosted `web_search_preview` tool started                   |
| `'file_search'`      | Branded tool-row: `FILE SEARCH  <subject>  <spinner>`               | OpenAI hosted `file_search` tool started                          |
| `'code_interpreter'` | Branded tool-row: `CODE INTERPRETER  <subject>  <spinner>`          | OpenAI hosted `code_interpreter` tool started                     |
| `'geojson'`          | Italic muted text inline                                            | Map-related status; **also** terminal state for `geojson_rag`     |
| `'map_snapshot'`     | Inline card with map thumbnail, place name, count, radius           | Geospatial query result                                           |
| `'analysis_panel'`   | Embedded Plotly iframe with index header `<n>/<total>` + title      | Deep-analysis chart step                                          |
| `'error'`            | Red-accent bubble (`#ef4444`)                                       | Anything the user must know failed; never silent                  |

`research-chatbot-message-${msg.sender}` adds the bubble-vs-flow treatment
(`user` → outlined bubble, `assistant` → flowing body, `system` → left rule).
Any messageType in the "intermediate-like" set also gets the
`research-chatbot-message-intermediate` modifier — see the className builder
near the start of the message map.

### Anatomy of a tool-row

```
┌─ [spinner?]   subject                                          ─┐
│   rotating    turquoise (#4effd0) italic, .85 opacity, 26px     │
│   ─ at start  flex:1, ellipsised, single line                   │
└─────────────────────────────────────────────────────────────────┘
```

One layout for every system / intermediate status: **spinner first, then
italic turquoise subject text.** No NAME chip, no icon, no trailing status,
no connector glyph. The visual difference between an in-flight row and a
finished row is *the presence of the spinner*, nothing else.

- **In-flight** (`pdf_rag`, `geojson_rag`, `json_rag`, `intermediate`,
  `web_search`, `file_search`, `code_interpreter`): renders `<SpinnerChar />`
  before the subject.
- **Done** (`completed`, `geojson` terminal state): no spinner, same
  italic turquoise text.
- **Error** (`error`): see the error bubble rules — red accent, no spinner.

The subject text carries everything the user needs to know. Don't add
prefixes, badges, or status chips trying to differentiate "this is the
file_search tool" from "this is in-house indexing" — they're all
"the agent is doing something" from the user's perspective. Be precise
in the subject string instead (`Searching uploaded documents…`,
`Indexing "foo.pdf" into knowledge base…`).

---

## Spinners

There is exactly one spinner glyph used in the chat stream: the rotating
`─` driven by `<SpinnerChar />` (defined inline near the top of
`research-chatbot.jsx`). It uses the accent colour by default; pass
`color={...}` only to match a tool's branded colour — in practice all three
hosted-tool variables resolve to the same turquoise, so passing
`color="var(--rcc-accent-green)"` is decorative.

The `progress-ring` SVG (CSS `@keyframes spin`) is used **only** for the
map-snapshot loading card. Don't reuse it elsewhere — it implies "rendering
an image".

The "spinner verb row" (`rcc-spinner-verb-row`) appears once, only while
waiting for the first bot token after sending — it's a verb like
"Pensando…", "Investigando…", etc. Don't introduce a second verb-row.

---

## Language rules

- **Default: English.** All status / placeholder / control strings.
- **Spanish exceptions are existing** ("Capturando vista del mapa…",
  "concesión/es", and the deep-analysis index/total stub). Do not introduce
  new Spanish strings without matching an existing pattern that already
  exists in Spanish. The tool-row subject ("Searching uploaded documents…",
  "Indexing …", "Running computation…") is English.
- The branded tool name chip (`Web Search`, `File Search`,
  `Code Interpreter`) is always English uppercase, regardless of the
  subject's language. It's a label, not prose.

---

## Glyphs / emoji

**The chat stream is glyph-free.** No emoji icons, no leading status
characters, no `✓` / `❌` / `⚡` / `🌐` / `📚` / `⚙️` / `🗺️` in:

- tool rows (intermediate / completed / pdf_rag / geojson_rag / json_rag /
  web_search / file_search / code_interpreter / geojson)
- assistant body text (the model is instructed to omit them; if any slip
  through, fix the prompt, don't render them)
- error messages (the `messageType: 'error'` red bubble carries the
  meaning — don't prefix the body with `❌`)
- map_snapshot card metadata
- completion banners ("Document processed and ready…" — no leading `✅`)

The **one exception** is the **Documents tab**, where per-file-type glyphs
(`📕 📘 📊 📋 📄 📎 🖼️ 🗺️`) act as functional file-type indicators in a
denser list view. They are deliberately rendered at a smaller size than
chat content and never appear in the chat stream.

If you find yourself reaching for an emoji to convey a status, you're
introducing a category that doesn't exist — pick a `messageType` whose
existing CSS handles the differentiation (red border for errors, NAME chip
for hosted tools, italic muted body for system, etc.).

---

## Inputs

- Textarea is `min-height: 140px`, `max-height: 200px`, `font-size: 26px`
  to match the chat stream. Resizing the input below this breaks the
  visual grammar.
- `.research-chatbot-input-container` has the **only** turquoise top border
  in the panel (`border-top: 1px solid #4effd0`). It demarcates "you are
  typing".
- Send / Upload / New action buttons sit in a vertical stack at
  `34×34px`, font-weight 300, `border-radius: 6px`. They use neutral white
  outlines, not turquoise — turquoise is reserved for state, not chrome.

### Lock state — important

The textarea AND the send button are disabled when **any** of:

- `!isConnected`
- `isLoading` (assistant streaming)
- `isInitializing` (panel boot)
- `isRagInProgress` (an ingestion is in flight — derived from
  `spinnerActive`)

Placeholder rotates accordingly. `sendChatMessage` also re-checks
`isRagInProgress` defensively — never bypass that guard in new code paths.

---

## Anti-patterns (don't do these)

1. **Don't mix branded NAME chips with generic icon-only rows in the same
   logical flow.** If you add a new hosted-tool step, model its renderer on
   `'file_search'`. If you add a new in-house step, model it on
   `'pdf_rag'`/`'intermediate'`.
2. **Don't introduce a second accent colour.** If you need to differentiate,
   use opacity over turquoise (the existing `--rcc-muted` / `--rcc-secondary`
   pattern).
3. **Don't add system messages without picking an existing `messageType`.**
   An unrecognised `messageType` falls through to the `MessageRenderer`
   branch, which formats it as assistant body — system "tool" status will
   look like the model's own prose.
4. **Don't add Spanish prose to status strings.** The only Spanish strings
   in the chatbot belong to map snapshots and the spinner-verb rotation;
   keep new ones in English.
5. **Don't add bubbles, borders, or boxes to assistant text.** The
   `assistant` class is intentionally empty-styled; respect that.
6. **Don't introduce a second spinner style** outside the rotating `─` (chat
   stream) and the SVG `progress-ring` (map snapshots).
7. **Don't write `messageType: 'text'`.** Either omit (which means
   assistant prose) or pick one of the catalogued types. `'text'` is treated
   as "no specific style" and is ambiguous when read back from history.
8. **Don't add emoji or status glyphs anywhere in the chat stream.** Tool
   rows, errors, completion banners, body text — all glyph-free. The
   chat stream conveys status through layout (NAME chip vs. chip-less,
   red border, italic muted body, spinner presence), not iconography.
   The Documents tab's file-type glyphs are the *only* exception. The model
   is instructed to send plain text; if a backend status string contains a
   leading glyph it's a bug in the emitter, not something to render.

---

## Where the rules live in code

| Concern                       | File / location                                                 |
| ----------------------------- | --------------------------------------------------------------- |
| Tool-row CSS                  | `research-chatbot.jsx` — search for `--rcc-accent-green`         |
| Message renderer switch       | `research-chatbot.jsx` — `messages.filter(...).map((msg) =>`     |
| Markdown body rendering       | `components/ui/MessageRenderer.jsx`                              |
| Panel + tab CSS               | `research-chatbot.jsx` — search for `.research-chatbot-container`|
| Spinner glyph                 | `research-chatbot.jsx` — `function SpinnerChar`                  |
| `indexingMessage` / `indexingErrorMessage` | Top of `research-chatbot.jsx`                       |

When in doubt: grep the file for an existing example that does the closest
thing to what you're trying to add, and copy its shape exactly.
