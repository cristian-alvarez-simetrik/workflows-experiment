# Workflow Studio

A client-only, node-based data workflow platform. Build graphs of file / script / SQL / visualization nodes and execute them against a **PGlite** (Postgres in WASM) database running entirely in the browser.

## Stack

- **Vite + React** — a pure static SPA, no backend and no server runtime; deployable to GitHub Pages
- **@xyflow/react (React Flow)** — node graph editor
- **@electric-sql/pglite** — in-browser Postgres, persisted to IndexedDB (`idb://workflow-studio`)
- **shadcn/ui** (Radix base) — dialogs, selects, popovers, dropdowns, alert dialogs, toasts
- **papaparse** — CSV parsing
- **CodeMirror** (`@uiw/react-codemirror`) — every code surface (SQL, JS, JSON) is a syntax-highlighted editor
- **Vercel AI SDK** (`ai` + `@ai-sdk/react` + `@ai-sdk/openai`) — the chat assistant talks to the OpenAI API straight from the browser, no server
- **AI Elements** — pre-made chat UI components (conversation, messages, prompt input, tool cards) installed from Vercel's shadcn registry
- Workflow graphs are persisted to **localStorage** (PGlite holds the data tables; the graphs are small JSON, so localStorage keeps them simple); chat transcripts are persisted to **PGlite** (`chat_messages` table, keyed by workflow)

## Run

```bash
npm install
npm run dev       # local dev server
npm run build     # static build into dist/
npm run preview   # serve the production build locally
```

## Deploy to GitHub Pages

Pushing to `main` triggers `.github/workflows/deploy.yml`, which builds `dist/` and publishes it with the official Pages actions — enable **Settings → Pages → Source: GitHub Actions** in the repo once. Manual alternative: `npm run deploy` (publishes `dist/` to a `gh-pages` branch). The Vite config uses `base: "./"`, so the build works from any subpath.

## Pages

- **Home** (`#/`) — start a new empty workflow, open one of your saved workflows, or launch an **example**. The first example is *Simple conciliation* (the `use_cases/simple_conciliation` scenario, bundled with its CSVs so it runs immediately).
- **Editor** (`#/w/<id>`) — the node canvas. The logo navigates back home.

## Node types

| Node | What it does |
|------|--------------|
| **File** | Pick a `.csv` / `.json` / `.txt` file. A **parser script** (JS, editable in CodeMirror, defaulted from the file extension) receives `content`, `fileName`, and `parseCsv()` and must return an array of row objects, which are loaded into the target PGlite table (column types inferred). The 👁 button previews the raw file with a format-specific view: CSV as a table, JSON pretty-printed, anything else as plain text. |
| **Script** | JavaScript (async allowed). In scope: `inputs` (upstream outputs), `input` (first upstream output), `query(sql)` (run SQL against PGlite), `log(...)`. The return value becomes the node's output — return a SQL string to feed a downstream SQL node. |
| **SQL** | Executes SQL against PGlite. `{{input}}` / `{{input0}}`, `{{input1}}`… placeholders are replaced with upstream node outputs (e.g. SQL built by a script node). |
| **Visualization** | Runs a SQL query and renders the result as a table, inline preview plus a full-screen dialog. Also supports `{{input}}` templating. |

## AI assistant

The **Assistant** button in the editor toolbar opens a resizable chat panel on the right of the canvas.

- **Bring your own key**: the first time you open it, it asks for an OpenAI API key. The key is encrypted at rest (AES-GCM with a non-extractable WebCrypto key kept in IndexedDB) and is only ever sent to `api.openai.com`. You can replace or forget it from the panel's settings, and pick the model (GPT-5.1 / GPT-5 mini / GPT-4.1 / GPT-4o).
- **It operates the workflow through tools**: `list_nodes`, `get_node`, `add_node`, `update_node`, `connect_nodes`, `delete_node`, `run_node`, `run_workflow`, `get_run_history`, and `query_database`. It can build node graphs, write the SQL/scripts, execute them, read the errors and fix them — everything it changes appears live on the canvas and is auto-saved. (It can't attach files: create the file node, then pick the file yourself.)
- **Chat history is per-workflow** and persisted in PGlite, so it survives reloads; clear it with the trash button in the panel header.

Since the whole app is static, the model runs client-side against OpenAI's CORS-enabled API — use a budget-capped project key.

## How execution works

- **Run all** executes every node in topological order (`src/lib/engine.ts`); cycles are rejected.
- The **play button on a node** runs that node plus everything downstream of it.
- Node outputs flow along edges: file → table name, sql/viz → result rows, script → its return value.
- A failed node marks its downstream nodes as skipped.

## Project layout

```
src/
  main.tsx            entry point (mounts the canvas + toaster)
  index.css           theme, fonts, scrollbars
  lib/
    db.ts             PGlite singleton + query helpers
    engine.ts         topo sort + node executors
    file-loader.ts    parser-script runtime + row insertion into PGlite
    workflow-store.ts localStorage persistence of workflows
    chat-store.ts     chat transcripts in PGlite (per workflow)
    api-key-store.ts  encrypted OpenAI key (WebCrypto + IndexedDB) + model pref
    types.ts          node data types
    ai/
      agent-api.ts    imperative canvas API the chat tools call (via a ref)
      tools.ts        AI SDK tool definitions (zod schemas)
      transport.ts    browser-side ChatTransport (streamText, no server)
      system-prompt.ts
  components/ai-elements/  chat UI from Vercel's AI Elements registry
  components/workflow/
    canvas.tsx        React Flow canvas, toolbar, workflow switching, run wiring
    chat-panel.tsx    AI assistant side panel (key gate, chat, settings)
    run-context.tsx   context exposing runNode to nodes
    results-table.tsx query result rendering
    code-editor.tsx         shared CodeMirror wrapper (sql/js/json/text)
    code-editor-drawer.tsx  expanded CodeMirror editor (side drawer)
    file-preview-dialog.tsx format-specific file preview (table / json / text)
    nodes/
      file-node.tsx / sql-node.tsx / script-node.tsx / viz-node.tsx
      node-wrapper.tsx  shared node chrome (status, run, delete, handles)
```

## Known limits (deliberate, this is an experiment)

- File contents are stored in the node graph in localStorage — fine for small files, not for big ones (~5 MB localStorage cap).
- Scripts (node scripts and file parser scripts) run via `new Function` in the page context — not a security sandbox.
- The OpenAI key is encrypted at rest, but any script running in the page (including node scripts) could use it — inherent to a backend-less app. Use a scoped, budget-capped key.
- A SQL node can `DROP TABLE chat_messages`; the chat store just recreates it (history is lost, nothing crashes).
