from __future__ import annotations

import json
import os
import re
import sqlite3
from datetime import date, datetime
from pathlib import Path
from typing import Any

import duckdb


SAFE_IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
QUALIFIED_REFERENCE = re.compile(r"\b((?:[A-Za-z_][A-Za-z0-9_]*\.)?[A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)\b")
UNSAFE_EXPRESSION = re.compile(
    r"(;|--|/\*|\*/|\b(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|COPY|ATTACH|DETACH|INSTALL|LOAD|EXPORT|PRAGMA|VACUUM|CALL)\b|\b(read_csv|read_json|read_parquet|parquet_scan|glob|httpfs)\b)",
    re.IGNORECASE,
)
NUMERIC_TYPES = ("TINYINT", "SMALLINT", "INTEGER", "BIGINT", "HUGEINT", "UTINYINT", "USMALLINT", "UINTEGER", "UBIGINT", "UHUGEINT", "DECIMAL", "NUMERIC", "REAL", "FLOAT", "DOUBLE")
MEASURE_WORDS = ("amount", "revenue", "sales", "price", "quantity", "qty", "count", "total", "cost", "value", "num")


def quote_identifier(value: str) -> str:
    if not SAFE_IDENTIFIER.fullmatch(value):
        raise ValueError(f"unsafe identifier: {value}")
    return f'"{value}"'


def quote_table_reference(value: str) -> str:
    parts = value.split(".")
    if len(parts) not in {1, 2}:
        raise ValueError(f"unsafe table reference: {value}")
    return ".".join(quote_identifier(part) for part in parts)


def json_value(value: Any) -> Any:
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if hasattr(value, "as_tuple"):
        return float(value)
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    return value


def humanize(value: str) -> str:
    return value.replace("_", " ").strip().title()


def _schema_path() -> Path | None:
    configured = os.environ.get("RDS_AGENT_SCHEMA_PATH")
    candidates = [
        Path(configured) if configured else None,
        Path(__file__).resolve().parents[3] / "rds_agent" / "adapters" / "sqlite_schema.sql",
    ]
    return next((path for path in candidates if path and path.exists()), None)


def _fallback_schema() -> str:
    return """
    CREATE TABLE IF NOT EXISTS tables (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, description TEXT NOT NULL DEFAULT '', tags TEXT, grain TEXT, entities TEXT, active BOOLEAN DEFAULT TRUE);
    CREATE TABLE IF NOT EXISTS columns (id INTEGER PRIMARY KEY AUTOINCREMENT, table_id INTEGER NOT NULL, name TEXT NOT NULL, type TEXT NOT NULL, description TEXT, is_primary_key BOOLEAN DEFAULT FALSE, is_foreign_key BOOLEAN DEFAULT FALSE, foreign_key_table TEXT, foreign_key_column TEXT, enum_values TEXT, nullable BOOLEAN DEFAULT TRUE, UNIQUE(table_id, name));
    CREATE TABLE IF NOT EXISTS joins (id INTEGER PRIMARY KEY AUTOINCREMENT, left_table TEXT NOT NULL, left_column TEXT NOT NULL, right_table TEXT NOT NULL, right_column TEXT NOT NULL, join_type TEXT DEFAULT 'INNER', cardinality TEXT, description TEXT, name TEXT, auto_join BOOLEAN DEFAULT TRUE, priority INTEGER DEFAULT 100, fan_out_risk BOOLEAN DEFAULT FALSE, temporal_validity TEXT, UNIQUE(left_table, left_column, right_table, right_column));
    CREATE TABLE IF NOT EXISTS domains (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL, description TEXT, allowed_tables TEXT, allowed_metrics TEXT, default_timezone TEXT DEFAULT 'Asia/Shanghai', default_currency TEXT DEFAULT 'CNY', active BOOLEAN DEFAULT TRUE);
    CREATE TABLE IF NOT EXISTS entities (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, table_name TEXT NOT NULL, entity_type TEXT NOT NULL DEFAULT 'primary', keys TEXT, expr TEXT, references_entity TEXT, active BOOLEAN DEFAULT TRUE, UNIQUE(name, table_name));
    CREATE TABLE IF NOT EXISTS measures (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL, expression TEXT NOT NULL, table_name TEXT, aggregation TEXT, data_type TEXT DEFAULT 'DECIMAL', unit TEXT, additive BOOLEAN, time_additive BOOLEAN, active BOOLEAN DEFAULT TRUE);
    CREATE TABLE IF NOT EXISTS metrics (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', expression TEXT NOT NULL, tables TEXT NOT NULL, filters TEXT, time_column TEXT, unit TEXT, data_type TEXT DEFAULT 'DECIMAL', metric_type TEXT DEFAULT 'simple', certification TEXT DEFAULT 'draft', valid_dimensions TEXT, active BOOLEAN DEFAULT TRUE);
    CREATE TABLE IF NOT EXISTS dimensions (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL, table_name TEXT NOT NULL, column_name TEXT NOT NULL, mappings TEXT, dimension_type TEXT DEFAULT 'categorical', granularities TEXT, filter_column TEXT, active BOOLEAN DEFAULT TRUE);
    CREATE TABLE IF NOT EXISTS terms (id INTEGER PRIMARY KEY AUTOINCREMENT, term TEXT NOT NULL, synonyms TEXT NOT NULL, category TEXT, description TEXT, standard_name TEXT, maps_to TEXT, active BOOLEAN DEFAULT TRUE);
    CREATE TABLE IF NOT EXISTS filters (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL, expression TEXT NOT NULL, description TEXT, applies_to TEXT, synonyms TEXT, active BOOLEAN DEFAULT TRUE);
    CREATE TABLE IF NOT EXISTS examples (id INTEGER PRIMARY KEY AUTOINCREMENT, question TEXT NOT NULL, sql TEXT NOT NULL, question_type TEXT, tags TEXT, description TEXT, active BOOLEAN DEFAULT TRUE);
    CREATE TABLE IF NOT EXISTS metadata_versions (id INTEGER PRIMARY KEY AUTOINCREMENT, entity_type TEXT NOT NULL, entity_id INTEGER NOT NULL, version INTEGER NOT NULL, data TEXT NOT NULL, change_description TEXT, changed_by TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
    """


def _ensure_column(connection: sqlite3.Connection, table: str, name: str, definition: str) -> None:
    columns = {row[1] for row in connection.execute(f"PRAGMA table_info({table})")}
    if name not in columns:
        connection.execute(f"ALTER TABLE {table} ADD COLUMN {name} {definition}")


class SemanticRepository:
    def __init__(self, path: Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._ensure_schema()

    def connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        return connection

    def _ensure_schema(self) -> None:
        connection = self.connect()
        try:
            schema = _schema_path()
            if schema:
                connection.executescript(schema.read_text(encoding="utf-8"))
            else:
                connection.executescript(_fallback_schema())
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS semantic_drafts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    object_type TEXT NOT NULL,
                    table_name TEXT NOT NULL,
                    source_column TEXT,
                    canonical_name TEXT NOT NULL,
                    display_name TEXT NOT NULL,
                    description TEXT NOT NULL DEFAULT '',
                    expression TEXT,
                    metadata_json TEXT NOT NULL DEFAULT '{}',
                    status TEXT NOT NULL DEFAULT 'draft',
                    confidence REAL NOT NULL DEFAULT 0,
                    source TEXT NOT NULL DEFAULT 'auto_scan',
                    evidence TEXT NOT NULL DEFAULT '',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
                CREATE INDEX IF NOT EXISTS idx_semantic_drafts_table ON semantic_drafts(table_name);
                CREATE INDEX IF NOT EXISTS idx_semantic_drafts_status ON semantic_drafts(status);
                CREATE TABLE IF NOT EXISTS semantic_publications (
                    revision INTEGER PRIMARY KEY,
                    counts TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
                """
            )
            _ensure_column(connection, "metrics", "metric_type", "TEXT DEFAULT 'simple'")
            _ensure_column(connection, "metrics", "certification", "TEXT DEFAULT 'draft'")
            _ensure_column(connection, "metrics", "valid_dimensions", "TEXT")
            _ensure_column(connection, "dimensions", "dimension_type", "TEXT DEFAULT 'categorical'")
            _ensure_column(connection, "dimensions", "granularities", "TEXT")
            _ensure_column(connection, "dimensions", "filter_column", "TEXT")
            connection.commit()
        finally:
            connection.close()

    def replace_drafts(self, drafts: list[dict[str, Any]]) -> list[dict[str, Any]]:
        connection = self.connect()
        try:
            connection.execute("DELETE FROM semantic_drafts")
            for draft in drafts:
                connection.execute(
                    """
                    INSERT INTO semantic_drafts
                    (object_type, table_name, source_column, canonical_name, display_name, description, expression, metadata_json, status, confidence, source, evidence)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)
                    """,
                    (
                        draft["object_type"], draft["table_name"], draft.get("source_column"), draft["canonical_name"],
                        draft["display_name"], draft.get("description", ""), draft.get("expression"),
                        json.dumps(draft.get("metadata", {}), ensure_ascii=False), draft.get("confidence", 0),
                        draft.get("source", "auto_scan"), draft.get("evidence", ""),
                    ),
                )
            connection.commit()
            return self._draft_rows(connection)
        finally:
            connection.close()

    def _draft_rows(self, connection: sqlite3.Connection) -> list[dict[str, Any]]:
        rows = connection.execute("SELECT * FROM semantic_drafts ORDER BY table_name, object_type, id").fetchall()
        return [self._draft_row(row) for row in rows]

    @staticmethod
    def _draft_row(row: sqlite3.Row) -> dict[str, Any]:
        item = dict(row)
        item["metadata"] = json.loads(item.pop("metadata_json") or "{}")
        return item

    def drafts(self) -> list[dict[str, Any]]:
        connection = self.connect()
        try:
            return self._draft_rows(connection)
        finally:
            connection.close()

    def update_draft(self, draft_id: int, patch: dict[str, Any]) -> dict[str, Any] | None:
        allowed = {"canonical_name", "display_name", "description", "expression", "status", "confidence"}
        values = {key: value for key, value in patch.items() if key in allowed}
        if "status" in values and values["status"] not in {"draft", "approved", "rejected"}:
            raise ValueError("status must be draft, approved or rejected")
        if "canonical_name" in values and not SAFE_IDENTIFIER.fullmatch(str(values["canonical_name"])):
            raise ValueError("canonical_name must be a safe identifier")
        if not values:
            raise ValueError("no editable fields supplied")
        connection = self.connect()
        try:
            row = connection.execute("SELECT id FROM semantic_drafts WHERE id = ?", (draft_id,)).fetchone()
            if not row:
                return None
            assignments = ", ".join(f"{key} = ?" for key in values)
            connection.execute(f"UPDATE semantic_drafts SET {assignments}, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [*values.values(), draft_id])
            connection.commit()
            return self._draft_row(connection.execute("SELECT * FROM semantic_drafts WHERE id = ?", (draft_id,)).fetchone())
        finally:
            connection.close()

    def summary(self) -> dict[str, Any]:
        connection = self.connect()
        try:
            draft_count = connection.execute("SELECT COUNT(*) FROM semantic_drafts").fetchone()[0]
            approved_count = connection.execute("SELECT COUNT(*) FROM semantic_drafts WHERE status = 'approved'").fetchone()[0]
            revision = connection.execute("SELECT COALESCE(MAX(revision), 0) FROM semantic_publications").fetchone()[0]
            published = {table: connection.execute(f"SELECT COUNT(*) FROM {table} WHERE active = TRUE").fetchone()[0] for table in ("tables", "metrics", "dimensions", "measures", "terms", "entities")}
            return {"metadata_db": str(self.path), "revision": revision, "draft_count": draft_count, "approved_count": approved_count, "published": published}
        finally:
            connection.close()

    def tables(self, database_tables: list[dict[str, Any]]) -> list[dict[str, Any]]:
        connection = self.connect()
        try:
            result = []
            for item in database_tables:
                name = item["name"]
                draft_count = connection.execute("SELECT COUNT(*) FROM semantic_drafts WHERE table_name = ?", (name,)).fetchone()[0]
                published = connection.execute("SELECT 1 FROM tables WHERE name = ? AND active = TRUE", (name,)).fetchone() is not None
                result.append({**item, "draft_count": draft_count, "published": published})
            return result
        finally:
            connection.close()

    def table(self, table_name: str, profile: dict[str, Any]) -> dict[str, Any]:
        connection = self.connect()
        try:
            drafts = connection.execute("SELECT * FROM semantic_drafts WHERE table_name = ? ORDER BY id", (table_name,)).fetchall()
            return {**profile, "drafts": [self._draft_row(row) for row in drafts]}
        finally:
            connection.close()

    def validate(self, database_profiles: dict[str, dict[str, Any]]) -> dict[str, Any]:
        errors: list[str] = []
        warnings: list[str] = []
        drafts = self.drafts()
        names: set[tuple[str, str]] = set()
        for draft in drafts:
            key = (draft["object_type"], draft["canonical_name"])
            if key in names and draft["status"] != "rejected":
                errors.append(f"duplicate canonical name: {draft['canonical_name']}")
            names.add(key)
            if draft["status"] == "rejected":
                continue
            profile = database_profiles.get(draft["table_name"])
            if profile is None:
                errors.append(f"unknown table: {draft['table_name']}")
                continue
            columns = {column["name"] for column in profile["columns"]}
            if draft.get("source_column") and draft["source_column"] not in columns:
                errors.append(f"unknown column: {draft['table_name']}.{draft['source_column']}")
            expression = draft.get("expression") or ""
            if expression and UNSAFE_EXPRESSION.search(expression):
                errors.append(f"unsafe expression: {draft['canonical_name']}")
            for table, column in QUALIFIED_REFERENCE.findall(expression):
                ref_profile = database_profiles.get(table)
                if ref_profile is None or column not in {item["name"] for item in ref_profile["columns"]}:
                    errors.append(f"unknown expression reference: {table}.{column}")
            if draft["status"] != "approved":
                warnings.append(f"pending approval: {draft['canonical_name']}")
        return {"valid": not errors and all(draft["status"] == "approved" for draft in drafts), "errors": errors, "warnings": warnings, "counts": {"drafts": len(drafts), "approved": sum(item["status"] == "approved" for item in drafts)}}

    def publish(self, database_profiles: dict[str, dict[str, Any]]) -> dict[str, Any]:
        validation = self.validate(database_profiles)
        if not validation["valid"]:
            raise ValueError(json.dumps(validation, ensure_ascii=False))
        connection = self.connect()
        try:
            connection.execute("BEGIN")
            drafts = self._draft_rows(connection)
            for draft in drafts:
                if draft["object_type"] != "table":
                    continue
                profile = database_profiles[draft["table_name"]]
                connection.execute(
                    """
                    INSERT INTO tables (name, description, tags, grain, entities, active)
                    VALUES (?, ?, ?, ?, ?, TRUE)
                    ON CONFLICT(name) DO UPDATE SET description=excluded.description, tags=excluded.tags, grain=excluded.grain, entities=excluded.entities, active=TRUE
                    """,
                    (draft["canonical_name"], draft["description"], json.dumps([], ensure_ascii=False), f"one row per record in {draft['table_name']}", json.dumps([], ensure_ascii=False)),
                )
                table_id = connection.execute("SELECT id FROM tables WHERE name = ?", (draft["canonical_name"],)).fetchone()[0]
                connection.execute("DELETE FROM columns WHERE table_id = ?", (table_id,))
                for column in profile["columns"]:
                    connection.execute(
                        "INSERT INTO columns (table_id, name, type, description, is_primary_key, nullable) VALUES (?, ?, ?, ?, ?, ?)",
                        (table_id, column["name"], column["type"], column.get("description", ""), column.get("is_primary_key", False), column.get("null_count", 0) > 0),
                    )
            for draft in drafts:
                if draft["object_type"] == "measure":
                    expression = draft.get("expression") or f"SUM({draft['table_name']}.{draft['source_column']})"
                    connection.execute(
                        """
                        INSERT INTO measures (name, display_name, expression, table_name, aggregation, data_type, active)
                        VALUES (?, ?, ?, ?, 'sum', 'DECIMAL', TRUE)
                        ON CONFLICT(name) DO UPDATE SET display_name=excluded.display_name, expression=excluded.expression, table_name=excluded.table_name, active=TRUE
                        """,
                        (draft["canonical_name"], draft["display_name"], expression, draft["table_name"]),
                    )
                    connection.execute(
                        """
                        INSERT INTO metrics (name, display_name, description, expression, tables, filters, metric_type, certification, valid_dimensions, active)
                        VALUES (?, ?, ?, ?, ?, '[]', 'simple', 'draft', '[]', TRUE)
                        ON CONFLICT(name) DO UPDATE SET display_name=excluded.display_name, description=excluded.description, expression=excluded.expression, tables=excluded.tables, active=TRUE
                        """,
                        (draft["canonical_name"], draft["display_name"], draft["description"], expression, json.dumps([draft["table_name"]], ensure_ascii=False)),
                    )
                elif draft["object_type"] == "dimension":
                    metadata = draft["metadata"]
                    mappings = {str(value): [str(value)] for value in metadata.get("sample_values", []) if value is not None}
                    connection.execute(
                        """
                        INSERT INTO dimensions (name, display_name, table_name, column_name, mappings, dimension_type, granularities, filter_column, active)
                        VALUES (?, ?, ?, ?, ?, 'categorical', '[]', ?, TRUE)
                        ON CONFLICT(name) DO UPDATE SET display_name=excluded.display_name, table_name=excluded.table_name, column_name=excluded.column_name, mappings=excluded.mappings, filter_column=excluded.filter_column, active=TRUE
                        """,
                        (draft["canonical_name"], draft["display_name"], draft["table_name"], draft["source_column"], json.dumps(mappings, ensure_ascii=False), draft["source_column"]),
                    )
                elif draft["object_type"] == "entity":
                    connection.execute(
                        "INSERT INTO entities (name, table_name, entity_type, keys, active) VALUES (?, ?, 'primary', ?, TRUE) ON CONFLICT(name, table_name) DO UPDATE SET keys=excluded.keys, active=TRUE",
                        (draft["canonical_name"], draft["table_name"], json.dumps([draft["source_column"]], ensure_ascii=False)),
                    )
                elif draft["object_type"] == "term":
                    connection.execute(
                        "INSERT INTO terms (term, synonyms, standard_name, active) VALUES (?, '[]', ?, TRUE)",
                        (draft["canonical_name"], draft["display_name"]),
                    )
            revision = connection.execute("SELECT COALESCE(MAX(revision), 0) + 1 FROM semantic_publications").fetchone()[0]
            counts = {table: connection.execute(f"SELECT COUNT(*) FROM {table} WHERE active = TRUE").fetchone()[0] for table in ("tables", "metrics", "dimensions", "measures", "terms", "entities")}
            connection.execute("INSERT INTO semantic_publications (revision, counts) VALUES (?, ?)", (revision, json.dumps(counts, ensure_ascii=False)))
            connection.commit()
            return {"revision": revision, "counts": counts}
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()


def profile_database(connection: duckdb.DuckDBPyConnection) -> list[dict[str, Any]]:
    profiles: list[dict[str, Any]] = []
    table_entries = connection.execute(
        """
        SELECT table_schema, table_name
        FROM information_schema.tables
        WHERE table_type = 'BASE TABLE'
          AND table_schema NOT IN ('information_schema', 'pg_catalog')
        ORDER BY table_schema, table_name
        """
    ).fetchall()
    for schema_name, raw_table_name in table_entries:
        schema_name, raw_table_name = str(schema_name), str(raw_table_name)
        table_name = raw_table_name if schema_name in {"main", "db"} else f"{schema_name}.{raw_table_name}"
        qualified_table = quote_table_reference(f"{schema_name}.{raw_table_name}")
        columns: list[dict[str, Any]] = []
        for row in connection.execute(f"DESCRIBE {qualified_table}").fetchall():
            name, type_name = str(row[0]), str(row[1])
            null_count = int(connection.execute(f"SELECT COUNT(*) FROM {qualified_table} WHERE {quote_identifier(name)} IS NULL").fetchone()[0])
            distinct_count = int(connection.execute(f"SELECT COUNT(DISTINCT {quote_identifier(name)}) FROM {qualified_table}").fetchone()[0])
            samples = [json_value(item[0]) for item in connection.execute(f"SELECT DISTINCT {quote_identifier(name)} FROM {qualified_table} WHERE {quote_identifier(name)} IS NOT NULL LIMIT 5").fetchall()]
            row_count = int(connection.execute(f"SELECT COUNT(*) FROM {qualified_table}").fetchone()[0])
            columns.append({"name": name, "type": type_name, "null_count": null_count, "distinct_count": distinct_count, "sample_values": samples, "row_count": row_count, "description": ""})
        profiles.append({"name": table_name, "database_name": schema_name, "raw_name": raw_table_name, "row_count": int(connection.execute(f"SELECT COUNT(*) FROM {qualified_table}").fetchone()[0]), "columns": columns})
    return profiles


def build_drafts(profiles: list[dict[str, Any]]) -> list[dict[str, Any]]:
    drafts: list[dict[str, Any]] = []
    for profile in profiles:
        table = profile["name"]
        drafts.append({"object_type": "table", "table_name": table, "canonical_name": table, "display_name": humanize(table), "description": f"Auto-scanned table {table}", "confidence": 1.0, "evidence": "SHOW TABLES and DESCRIBE", "metadata": {"row_count": profile["row_count"]}})
        for column in profile["columns"]:
            name = column["name"]
            lower = name.lower()
            is_id = lower == "id" or lower.endswith("_id")
            if is_id and column["null_count"] == 0:
                drafts.append({"object_type": "entity", "table_name": table, "source_column": name, "canonical_name": table.rstrip("s"), "display_name": humanize(table.rstrip("s")), "description": f"Entity identified by {name}", "confidence": 0.92, "evidence": "non-null identifier-like column", "metadata": {"sample_values": column["sample_values"]}})
            base = {"table_name": table, "source_column": name, "display_name": humanize(name), "description": f"Auto-scanned field {table}.{name}", "metadata": {"sample_values": column["sample_values"], "distinct_count": column["distinct_count"], "row_count": column["row_count"]}}
            if any(token in lower for token in ("at", "date", "time")) and any(token in column["type"].upper() for token in ("DATE", "TIME")):
                continue
            if column["type"].upper().split("(")[0] in NUMERIC_TYPES and (column["distinct_count"] > 20 or any(word in lower for word in MEASURE_WORDS)):
                drafts.append({**base, "object_type": "measure", "canonical_name": name, "expression": f"SUM({table}.{name})", "confidence": 0.88, "evidence": f"numeric type {column['type']} and measure-like name or cardinality"})
            elif column["type"].upper() in {"VARCHAR", "TEXT", "BOOLEAN"} and column["distinct_count"] <= 50:
                drafts.append({**base, "object_type": "dimension", "canonical_name": name, "confidence": 0.86, "evidence": f"categorical type with {column['distinct_count']} distinct values"})
            drafts.append({**base, "object_type": "column", "canonical_name": f"{table}_{name}", "confidence": 1.0, "evidence": "DESCRIBE column metadata"})
    return drafts
