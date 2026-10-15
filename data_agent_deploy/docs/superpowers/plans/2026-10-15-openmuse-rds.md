# OpenMuse RDS local deployment implementation plan

**Goal:** Install a local OpenMuse copy and query the existing DuckDB through RDS's published semantic layer with read-only connections.

**Architecture:** OpenMuse keeps its CopilotKit Runtime and model conversation agent. Shared server tools call a loopback Python HTTP adapter using the existing RDS SDK, semantic compiler, SQLGuard and executor. Each request owns and closes its DuckDB connection. OpenMuse renders structured query results with its existing React Native tool hooks.

**Tech stack:** Node 24, pnpm 11.19.0, OpenMuse's pinned CopilotKit 1.70.1, Python, FastAPI, RDS Agent, DuckDB 1.5.5.

**Spec:** The architecture agreed in this chat; the user requested implementation in `data_agent_deploy/`.

## Constraints

- Keep the original OpenMuse and RDS repositories unchanged; use a deployment copy and configured RDS source path.
- Default to `duckdb_tools/data/workspace.duckdb` and `rds_agent/var/metadata.db`; never fall back to sample databases or seed metadata.
- Enforce `read_only=True`; defer ACL. Expose no raw SQL or database-path tool arguments.
- Do not invent Intelligence credentials or bypass its authentication. Missing credentials must be diagnosed explicitly.
- Keep tokens server-side and generated local settings ignored by Git. Bind services to loopback.
- Release connections after every request; communicate import/query file-lock conflicts without disconnecting another service automatically.

## Tasks

1. [x] Copy OpenMuse with upstream revision, excluding credentials, dependencies and Git history.
2. [x] Install frozen Node dependencies and isolated Python dependencies.
3. [x] Write API integration tests against temporary DuckDB and real published SQLite metadata: authentication, catalog, semantic compilation, filtering, invalid requests, and connection release.
4. [x] Run tests to confirm the missing API fails; implement `rds_api/app.py` and pass those tests.
5. [x] Write HTTP client/tool contract tests with a local HTTP fixture: validated payloads, authorization, upstream failures and cancellation.
6. [x] Implement domain schema, server client, shared tools, conversation/task registration and authenticated proxy endpoints. Run focused tests and TypeScript checks.
7. [x] Add a native result card displaying rows, warnings and expandable SQL using `useRenderTool`.
8. [x] Add setup/start/status/stop/check scripts and configuration examples. Keep missing Intelligence/model credentials actionable.
9. [x] Run Python tests, Node integration tests, typecheck, server build and web export; run a read-only aggregate against the real 416-row dataset and compare with independent SQL.
10. [x] Record exact verification results and remaining credential-dependent checks in README.

## Verification commands

```sh
.venv/bin/python -m pytest tests -q
cd openmuse
corepack pnpm exec tsx --import ./tests/setup.ts --test tests/rds.test.ts
corepack pnpm typecheck
corepack pnpm build:server
corepack pnpm build:web
```

The live smoke check requests catalog and query over HTTP using the local token without printing it. Connection release and reopen-for-write are checked against temporary databases. Full chat verification requires configured CopilotKit Intelligence and a model provider.

Results: 9 Python tests and 20 relevant Node tests passed. Typecheck, server compilation and Web export passed. Actual RDS API and OpenMuse TypeScript tools returned 416 records; grouped count and amount queries returned 33 country groups matching independent SQL. RDS and static Web are running locally. The user chose to configure model/Intelligence credentials later, so the actual OpenMuse API remains stopped.
