# RDS Agent Semantic Workbench Design

## Goal

Extend `duckdb_tools` from a file browser into the business-facing configuration workbench for `rds_agent`. Users import data into the shared DuckDB database, scan its schema, review semantic drafts, edit definitions, validate them, and publish the approved metadata into the SQLite database consumed by `rds_agent`.

## Boundaries

- `workspace.duckdb` remains the business-data store owned by `duckdb_tools`.
- A configurable `RDS_AGENT_METADATA_DB` path points to the shared SQLite runtime metadata file. The default is `data/metadata.db`.
- The SQLite schema and object names follow `rds_agent/adapters/sqlite_schema.sql` and its `SQLiteCatalog`/`SQLiteSemanticLayer` APIs.
- YAML is not the runtime source of truth. `duckdb_tools` may export an audit seed snapshot, but publish writes SQLite directly so the two projects can share one file.
- Automatic inference creates drafts only. Publishing requires validation to pass.

## Semantic Draft Model

The scanner inspects every DuckDB table and column, including type, null ratio, distinct count, and up to five sample values. It derives candidates using deterministic rules:

- primary key candidate: a non-null, unique column named `id` or ending in `_id`;
- time candidate: DATE/TIMESTAMP columns or names ending in `_at`, `_date`, `_time`;
- dimension candidate: low-cardinality VARCHAR/BOOLEAN columns, with enum mappings when values are available;
- measure candidate: numeric columns whose names contain amount, revenue, price, quantity, count, total, or similar terms;
- entity candidate: table name and primary key candidate.

Each candidate carries `source`, `confidence`, and human-readable `evidence`. Drafts are persisted in SQLite tables owned by `duckdb_tools` (`semantic_drafts`, `semantic_draft_columns`) in the same metadata file, while published objects use the existing `tables`, `columns`, `entities`, `measures`, `metrics`, `dimensions`, `terms`, `filters`, `domains`, and `examples` tables.

## API

- `GET /api/semantic/summary`: metadata path, publication revision, draft status and counts.
- `GET /api/semantic/tables`: DuckDB tables with published/draft status.
- `GET /api/semantic/tables/{table_name}`: columns, profiling statistics and candidates.
- `POST /api/semantic/scan`: scan DuckDB and upsert drafts; never changes published objects.
- `PATCH /api/semantic/drafts/{draft_id}`: edit candidate kind, name, description, confidence override and approval state.
- `POST /api/semantic/validate`: validate approved drafts against DuckDB identifiers, safe expressions and required references; return errors and warnings.
- `POST /api/semantic/publish`: require a clean validation result, write the approved objects to the shared SQLite runtime tables, and increment `metadata_versions`.

## Frontend

The existing sidebar semantic placeholders become working modes: semantic overview, table detail/field annotation, and agent readiness. The UI shows scan time, draft/published counts, confidence, evidence, validation errors, and the publish action. Import, browse and SQL modes keep their existing behavior.

## Safety and Compatibility

- Identifier names are validated with the same safe pattern used by the existing API.
- Draft expressions are limited to simple qualified column references and aggregate expressions; semicolons, comments, DDL/DML keywords, and external scans are rejected.
- Publishing is transactional. A failed write rolls back the SQLite transaction and leaves the previous published metadata intact.
- `rds_agent` can consume the resulting file with `RDSAgent(metadata_db_path=..., db_path=...)` without changing its runtime code.

## Verification

Backend tests cover profiling, draft persistence, validation failures, transactional publish, and reading the published SQLite file through `rds_agent` adapters. Frontend verification is a TypeScript/Vite build plus API-driven smoke coverage for scan, edit, validate and publish states.
