"""Smoke-test the actual RDS HTTP service without logging its token or raw records."""
import json
import os
from pathlib import Path
from urllib.request import Request, urlopen

from dotenv import load_dotenv

root = Path(__file__).resolve().parents[1]
load_dotenv(root / ".env")
base = os.environ["RDS_API_URL"].rstrip("/")


def request(path, body=None):
    req = Request(base + path, data=json.dumps(body).encode() if body is not None else None, headers={
        "Authorization": f"Bearer {os.environ['RDS_API_TOKEN']}", "Content-Type": "application/json",
    })
    with urlopen(req, timeout=75) as response:
        return json.load(response)


catalog = request("/api/v1/catalog")
metric = next((item["name"] for item in catalog["metrics"] if item["name"].endswith("record_count")), catalog["metrics"][0]["name"])
result = request("/api/v1/query", {"question": "验证已发布指标", "metrics": [metric], "limit": 10})
assert result["success"], result.get("error")
assert result["read_only"] is True
print(json.dumps({"tables": [item["name"] for item in catalog["tables"]], "metric": metric, "semantic_revision": result["semantic_revision"], "read_only": result["read_only"], "data": result["data"], "sql": result["sql"]}, ensure_ascii=False, indent=2))
