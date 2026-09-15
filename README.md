# AIBase 数据工作台

面向业务人员的 DuckDB 浏览器工具，支持上传带表头的 CSV/XLSX、预览并导入数据、按表浏览，以及执行只读 SQL 查询。

## 功能

- Airbyte 风格四阶段导入流程：选择文件、检查预览、写入数据、完成
- CSV 使用 DuckDB `read_csv_auto` 自动推断字段类型
- XLSX 使用 `openpyxl` 读取工作表并写入 DuckDB
- DBeaver 风格的表级对象列表、字段摘要和前 100 行数据预览
- 只读 SQL 工作区，支持 `SELECT`、`WITH`、`DESCRIBE`、`SHOW`、`EXPLAIN`
- FastAPI 同源托管前端产物，适合远程浏览器访问

## 本地开发

需要 Python 3.11+、Node.js 20+。

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.txt

cd frontend
npm install
npm run dev
```

另开一个终端，在项目根目录启动后端：

```bash
.venv/bin/uvicorn backend.app.main:app --host 0.0.0.0 --port 8000
```

开发地址为 `http://localhost:5173`，Vite 会把 `/api` 代理至 FastAPI。

也可以在项目根目录使用统一管理脚本：

```bash
./start.sh start
./start.sh status
./start.sh restart
./start.sh stop
```

前后端共享配置位于 `config/workbench.env`，其中可统一设置监听地址、后端端口、前端端口、DuckDB 数据目录、DuckDB 数据库文件、RDS Agent 共享 DuckDB 路径和共享 metadata 路径。启动脚本和 Vite 开发服务器都会读取它；启动前导出的同名环境变量优先级更高。也可通过 `DUCKDB_TOOLS_CONFIG=/path/to/workbench.env` 指定另一份配置文件。

脚本在 `.run/` 保存 PID，在 `logs/` 保存前后端日志。可通过 `DUCKDB_TOOLS_HOST`、`DUCKDB_TOOLS_BACKEND_PORT` 和 `DUCKDB_TOOLS_FRONTEND_PORT` 覆盖监听地址与端口。

## 单服务部署

先构建前端，再启动 FastAPI：

```bash
cd frontend && npm install && npm run build && cd ..
.venv/bin/uvicorn backend.app.main:app --host 0.0.0.0 --port 8000
```

浏览器访问 `http://<服务器地址>:8000`。数据库默认保存在 `data/workspace.duckdb`，上传文件保存在 `data/uploads`。可通过 `DUCKDB_TOOLS_DATA` 指定数据目录，也可通过 `DUCKDB_TOOLS_DATABASE` 直接指定 DuckDB 文件路径；后者优先级更高。

语义层运行时 metadata 默认直接写入相邻 `rds_agent/var/metadata.db`，与 RDS Agent 共用同一个 SQLite 文件。可通过 `RDS_AGENT_ROOT` 指定 RDS Agent 项目目录，或用 `RDS_AGENT_METADATA_DB` 指定 SQLite 文件路径。导入数据后进入“语义层”，执行扫描、确认候选、校验并发布；RDS Agent 使用同一个 `metadata_db_path` 和 `db_path` 即可读取发布结果：

```bash
export RDS_AGENT_METADATA_DB=/Users/rgwei/pj/pj_data/rds_agent/var/metadata.db
```

完整生命周期见 [`docs/guides/semantic-integration.md`](docs/guides/semantic-integration.md)。

完整部署、启动、验证和故障排查见 [`docs/guides/deployment.md`](docs/guides/deployment.md)。

## 测试

```bash
.venv/bin/python -m pytest backend/tests -q
cd frontend && npm run build
```

上传文件限制为 50 MB。查询接口仅接受单条只读语句，并禁止从任意服务器路径扫描外部文件。
