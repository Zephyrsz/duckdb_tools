import sqlite3

import pytest
from fastapi.testclient import TestClient

from backend.app import main


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "DATA_DIR", tmp_path)
    monkeypatch.setattr(main, "UPLOAD_DIR", tmp_path / "uploads")
    monkeypatch.setattr(main, "DB_PATH", tmp_path / "workspace.duckdb")
    monkeypatch.setattr(main, "METADATA_DB_PATH", tmp_path / "metadata.db")
    main.ensure_storage()
    with TestClient(main.app) as test_client:
        yield test_client


def seed_database():
    connection = main.connect_db()
    connection.execute(
        """
        CREATE TABLE sales (
            id INTEGER,
            region VARCHAR,
            amount DOUBLE,
            paid_at TIMESTAMP
        )
        """
    )
    connection.executemany(
        "INSERT INTO sales VALUES (?, ?, ?, ?)",
        [
            (1, "East", 12.5, "2024-01-01 10:00:00"),
            (2, "West", 8.0, "2024-01-02 10:00:00"),
            (3, "East", 9.5, "2024-01-03 10:00:00"),
        ],
    )
    return connection


def test_scan_creates_explainable_drafts_and_summary(client):
    connection = seed_database()
    connection.close()

    response = client.post("/api/semantic/scan")

    assert response.status_code == 200
    payload = response.json()
    assert payload["table_count"] == 1
    assert any(item["object_type"] == "measure" and item["source_column"] == "amount" for item in payload["drafts"])
    assert any(item["object_type"] == "dimension" and item["source_column"] == "region" for item in payload["drafts"])
    assert all(item["evidence"] for item in payload["drafts"])

    summary = client.get("/api/semantic/summary")
    assert summary.status_code == 200
    assert summary.json()["draft_count"] == len(payload["drafts"])


def test_draft_patch_and_validation_reject_unknown_column(client):
    connection = seed_database()
    connection.close()
    drafts = client.post("/api/semantic/scan").json()["drafts"]
    draft = next(item for item in drafts if item["object_type"] == "measure")

    response = client.patch(
        f"/api/semantic/drafts/{draft['id']}",
        json={"canonical_name": "sales_amount", "expression": "SUM(sales.missing)"},
    )
    assert response.status_code == 200

    validation = client.post("/api/semantic/validate")
    assert validation.status_code == 200
    body = validation.json()
    assert body["valid"] is False
    assert any("missing" in error for error in body["errors"])


def test_publish_writes_rds_agent_compatible_sqlite(client):
    connection = seed_database()
    connection.close()
    drafts = client.post("/api/semantic/scan").json()["drafts"]
    for draft in drafts:
        client.patch(f"/api/semantic/drafts/{draft['id']}", json={"status": "approved"})

    validation = client.post("/api/semantic/validate")
    assert validation.json()["valid"] is True

    published = client.post("/api/semantic/publish")
    assert published.status_code == 200
    assert published.json()["revision"] == 1

    metadata = sqlite3.connect(main.METADATA_DB_PATH)
    assert metadata.execute("SELECT name FROM tables WHERE name = 'sales'").fetchone()
    assert metadata.execute("SELECT name FROM measures WHERE name = 'amount'").fetchone()
    metadata.close()


def test_publish_rejects_unsafe_expression(client):
    connection = seed_database()
    connection.close()
    drafts = client.post("/api/semantic/scan").json()["drafts"]
    draft = next(item for item in drafts if item["object_type"] == "measure")
    client.patch(
        f"/api/semantic/drafts/{draft['id']}",
        json={"status": "approved", "expression": "SUM(sales.amount); DROP TABLE sales"},
    )

    validation = client.post("/api/semantic/validate")
    assert validation.json()["valid"] is False
    assert any("unsafe" in error for error in validation.json()["errors"])
