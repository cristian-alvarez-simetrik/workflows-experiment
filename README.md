# Workflow Studio

A client-only, node-based data workflow platform. Build graphs of file / script / SQL / visualization nodes and execute them against a **PGlite** (Postgres in WASM) database running entirely in the browser.

## Stack

- **Vite + React** — a pure static SPA, no backend and no server runtime; deployable to GitHub Pages
- **@xyflow/react (React Flow)** — node graph editor
- **@electric-sql/pglite** — in-browser Postgres, persisted to IndexedDB (`idb://workflow-studio`)
- **shadcn/ui** (Radix base) — dialogs, selects, popovers, dropdowns, alert dialogs, toasts
- **papaparse** — CSV parsing
- **CodeMirror** (`@uiw/react-codemirror`) — every code surface (SQL, JS, JSON) is a syntax-highlighted editor
- Workflow graphs are persisted to **localStorage** (PGlite holds the data tables; the graphs are small JSON, so localStorage keeps them simple)

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
    types.ts          node data types
  components/workflow/
    canvas.tsx        React Flow canvas, toolbar, workflow switching, run wiring
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
