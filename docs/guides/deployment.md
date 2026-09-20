# 共享语义工作台部署与启动

本文描述 `duckdb_tools`、`rds_agent` 和 DeepSeek Harness 的本地部署方式。

AWS Oregon 远程部署使用同一套共享运行时配置和统一入口，具体服务拓扑、启动顺序及故障排查见本文末尾的[远程部署](#aws-oregon-远程部署)章节。完整的三服务运维入口是 `/app/rds_agent/start.sh`。

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

## AWS Oregon 远程部署

远程服务器上的目录和运行时文件如下：

| 项目 | 路径或端口 |
| --- | --- |
| RDS Agent | `/app/rds_agent` |
| DuckDB Tools | `/app/duckdb_tools` |
| DeepSeek Harness | `/app/deepseek-harness` |
| Python | `/home/ubuntu/venv_314/bin/python` |
| 共享 DuckDB | `/app/rds_agent/data/workspace.duckdb` |
| 共享 SQLite metadata | `/app/rds_agent/data/metadata.db` |
| DuckDB Tools API | `0.0.0.0:8001` |
| DuckDB Tools 前端 | `0.0.0.0:5175` |
| Harness | `127.0.0.1:3090` |

统一配置在 `/app/rds_agent/config/remote-stack.env`。其中 `DUCKDB_TOOLS_DATABASE` 和 `RDS_DB_PATH` 必须指向同一个 DuckDB 文件，`RDS_AGENT_METADATA_DB` 和 `RDS_METADATA_DB_PATH` 必须指向同一个 SQLite 文件。DeepSeek key 放在未纳入 Git 的 `/app/rds_agent/config/remote-secrets.env`，权限设置为 `600`。

### 服务职责

- DuckDB Tools 是唯一的数据写入方，负责 CSV/XLSX 导入、业务数据修改、语义草稿编辑和 SQLite metadata 发布。
- RDS Agent 通过只读连接消费共享 DuckDB 和 SQLite metadata，并执行受 SQLGuard 约束的查询。
- DeepSeek Harness 监听本机 `3090`，通过 MCP stdio 子进程调用 RDS Agent 的 `query_data`。

### 启动顺序

从 `/app/rds_agent` 执行 `./start.sh start` 时按以下顺序启动：

1. `remote-service.sh` 创建或打开共享 DuckDB，启动 FastAPI API `8001`。
2. 等待 API 健康检查通过后启动 Vite 前端 `5175`。
3. 检查共享 DuckDB 和 SQLite metadata 文件存在。
4. 启动 DeepSeek Harness `3090`，加载 RDS Agent 的 MCP overlay。
5. Harness 按需启动 RDS Agent MCP 子进程；每次查询结束后关闭只读 DuckDB 连接，避免长期文件锁。

停止时顺序相反：先停止 Harness，再停止前端和 API。`restart` 执行完整的停止和启动流程。

### 统一管理命令

```bash
cd /app/rds_agent
./start.sh setup    # 首次安装 Python/npm 依赖
./start.sh start
./start.sh status
./start.sh logs
./start.sh restart
./start.sh stop
```

`/app/rds_agent/remote-stack.sh` 是编排实现；`/app/duckdb_tools/remote-service.sh` 只管理 DuckDB Tools 的后端和前端。日志分别位于：

```text
/app/duckdb_tools/logs/remote/backend.log
/app/duckdb_tools/logs/remote/frontend.log
/app/rds_agent/logs/remote/harness.log
```

健康检查：

```bash
curl http://127.0.0.1:8001/api/health
curl -I http://127.0.0.1:5175/
curl -I http://127.0.0.1:3090/
```

Harness 未携带访问 token 时返回 `401` 是正常现象。需要从本地访问 Harness 时，可使用 SSH 隧道：

```bash
ssh -L 3090:127.0.0.1:3090 ubuntu@<server>
```

未应用测试补丁时，公网页面的模型提供方和其他持久化设置需要从回环地址打开。仓库内提供了本地代理脚本，它会建立本机 `127.0.0.1:3091` 到远程 Harness `127.0.0.1:3090` 的隧道，并显示当前 token：

```bash
chmod +x scripts/harness-local-proxy.sh
scripts/harness-local-proxy.sh start
```

然后打开脚本输出的 `Settings URL`，或直接访问 `http://127.0.0.1:3091/` 并使用当前 token。关闭本地代理：

```bash
scripts/harness-local-proxy.sh stop
```

可用环境变量覆盖默认值：`HARNESS_SSH_KEY`、`HARNESS_SSH_USER`、`HARNESS_SSH_HOST`、`HARNESS_LOCAL_PORT` 和 `HARNESS_REMOTE_PORT`。该代理只监听本机，不改变远程服务或公网 Nginx 配置。

测试环境可以使用 `config/harness-public-settings-current.patch` 开启公网页面的 Host-backed 设置持久化。当前远程测试服务器已应用该补丁，并同步修改了 `packages/client/ui-settings/lib/` 的运行时 bundle。该补丁只适配当前部署版本，应用前应备份 Harness 源码和构建产物；生产环境应使用域名、HTTPS 和反向代理认证，并保留回环限制。

业务导入和 Agent 查询应避免同时操作同一个 DuckDB 文件；发生锁冲突时等待当前查询结束后重试导入或发布。
