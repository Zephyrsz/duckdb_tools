from pathlib import Path
import sqlite3
import sys

import duckdb
from fastapi.testclient import TestClient
import pytest

RDS_ROOT = Path(__file__).resolve().parents[3] / "rds_agent"
sys.path.insert(0, str(RDS_ROOT))

from adapters.duckdb import create_sample_database
from adapters.yaml_to_sqlite import migrate_yaml_to_sqlite
from rds_api.app import Settings, create_app


@pytest.fixture
def service(tmp_path, monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    db_path = tmp_path / "business.duckdb"
    with create_sample_database(str(db_path)):
        pass
    meta_path = tmp_path / "metadata.db"
    migrate_yaml_to_sqlite(RDS_ROOT / "config", str(meta_path))
    with sqlite3.connect(meta_path) as connection:
        connection.execute("CREATE TABLE semantic_publications(revision INTEGER PRIMARY KEY)")
        connection.execute("INSERT INTO semantic_publications VALUES (7)")
    settings = Settings(db_path=db_path, metadata_db_path=meta_path, token="test-token-" + "a" * 32)
    with TestClient(create_app(settings)) as client:
        yield client, {"Authorization": f"Bearer {settings.token}"}, settings


def test_catalog_requires_token_and_returns_published_semantics(service):
    client, headers, _ = service
    assert client.get("/api/v1/catalog").status_code == 401
    assert client.get("/api/v1/catalog", headers={"Authorization": "Bearer wrong"}).status_code == 401
    response = client.get("/api/v1/catalog", headers=headers)
    assert response.status_code == 200
    value = response.json()
    assert value["semantic_revision"] == 7
    assert any(item["name"] == "customer_count" for item in value["metrics"])
    assert "mappings" not in value["dimensions"][0]


def test_compiles_semantics_and_releases_readonly_connection(service):
    client, headers, settings = service
    response = client.post("/api/v1/query", headers=headers, json={
        "question": "客户数是多少？", "metrics": ["customer_count"], "limit": 10,
    })
    assert response.status_code == 200
    value = response.json()
    assert value["success"] is True
    assert value["data"] == [{"customer_count": 5}]
    assert value["columns"] == ["customer_count"]
    assert value["read_only"] is True
    assert value["semantic_revision"] == 7
    # A leaked read-only connection prevents opening this file with read/write settings.
    with duckdb.connect(str(settings.db_path)) as writer:
        writer.execute("CREATE TABLE connection_release_probe(id INTEGER)")


def test_filters_are_compiled_and_unknown_metrics_fail(service):
    client, headers, _ = service
    value = client.post("/api/v1/query", headers=headers, json={
        "question": "华东客户数", "metrics": ["customer_count"], "filters": {"region": "华东"},
    }).json()
    assert value["success"] is True
    assert value["data"] == [{"customer_count": 2}]
    assert "EAST_CHINA" in value["sql"]
    response = client.post("/api/v1/query", headers=headers, json={"metrics": ["invented_metric"]})
    assert response.status_code == 422


def test_raw_sql_database_paths_and_invalid_limits_are_rejected(service):
    client, headers, _ = service
    for payload in [
        {"sql": "DROP TABLE customers", "metrics": ["customer_count"]},
        {"db_path": "/tmp/other.duckdb", "metrics": ["customer_count"]},
        {"metrics": ["customer_count"], "limit": 0},
        {"metrics": ["customer_count"], "limit": 1001},
        {"metrics": ["customer_count"], "filters": {"region": {"raw_sql": "1=1"}}},
        {},
        {"question": "客户数是多少？"},
    ]:
        assert client.post("/api/v1/query", headers=headers, json=payload).status_code == 422


def test_write_lock_returns_actionable_unavailable_error(service):
    client, headers, settings = service
    with duckdb.connect(str(settings.db_path)):
        response = client.post("/api/v1/query", headers=headers, json={"metrics": ["customer_count"]})
        assert response.status_code == 503
        assert "duckdb_tools" in response.json()["detail"]


def test_request_connection_is_really_readonly(service, monkeypatch):
    from integration.sdk import RDSAgent
    original = RDSAgent._init_components
    observed = []

    def inspect_connection(agent, *args):
        with pytest.raises(duckdb.InvalidInputException, match="read-only"):
            agent.db_adapter.connection.execute("INSERT INTO customers(id, name) VALUES (999,'probe')")
        observed.append(agent.read_only)
        return original(agent, *args)

    monkeypatch.setattr(RDSAgent, "_init_components", inspect_connection)
    client, headers, _ = service
    response = client.post("/api/v1/query", headers=headers, json={"metrics": ["customer_count"]})
    assert response.json()["success"] is True
    assert observed == [True]


def test_new_requests_see_new_semantic_publications(service):
    client, headers, settings = service
    assert client.get("/api/v1/catalog", headers=headers).json()["semantic_revision"] == 7
    with sqlite3.connect(settings.metadata_db_path) as connection:
        connection.execute("INSERT INTO semantic_publications VALUES (8)")
    assert client.get("/api/v1/catalog", headers=headers).json()["semantic_revision"] == 8


def test_rejects_time_range_without_published_time_column(service):
    client, headers, settings = service
    # The fixture has a time column; remove it from metadata to model scanned workbench metrics.
    with sqlite3.connect(settings.metadata_db_path) as connection:
        connection.execute("UPDATE metrics SET time_column=NULL WHERE name='customer_count'")
    response = client.post("/api/v1/query", headers=headers, json={
        "metrics": ["customer_count"], "time_range": "本月",
    })
    assert response.status_code == 422
    assert "time column" in response.json()["detail"]
