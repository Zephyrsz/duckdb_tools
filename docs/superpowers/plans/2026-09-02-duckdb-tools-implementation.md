# DuckDB 数据工作台 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a runnable React/Vite + FastAPI/DuckDB web tool for CSV/Excel import, table browsing, and read-only SQL queries.

**Architecture:** A FastAPI service owns uploaded files and a persistent DuckDB database at `data/workspace.duckdb`. A React single-page client calls JSON APIs, keeps current workspace state locally, and renders an operate-first three-pane workbench with import, table browser, and query modes.

**Tech Stack:** React 18, Vite, TypeScript, Python 3.11+, FastAPI, Uvicorn, DuckDB, openpyxl, pytest.

**Spec:** `docs/superpowers/specs/2026-09-02-duckdb-tools-design.md`

## Global Constraints

- Support `.csv` and `.xlsx` uploads with a header row.
- Use DuckDB `read_csv_auto` for CSV and `openpyxl` for Excel.
- Persist the database at `data/workspace.duckdb` and uploads under `data/uploads`.
- Query endpoint accepts only one read-only statement beginning with `SELECT`, `WITH`, `DESCRIBE`, `SHOW`, or `EXPLAIN`.
- UI must expose loading, empty, success, and error states and remain usable below 720px.

### Task 1: Backend project and upload preview

**Files:**
- Create: `backend/app/main.py`
- Create: `backend/app/__init__.py`
- Create: `backend/requirements.txt`
- Create: `backend/tests/test_api.py`
- Create: `data/uploads/.gitkeep`

**Interfaces:**
- `POST /api/upload/preview` returns `{filename, stored_path, kind, columns, preview}`.
- `preview_upload(path, filename)` returns normalized column metadata and JSON-safe rows.

- [ ] Write tests for CSV preview, Excel preview, and unsupported extensions.
- [ ] Run `pytest backend/tests/test_api.py -q` and observe missing app failure.
- [ ] Implement FastAPI upload storage and preview helpers using DuckDB CSV inference and openpyxl worksheet values.
- [ ] Add CORS for the Vite dev origin and a health route.
- [ ] Run the focused tests and confirm they pass.

### Task 2: DuckDB import, table APIs, and read-only query endpoint

**Files:**
- Modify: `backend/app/main.py`
- Modify: `backend/tests/test_api.py`

**Interfaces:**
- `POST /api/import` accepts `{stored_path, table_name, has_header}` and returns `{table_name, row_count, columns}`.
- `GET /api/database` returns `{database, tables}`.
- `GET /api/tables/{table_name}` returns `{table_name, columns, rows, row_count}`.
- `POST /api/query` accepts `{sql}` and returns `{columns, rows, row_count, elapsed_ms}`.

- [ ] Add failing tests for importing CSV, listing tables, reading a table, allowing SELECT, and rejecting mutating/multi-statement SQL.
- [ ] Run focused tests to confirm failures are due to missing endpoints.
- [ ] Implement identifier quoting, import transactions, JSON-safe value conversion, table metadata, and SQL first-keyword validation.
- [ ] Run all backend tests and confirm pass.

### Task 3: React/Vite client shell and API integration

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/tsconfig.json`
- Create: `frontend/vite.config.ts`
- Create: `frontend/index.html`
- Create: `frontend/src/main.tsx`
- Create: `frontend/src/App.tsx`
- Create: `frontend/src/api.ts`
- Create: `frontend/src/types.ts`

**Interfaces:**
- `api.ts` exports typed `getDatabase`, `previewUpload`, `importFile`, `getTable`, and `runQuery` functions.
- `App.tsx` owns selected mode/table and renders the workbench regions.

- [ ] Add client setup and a build script.
- [ ] Implement initial database fetch and import/query action handlers.
- [ ] Render empty, loading, success, and error states with accessible labels.
- [ ] Run `npm install` and `npm run build` in `frontend`.

### Task 4: Operate-first visual system and responsive components

**Files:**
- Create: `frontend/src/styles.css`
- Create: `frontend/src/components/Icon.tsx`
- Create: `frontend/src/components/Sidebar.tsx`
- Create: `frontend/src/components/Topbar.tsx`
- Create: `frontend/src/components/ImportPanel.tsx`
- Create: `frontend/src/components/TableBrowser.tsx`
- Create: `frontend/src/components/SqlWorkspace.tsx`
- Create: `frontend/src/components/DataGrid.tsx`
- Modify: `frontend/src/App.tsx`

- [ ] Build the modular data-workbench composition from `DESIGN.md`.
- [ ] Add four-stage import rail, table list, field summary, SQL editor, result grid, focus styles, disabled/loading states, and responsive collapse under 720px.
- [ ] Add a single authored state transition for import completion and query result reveal, respecting reduced motion.
- [ ] Run `npm run build` and manually verify via the dev server.

### Task 5: Integrated verification and handoff

**Files:**
- Create: `README.md`

- [ ] Run backend tests from the project root.
- [ ] Run frontend build.
- [ ] Start FastAPI and Vite on available ports.
- [ ] Exercise upload preview, import, table browse, and SELECT query against a temporary sample file.
- [ ] Run the Impeccable detector against changed UI files and fix actionable findings.
- [ ] Document setup commands and API overview in `README.md`.
