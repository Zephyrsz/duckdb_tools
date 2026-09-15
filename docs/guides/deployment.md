# 共享语义工作台部署与启动

本文描述 `duckdb_tools`、`rds_agent` 和 DeepSeek Harness 的本地部署方式。

## 架构与职责

```text
duckdb_tools FastAPI + Web UI
  ├─ 读写共享 DuckDB
  └─ 扫描、编辑、校验、发布共享 SQLite metadata

rds_agent MCP Server / DeepSeek Harness
  ├─ 只读连接同一个 DuckDB
  └─ 只读消费同一个 SQLite metadata
```

DuckDB Tools 是数据写入和语义发布入口；RDS Agent 只执行经过安全校验的查询。

## 前置条件

- Python 3.11+。
- Node.js 18+、npm 和 DeepSeek Harness。
- 两个项目目录：

```bash
export DUCKDB_TOOLS_ROOT=/Users/rgwei/pj/pj_data/duckdb_tools
export RDS_AGENT_ROOT=/Users/rgwei/pj/pj_data/rds_agent
export HARNESS_ROOT=/Users/rgwei/pj/pj_agent/deepseek-harness
```

## 统一配置

编辑 `$DUCKDB_TOOLS_ROOT/config/workbench.env`：

```bash
DUCKDB_TOOLS_HOST=0.0.0.0
DUCKDB_TOOLS_BACKEND_PORT=8001
DUCKDB_TOOLS_FRONTEND_PORT=5173
DUCKDB_TOOLS_DATABASE=./data/workspace.duckdb
RDS_AGENT_ROOT=../rds_agent
RDS_AGENT_METADATA_DB=../rds_agent/var/metadata.db
RDS_DB_PATH=./data/workspace.duckdb
RDS_METADATA_DB_PATH=../rds_agent/var/metadata.db
```

启动 Harness 时建议将两个共享路径改为绝对路径：

```bash
export RDS_DB_PATH="$DUCKDB_TOOLS_ROOT/data/workspace.duckdb"
export RDS_METADATA_DB_PATH="$RDS_AGENT_ROOT/var/metadata.db"
export RDS_AGENT_ROOT
```

外部导出的环境变量优先于配置文件中的默认值。

## 安装依赖

```bash
cd "$DUCKDB_TOOLS_ROOT"
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.txt
cd frontend && npm install

cd "$RDS_AGENT_ROOT"
venv/bin/python -m pip install -r requirements.txt
```

## 启动 DuckDB Tools

```bash
cd "$DUCKDB_TOOLS_ROOT"
./start.sh start
./start.sh status
```

访问 `http://localhost:5173`；API 健康检查为 `http://localhost:8001/api/health`。数据导入、表修改和语义发布均在此完成。

## 启动 DeepSeek Harness 与 RDS Agent

先设置模型环境变量：

```bash
export RDS_LLM_API_KEY="$DEEPSEEK_API_KEY"
export RDS_LLM_BASE_URL=https://api.deepseek.com
export RDS_LLM_MODEL=deepseek-chat
export RDS_CONFIG_DIR="$RDS_AGENT_ROOT/config"
```

使用 RDS Agent 提供的 overlay：

```bash
cd "$HARNESS_ROOT"
pnpm dsh --profile web \
  --patch "$RDS_AGENT_ROOT/integration/deepseek-harness.cordis.yml" \
  --no-open
```

Harness 通过 stdio 启动 `integration.mcp_server`，MCP 工具名为 `query_data`。RDS Agent 使用共享 DuckDB 的只读连接，并读取共享 SQLite metadata。

## 运行验证

```bash
cd "$DUCKDB_TOOLS_ROOT"
PYTHONPATH=. pytest -q
cd "$RDS_AGENT_ROOT"
venv/bin/python -m pytest -q
```

验证共享连接：

```bash
cd "$RDS_AGENT_ROOT"
venv/bin/python - <<'PY'
from integration.sdk import RDSAgent

agent = RDSAgent(
    db_path="/Users/rgwei/pj/pj_data/duckdb_tools/data/workspace.duckdb",
    metadata_db_path="/Users/rgwei/pj/pj_data/rds_agent/var/metadata.db",
)
print(type(agent.catalog).__name__)
print(type(agent.semantic_layer).__name__)
print(agent.db_adapter.read_only)
agent.close()
PY
```

预期输出包含 `SQLiteCatalog`、`SQLiteSemanticLayer` 和 `True`。

## 停止服务

```bash
cd "$DUCKDB_TOOLS_ROOT"
./start.sh stop
```

Harness 在前台运行时使用 `Ctrl-C` 停止。

## 故障排查

- `DuckDB database not found`：检查 `RDS_DB_PATH` 是否指向已存在的共享文件。
- `RDS Agent` 能查询但看不到新指标：确认 `RDS_METADATA_DB_PATH` 指向发布 metadata，并重新执行语义发布。
- 端口占用：运行 `./start.sh status`，或修改 `DUCKDB_TOOLS_BACKEND_PORT` / `DUCKDB_TOOLS_FRONTEND_PORT`。
- Harness 没有 `query_data`：确认 patch 参数顺序、`RDS_AGENT_ROOT`、Python 虚拟环境和模型 key。
- 不要让 RDS Agent 使用 `:memory:` 或相对路径作为生产共享配置。
