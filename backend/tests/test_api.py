from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.app import main


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "DATA_DIR", tmp_path)
    monkeypatch.setattr(main, "UPLOAD_DIR", tmp_path / "uploads")
    monkeypatch.setattr(main, "DB_PATH", tmp_path / "workspace.duckdb")
    main.ensure_storage()
    with TestClient(main.app) as test_client:
        yield test_client


def test_csv_preview_returns_headers_types_and_rows(client):
    response = client.post(
        "/api/upload/preview",
        files={"file": ("sales.csv", "name,amount\nAda,12\nLin,8\n", "text/csv")},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["kind"] == "csv"
    assert [column["name"] for column in payload["columns"]] == ["name", "amount"]
    assert payload["preview"][0] == {"name": "Ada", "amount": 12}
    assert Path(payload["stored_path"]).exists()


def test_excel_preview_returns_headers_and_rows(client):
    openpyxl = pytest.importorskip("openpyxl")
    from io import BytesIO

    workbook = openpyxl.Workbook()
    sheet = workbook.active
    sheet.append(["region", "orders"])
    sheet.append(["East", 4])
    stream = BytesIO()
    workbook.save(stream)
    stream.seek(0)

    response = client.post(
        "/api/upload/preview",
        files={"file": ("orders.xlsx", stream.getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["kind"] == "excel"
    assert payload["preview"] == [{"region": "East", "orders": 4}]


def test_preview_rejects_unsupported_extension(client):
    response = client.post("/api/upload/preview", files={"file": ("notes.txt", b"hello", "text/plain")})

    assert response.status_code == 400
    assert "CSV" in response.json()["detail"]


def test_import_list_table_browse_and_select_query(client):
    preview = client.post(
        "/api/upload/preview",
        files={"file": ("sales.csv", "name,amount\nAda,12\nLin,8\n", "text/csv")},
    ).json()

    imported = client.post(
        "/api/import",
        json={"stored_path": preview["stored_path"], "table_name": "sales", "has_header": True},
    )
    assert imported.status_code == 200
    assert imported.json()["row_count"] == 2

    database = client.get("/api/database")
    assert database.status_code == 200
    assert database.json()["tables"][0]["name"] == "sales"

    table = client.get("/api/tables/sales")
    assert table.status_code == 200
    assert table.json()["rows"][1]["amount"] == 8

    query = client.post("/api/query", json={"sql": "SELECT name, amount FROM sales ORDER BY amount DESC"})
    assert query.status_code == 200
    assert query.json()["row_count"] == 2
    assert query.json()["rows"][0] == {"name": "Ada", "amount": 12}
    assert "elapsed_ms" in query.json()


def test_import_can_create_named_database_schema_and_browse_it(client):
    preview = client.post(
        "/api/upload/preview",
        files={"file": ("orders.csv", "id,total\n1,42\n", "text/csv")},
    ).json()

    imported = client.post(
        "/api/import",
        json={
            "stored_path": preview["stored_path"],
            "database_name": "analytics",
            "table_name": "orders",
            "has_header": True,
        },
    )
    assert imported.status_code == 200
    assert imported.json()["table_ref"] == "analytics.orders"

    schemas = client.get("/api/database/schemas")
    assert schemas.status_code == 200
    assert {"db", "analytics"}.issubset(set(schemas.json()))

    database = client.get("/api/database")
    assert any(item["table_ref"] == "analytics.orders" for item in database.json()["tables"])

    table = client.get("/api/tables/analytics.orders")
    assert table.status_code == 200
    assert table.json()["database_name"] == "analytics"
    assert table.json()["rows"] == [{"id": 1, "total": 42}]

    scan = client.post("/api/semantic/scan")
    assert scan.status_code == 200
    assert any(item["table_name"] == "analytics.orders" for item in scan.json()["drafts"])


def test_query_rejects_mutation_and_multiple_statements(client):
    for sql in ["DROP TABLE sales", "SELECT 1; SELECT 2", "UPDATE sales SET amount = 0"]:
        response = client.post("/api/query", json={"sql": sql})
        assert response.status_code == 400
        assert "只读" in response.json()["detail"]


def test_query_allows_one_trailing_semicolon(client):
    response = client.post("/api/query", json={"sql": "SELECT 1 AS value;"})

    assert response.status_code == 200
    assert response.json()["rows"] == [{"value": 1}]


def test_configured_duckdb_database_path_is_used(monkeypatch, tmp_path):
    configured = tmp_path / "custom" / "semantic.duckdb"
    monkeypatch.setenv("DUCKDB_TOOLS_DATABASE", str(configured))
    monkeypatch.setattr(main, "DATA_DIR", tmp_path / "data")

    assert main.resolve_database_path() == configured


def test_duckdb_connection_can_be_connected_and_disconnected(client):
    status = client.get("/api/duckdb/status")
    assert status.status_code == 200
    assert status.json()["connected"] is True
    assert status.json()["active_operations"] == 0

    disconnected = client.post("/api/duckdb/disconnect")
    assert disconnected.status_code == 200
    assert disconnected.json()["connected"] is False

    unavailable = client.get("/api/database")
    assert unavailable.status_code == 503
    assert "未连接" in unavailable.json()["detail"]

    connected = client.post("/api/duckdb/connect")
    assert connected.status_code == 200
    assert connected.json()["connected"] is True


def test_duckdb_disconnect_is_rejected_while_operation_is_active(client):
    with main.duckdb_manager.operation():
        response = client.post("/api/duckdb/disconnect")
        assert response.status_code == 409
        assert "操作正在运行" in response.json()["detail"]


def test_csv_preview_works_while_duckdb_is_disconnected(client, monkeypatch):
    disconnected = client.post("/api/duckdb/disconnect")
    assert disconnected.status_code == 200

    def reject_duckdb_connect(*args, **kwargs):
        raise AssertionError("CSV preview must not open another DuckDB connection")

    monkeypatch.setattr(main.duckdb, "connect", reject_duckdb_connect)
    response = client.post(
        "/api/upload/preview",
        files={"file": ("sales.csv", "name,amount\nAda,12\nLin,8\n", "text/csv")},
    )

    assert response.status_code == 200
    assert response.json()["preview"][0] == {"name": "Ada", "amount": 12}
    assert client.get("/api/duckdb/status").json()["connected"] is False
