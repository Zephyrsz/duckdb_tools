# RDS Agent Semantic Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `duckdb_tools` the business-facing semantic configuration frontend while sharing DuckDB business data and SQLite runtime metadata with `rds_agent`.

**Architecture:** FastAPI owns DuckDB profiling and a SQLite metadata repository. Deterministic scanner rules create drafts, a validation service checks approved drafts, and a transactional publisher writes the `rds_agent` compatible tables and a metadata revision. React adds semantic overview, table annotation and agent readiness views on top of typed APIs.

**Tech Stack:** Python 3.11+, FastAPI, DuckDB, sqlite3, pytest, React 18, TypeScript, Vite.

**Spec:** `docs/superpowers/specs/2026-09-08-rds-agent-semantic-workbench-design.md`

## Global Constraints

- `workspace.duckdb` stores business data; the shared SQLite file stores runtime metadata.
- Automatic inference is draft-only and publishing requires a clean validation result.
- Published SQLite tables remain compatible with `rds_agent/adapters/sqlite_schema.sql`.
- Existing upload, table browser and read-only query APIs remain backward compatible.

### Task 1: SQLite repository and deterministic scanner

**Files:**
- Create: `backend/app/semantic.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_semantic_api.py`

**Interfaces:**
- `SemanticRepository(path: Path)` initializes the shared SQLite schema and draft/revision tables.
- `scan_database(connection) -> list[dict]` returns table profiles and draft candidates.
- `SemanticRepository.replace_drafts(profiles) -> None` persists scan output transactionally.
- `SemanticRepository.summary() -> dict`, `tables() -> list[dict]`, `table(name) -> dict`.

- [ ] Write failing tests for scanner inference, SQLite persistence, and summary counts.
- [ ] Run `pytest backend/tests/test_semantic_api.py -q` and confirm missing module/endpoints fail.
- [ ] Implement schema loading from `rds_agent/adapters/sqlite_schema.sql` with an environment-configurable path and local fallback, then add `semantic_drafts`, `semantic_draft_columns`, and `metadata_versions` tables.
- [ ] Implement DuckDB profiling with safe quoted identifiers, null/distinct counts and sample values; apply deterministic candidate rules with evidence and confidence.
- [ ] Add `GET /api/semantic/summary`, `GET /api/semantic/tables`, `GET /api/semantic/tables/{table_name}`, and `POST /api/semantic/scan`.
- [ ] Run focused tests and confirm they pass.

### Task 2: Draft editing, validation, and SQLite publish

**Files:**
- Modify: `backend/app/semantic.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_semantic_api.py`

**Interfaces:**
- `SemanticRepository.update_draft(draft_id, patch) -> dict`.
- `SemanticRepository.validate() -> dict` returns `{valid, errors, warnings, counts}`.
- `SemanticRepository.publish() -> dict` writes approved drafts to `rds_agent` tables and returns revision/counts.

- [ ] Add failing tests for draft patching, rejection of missing columns and unsafe expressions, transactional publish, and `SQLiteSemanticLayer` resolution from the published file.
- [ ] Implement strict Pydantic patch validation and safe expression checks.
- [ ] Implement validation of table/column identifiers, candidate references, duplicate canonical names, and required display fields.
- [ ] Implement publisher mappings for tables/columns/entities, measures, metrics, dimensions and terms; preserve unrelated published rows and upsert matching canonical names in one transaction.
- [ ] Add `PATCH /api/semantic/drafts/{draft_id}`, `POST /api/semantic/validate`, and `POST /api/semantic/publish`.
- [ ] Run backend tests including the existing API suite.

### Task 3: Semantic workbench frontend

**Files:**
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/api.ts`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/Sidebar.tsx`
- Create: `frontend/src/components/SemanticOverview.tsx`
- Create: `frontend/src/components/SemanticTableDetail.tsx`
- Modify: `frontend/src/styles.css`

**Interfaces:**
- Typed API functions: `getSemanticSummary`, `getSemanticTables`, `getSemanticTable`, `scanSemantic`, `updateSemanticDraft`, `validateSemantic`, `publishSemantic`.
- `App` owns semantic mode and selected semantic table while preserving existing modes.

- [ ] Add TypeScript types and failing compile references for semantic payloads/actions.
- [ ] Implement API functions and semantic state transitions in `App`.
- [ ] Replace disabled semantic sidebar items with overview, field annotation and agent readiness navigation.
- [ ] Render scan controls, candidate confidence/evidence, editable fields, validation results and publish status with loading/error/empty states.
- [ ] Add responsive styling consistent with the existing workbench.
- [ ] Run `npm run build` and fix all type/build errors.

### Task 4: Integration documentation and verification

**Files:**
- Modify: `README.md`
- Create: `docs/guides/semantic-integration.md`

- [ ] Document `RDS_AGENT_METADATA_DB`, shared DuckDB path, scan/edit/validate/publish lifecycle, and the exact `RDSAgent(metadata_db_path=...)` startup example.
- [ ] Run the complete backend test suite and frontend build.
- [ ] Run a smoke script that imports a CSV, scans it, validates one approved metric/dimension, publishes, and resolves it through the `rds_agent` SQLite adapters.
- [ ] Review the diff for accidental changes and report any remaining limitations.
