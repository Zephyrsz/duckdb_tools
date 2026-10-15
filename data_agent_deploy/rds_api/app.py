from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
import math
import os
from pathlib import Path
import secrets
import sqlite3
import sys
import threading
from typing import Literal

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field

RDS_ROOT = Path(os.environ.get("RDS_AGENT_ROOT", Path(__file__).resolve().parents[3] / "rds_agent"))
sys.path.insert(0, str(RDS_ROOT))

from core.semantic import SemanticQuery
from integration.sdk import RDSAgent


@dataclass(frozen=True)
class Settings:
    db_path: Path
    metadata_db_path: Path
    token: str

    @classmethod
    def from_env(cls):
        token = os.environ.get("RDS_API_TOKEN", "").strip()
        if len(token) < 32:
            raise ValueError("Set RDS_API_TOKEN to a server-only token of at least 32 characters")
        return cls(
            Path(os.environ["RDS_DB_PATH"]).expanduser().resolve(),
            Path(os.environ["RDS_METADATA_DB_PATH"]).expanduser().resolve(),
            token,
        )


class OrderBy(BaseModel):
    model_config = ConfigDict(extra="forbid")
    field: str = Field(min_length=1, max_length=128)
    direction: Literal["asc", "desc"] = "desc"


class QueryRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    question: str = Field(default="", max_length=4000)
    metrics: list[str] = Field(min_length=1, max_length=20)
    dimensions: list[str] = Field(default_factory=list, max_length=10)
    filters: dict[str, str | int | float | bool | list[str | int | float | bool]] = Field(default_factory=dict)
    semantic_filters: list[str] = Field(default_factory=list, max_length=20)
    time_range: str | None = Field(default=None, max_length=100)
    order_by: OrderBy | None = None
    limit: int = Field(default=100, ge=1, le=1000)

def json_value(value):
    """Keep decimals lossless and ensure DuckDB values are valid JSON."""
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, float) and not math.isfinite(value):
        return None
    if isinstance(value, dict):
        return {str(key): json_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_value(item) for item in value]
    return value


def create_app(settings: Settings) -> FastAPI:
    if len(settings.token) < 32:
        raise ValueError("RDS_API_TOKEN must have at least 32 characters")
    app = FastAPI(title="Data Agent RDS semantic API", docs_url=None, redoc_url=None)
    # The local deployment deliberately serializes queries and owns no persistent DuckDB handle.
    query_lock = threading.Lock()

    def authorized(authorization: str | None = Header(default=None)):
        expected = f"Bearer {settings.token}"
        if authorization is None or not secrets.compare_digest(authorization, expected):
            raise HTTPException(401, "RDS API authentication required")

    def revision() -> int:
        if not settings.metadata_db_path.is_file():
            raise HTTPException(503, "Semantic metadata file is missing; publish it with duckdb_tools first")
        try:
            with sqlite3.connect(f"{settings.metadata_db_path.as_uri()}?mode=ro", uri=True) as conn:
                row = conn.execute("SELECT MAX(revision) FROM semantic_publications").fetchone()
                if not row or not row[0]:
                    raise HTTPException(503, "No published semantic revision; publish it with duckdb_tools first")
                return int(row[0])
        except sqlite3.Error as exc:
            raise HTTPException(503, "Published semantic metadata is unavailable") from exc

    @contextmanager
    def agent_scope():
        if not settings.db_path.is_file():
            raise HTTPException(503, "Configured DuckDB file is missing; no sample database will be created")
        with query_lock:
            current_revision = revision()
            try:
                with RDSAgent(
                    db_path=str(settings.db_path),
                    metadata_db_path=str(settings.metadata_db_path),
                    read_only=True,
                ) as agent:
                    yield agent, current_revision
            except HTTPException:
                raise
            except ValueError as exc:
                raise HTTPException(422, str(exc)) from exc
            except Exception as exc:
                if "lock" in str(exc).lower() or "different configuration" in str(exc).lower():
                    raise HTTPException(503, "DuckDB is busy. Disconnect the idle read/write connection in duckdb_tools before querying; retry after import finishes.") from exc
                raise HTTPException(503, f"RDS query unavailable: {type(exc).__name__}") from exc

    @app.get("/health")
    def health():
        return {"ok": True, "service": "rds-semantic-api", "read_only": True}

    @app.get("/api/v1/catalog", dependencies=[Depends(authorized)])
    def catalog():
        with agent_scope() as (agent, current_revision):
            dimensions = agent.get_dimensions()
            for item in dimensions:
                item.pop("mappings", None)
            metrics = agent.get_metrics()
            for item in metrics:
                definition = agent.semantic_layer.resolve_metric(item["name"])
                item["time_column"] = definition.time_column
            return {
                "tables": agent.get_schema().get("tables", []),
                "metrics": metrics,
                "dimensions": dimensions,
                "semantic_revision": current_revision,
                "read_only": True,
            }

    @app.post("/api/v1/query", dependencies=[Depends(authorized)])
    def query(request: QueryRequest):
        with agent_scope() as (agent, current_revision):
            warnings = []
            if request.time_range:
                for name in request.metrics:
                    metric = agent.semantic_layer.resolve_metric(name)
                    if metric is not None and not metric.time_column:
                        raise HTTPException(422, f"Metric {name} has no published time column; a time range cannot be applied")
            semantic = SemanticQuery.from_intent(request.model_dump(exclude={"question"}))
            sql = agent.compiler.compile(semantic)
            valid, error = agent.guard.validate_sql(sql)
            if not valid:
                raise HTTPException(422, error)
            result = agent.executor.execute(sql)
            value = {
                "success": result.success, "question": request.question,
                "sql": sql, "data": result.rows, "columns": result.columns,
                "row_count": result.row_count, "execution_time": result.execution_time,
                "error": result.error,
            }
            if result.row_count == request.limit:
                warnings.append(f"Result reached the {request.limit}-row limit; additional groups may be omitted.")
            return json_value({
                **value, "warnings": warnings, "read_only": True,
                "semantic_revision": current_revision,
            })

    return app
