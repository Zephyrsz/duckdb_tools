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


def test_field_metadata_can_be_saved_without_scanning_and_loaded_again(client):
    seed_database().close()
    original = client.get("/api/semantic/tables/sales").json()
    assert len(original["columns"]) == 4

    saved = client.patch("/api/semantic/tables/sales/columns", json={"columns": [
        {"name": "id", "display_name": "订单编号", "description": "每笔订单的唯一业务编号", "is_primary_key": True, "status": "approved"},
        {"name": "paid_at", "display_name": "付款时间", "description": "订单完成付款的时间", "status": "draft"},
    ]})

    assert saved.status_code == 200
    reloaded = client.get("/api/semantic/tables/sales").json()
    columns = {column["name"]: column for column in reloaded["columns"]}
    assert columns["id"]["display_name"] == "订单编号"
    assert columns["id"]["description"] == "每笔订单的唯一业务编号"
    assert columns["id"]["is_primary_key"] is True
    assert columns["id"]["status"] == "approved"
    assert columns["paid_at"]["description"] == "订单完成付款的时间"
    assert columns["id"]["type"] == "INTEGER"
    assert columns["id"]["nullable"] is True  # no NOT NULL constraint in DuckDB
    with sqlite3.connect(main.METADATA_DB_PATH) as metadata:
        assert metadata.execute("SELECT COUNT(*) FROM columns").fetchone()[0] == 0
        assert metadata.execute("SELECT source FROM semantic_drafts WHERE object_type='column' AND source_column='id'").fetchone()[0] == "manual"


def test_batch_field_save_is_atomic_when_a_column_is_unknown(client):
    seed_database().close()
    client.post("/api/semantic/scan")
    before = main.semantic_repository().drafts()

    response = client.patch("/api/semantic/tables/sales/columns", json={"columns": [
        {"name": "region", "display_name": "地区", "description": "不得部分保存"},
        {"name": "missing", "description": "不存在的字段"},
    ]})

    assert response.status_code == 400
    assert main.semantic_repository().drafts() == before


@pytest.mark.parametrize("columns", [
    [{"name": "region", "description": "地区"}, {"name": "region", "description": "重复"}],
    [{"name": "region", "type": "INTEGER"}],
    [{"name": "region", "status": "invalid"}],
    [{"name": "region", "display_name": "   "}],
    [],
])
def test_field_save_rejects_invalid_or_physical_schema_edits(client, columns):
    seed_database().close()
    response = client.patch("/api/semantic/tables/sales/columns", json={"columns": columns})
    assert response.status_code in {400, 422}
    assert main.semantic_repository().drafts() == []


def test_scan_and_publish_preserve_manual_field_metadata(client):
    seed_database().close()
    response = client.patch("/api/semantic/tables/sales/columns", json={"columns": [
        {"name": "id", "display_name": "订单编号", "description": "唯一业务编号", "is_primary_key": True, "status": "approved"},
        {"name": "paid_at", "display_name": "付款时间", "description": "付款完成时间", "status": "approved"},
    ]})
    assert response.status_code == 200
    scanned = client.post("/api/semantic/scan")
    assert scanned.status_code == 200
    drafts = scanned.json()["drafts"]
    id_draft = next(draft for draft in drafts if draft["object_type"] == "column" and draft["source_column"] == "id")
    assert id_draft["description"] == "唯一业务编号"
    assert id_draft["status"] == "approved"
    for draft in drafts:
        assert client.patch(f"/api/semantic/drafts/{draft['id']}", json={"status": "approved"}).status_code == 200
    assert client.post("/api/semantic/publish").status_code == 200
    with sqlite3.connect(main.METADATA_DB_PATH) as metadata:
        assert metadata.execute("SELECT display_name, description, is_primary_key, nullable FROM columns WHERE name = 'id'").fetchone() == ("订单编号", "唯一业务编号", 1, 1)
        assert metadata.execute("SELECT description FROM columns WHERE name = 'paid_at'").fetchone()[0] == "付款完成时间"
    # Saving a draft preserves the current published metadata until the next publication.
    assert client.patch("/api/semantic/tables/sales/columns", json={"columns": [{"name": "id", "description": ""}]}).status_code == 200
    assert client.get("/api/semantic/tables/sales").json()["columns"][0]["description"] == ""
    with sqlite3.connect(main.METADATA_DB_PATH) as metadata:
        assert metadata.execute("SELECT description FROM columns WHERE name = 'id'").fetchone()[0] == "唯一业务编号"


def test_field_save_returns_not_found_and_cannot_save_when_disconnected(client):
    seed_database().close()
    body = {"columns": [{"name": "id", "description": "编号"}]}
    assert client.patch("/api/semantic/tables/missing/columns", json=body).status_code == 404
    client.post("/api/duckdb/disconnect")
    assert client.patch("/api/semantic/tables/sales/columns", json=body).status_code == 503
    assert main.semantic_repository().drafts() == []


def test_existing_published_field_metadata_is_preserved_when_drafts_are_missing(client):
    seed_database().close()
    with main.semantic_repository().connect() as metadata:
        metadata.execute("INSERT INTO tables (name, description) VALUES ('sales', '销售表')")
        table_id = metadata.execute("SELECT id FROM tables WHERE name = 'sales'").fetchone()[0]
        metadata.execute("INSERT INTO columns (table_id, name, type, display_name, description, is_primary_key) VALUES (?, 'id', 'INTEGER', '订单编号', '原有编号说明', 1)", (table_id,))
    response = client.patch("/api/semantic/tables/sales/columns", json={"columns": [{"name": "region", "description": "销售地区"}]})
    assert response.status_code == 200
    id_column = response.json()["columns"][0]
    assert id_column["display_name"] == "订单编号"
    assert id_column["description"] == "原有编号说明"
    assert id_column["is_primary_key"] is True


def test_scan_preserves_published_field_annotations_without_drafts(client):
    seed_database().close()
    with main.semantic_repository().connect() as metadata:
        metadata.execute("INSERT INTO tables (name, description) VALUES ('sales', '销售表')")
        table_id = metadata.execute("SELECT id FROM tables WHERE name = 'sales'").fetchone()[0]
        metadata.execute("INSERT INTO columns (table_id, name, type, display_name, description, is_primary_key) VALUES (?, 'id', 'INTEGER', '订单编号', '发布的编号说明', 1)", (table_id,))

    assert client.post("/api/semantic/scan").status_code == 200
    column = client.get("/api/semantic/tables/sales").json()["columns"][0]
    assert column["display_name"] == "订单编号"
    assert column["description"] == "发布的编号说明"
    assert column["is_primary_key"] is True
    assert column["status"] == "approved"


def test_publish_preserves_column_ids_and_unedited_runtime_attributes(client):
    seed_database().close()
    with main.semantic_repository().connect() as metadata:
        metadata.execute("INSERT INTO tables (name, description) VALUES ('sales', '销售表')")
        table_id = metadata.execute("SELECT id FROM tables WHERE name = 'sales'").fetchone()[0]
        metadata.execute("INSERT INTO columns (id, table_id, name, type, is_foreign_key, foreign_key_table, foreign_key_column, enum_values) VALUES (100, ?, 'region', 'VARCHAR', 1, 'regions', 'name', '[\"East\", \"West\"]')", (table_id,))
    drafts = client.post("/api/semantic/scan").json()["drafts"]
    for draft in drafts:
        client.patch(f"/api/semantic/drafts/{draft['id']}", json={"status": "approved"})
    assert client.patch("/api/semantic/tables/sales/columns", json={"columns": [{"name": "region", "description": "订单所属地区"}]}).status_code == 200

    assert client.post("/api/semantic/publish").status_code == 200
    with sqlite3.connect(main.METADATA_DB_PATH) as metadata:
        assert metadata.execute("SELECT id, description, is_foreign_key, foreign_key_table, foreign_key_column, enum_values FROM columns WHERE name = 'region'").fetchone() == (100, "订单所属地区", 1, "regions", "name", '["East", "West"]')


def test_ignored_annotations_do_not_block_publication_or_publish_rejected_meanings(client):
    seed_database().close()
    drafts = client.post("/api/semantic/scan").json()["drafts"]
    for draft in drafts:
        rejected = draft["object_type"] == "measure" or (draft["object_type"] == "column" and draft["source_column"] == "region")
        response = client.patch(f"/api/semantic/drafts/{draft['id']}", json={"status": "rejected" if rejected else "approved", "description": "不应发布的说明" if rejected else draft["description"]})
        assert response.status_code == 200

    assert client.post("/api/semantic/validate").json()["valid"] is True
    assert client.post("/api/semantic/publish").status_code == 200
    with sqlite3.connect(main.METADATA_DB_PATH) as metadata:
        assert metadata.execute("SELECT COUNT(*) FROM measures").fetchone()[0] == 0
        assert metadata.execute("SELECT description FROM columns WHERE name = 'region'").fetchone()[0] != "不应发布的说明"
