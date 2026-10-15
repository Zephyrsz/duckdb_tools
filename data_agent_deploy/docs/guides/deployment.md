# OpenMuse + RDS 安装与部署

文档类型：当前部署与运维说明。核验日期：2026-10-15。适用范围：本仓库的 `data_agent_deploy/`。默认方案是单机、单 OpenMuse API 进程、共享本地 DuckDB 和 SQLite metadata。依赖版本见[依赖说明](dependencies.md)，工作台本身的安装见[父项目部署说明](../../../docs/guides/deployment.md)。

## 一、准备源码与运行工具

本机已有源码时直接进入 `data_agent_deploy/`，无需再次克隆。全新机器需要两个仓库，示例将它们放在同一父目录：

```sh
mkdir -p "$HOME/pj_data"
cd "$HOME/pj_data"
git clone --branch duckbase-mvp git@github.com:Zephyrsz/duckdb_tools.git
git clone --branch codex/sqlite-semantic-layer-phase0-2 git@github.com:Zephyrsz/rds_agent.git
# 固定本次已验证的外部 SDK 版本（仅对刚克隆的干净仓库执行）：
git -C rds_agent checkout --detach 935e16fac941f17caecb429e0737410759797a44
cd duckdb_tools/data_agent_deploy
```

若没有 SSH 权限，可在账号有仓库读取权限时改用相应 HTTPS URL。`duckbase-mvp` 会继续变化；需要重现某次部署时，在干净检出中将父仓库固定到已验收的 Git 提交，并记录两个仓库的 SHA。

目录布局：

```text
pj_data/
├── rds_agent/
│   ├── integration/sdk.py
│   ├── adapters/sqlite_schema.sql
│   └── var/metadata.db                 # 后续准备，不随 Git 下载
└── duckdb_tools/
    ├── data/workspace.duckdb           # 后续准备，不随 Git 下载
    └── data_agent_deploy/
        ├── .env.example
        ├── .env                       # setup 生成，忽略且权限 600
        ├── .venv/                     # 独立 Python 环境
        ├── openmuse/                  # 源码已包含，无需克隆或安装 CopilotKit 源码
        ├── rds_api/
        ├── scripts/
        └── .run/                      # 本地进程信息和日志
```

准备 Node 24、Corepack、Python 3.14 和 uv。先检查 PATH；`setup.sh` 会使用这里的 `python3` 创建环境：

```sh
node --version
corepack --version
python3 --version
uv --version
cd openmuse
corepack pnpm --version                 # 预期 11.19.0
cd ..
```

Corepack 根据当前目录的 `package.json` 选版本，所以应在 `openmuse/` 执行 pnpm 命令。其他工具安装方式及平台边界见[系统工具](dependencies.md#系统工具)。

## 二、安装并构建

以下命令均从 `data_agent_deploy/` 开始：

```sh
./setup.sh
cd openmuse
corepack pnpm build:server
corepack pnpm build:web
cd ..
```

`setup.sh` 依次执行：

1. 运行 `scripts/configure.py`：仅在不存在时从 `.env.example` 创建 `.env`，生成随机服务端 token，并设置文件权限 `600`。
2. 创建 `openmuse/.env -> ../.env` 符号链接，使 API 读取同一份配置。
3. 创建 `openmuse/apps/mobile/.env`，只复制 `EXPO_PUBLIC_API_URL`，不把服务端密钥带入客户端。
4. 若环境不存在，执行 `uv venv .venv --python python3`。
5. 从 `requirements.lock.txt` 安装精确 Python 版本，再在 `openmuse/` 用 `--frozen-lockfile` 安装 Node 依赖。

脚本可以重复执行，保留已有 `.env`，不会拉取源码、构建应用、启动服务或准备业务数据库。已有自定义 `openmuse/.env` 或非脚本生成的移动端 `.env` 会被保留，需检查它们是否与部署配置一致。创建环境使用 uv，`.venv` 未内置 pip；后续使用 `uv pip --python .venv/bin/python ...`，不要假定 `python -m pip` 可用。

构建产物分别为 `openmuse/dist/` 和 `openmuse/apps/mobile/dist/web/`，均不提交 Git。初次安装必须构建；修改服务端源码后重建 server 并重启 API；修改客户端源码或公开 API 地址后重建 Web。

## 三、配置环境变量

编辑 `data_agent_deploy/.env`，不要提交真实密钥。这里的默认值来自本部署的 [.env.example](../../.env.example)，与 OpenMuse 上游默认值可能不同。

### 本部署的全部默认变量

| 变量 | 默认值 | 要求与生效方式 |
| --- | --- | --- |
| `WORKSPACE_MODE` | `sample` | OpenMuse 应用工作区模式；sample 仅允许 loopback，邮件等为示例内容；不影响 RDS 查询真实数据 |
| `AGENT_BACKEND` | `model` | 使用真实模型和本地注册的 RDS 工具；不要为绕过密钥而改成 sample 或未经适配的外部 agent |
| `HOST` | `127.0.0.1` | OpenMuse API 监听地址；RDS 和静态 Web 的 loopback 绑定不受它影响 |
| `PORT` | `8787` | OpenMuse API 端口，修改后也要同步下面的 URL；重启 API |
| `PUBLIC_API_URL` | `http://localhost:8787` | 用户可达的 API 基址，用于签名文件链接、OAuth 回调等；重启 API |
| `EXPO_PUBLIC_API_URL` | `http://localhost:8787` | 客户端编译时使用的公开 API 基址；运行 configure 后重建 Web / 重启 Expo dev server |
| `ALLOWED_ORIGINS` | `http://localhost:8081,http://127.0.0.1:8081` | 浏览器来源白名单，逗号分隔且不要加空格；跨域部署加入实际 UI origin；重启 API |
| `DATA_DIR` | `.openmuse` | OpenMuse 状态、文件、签名密钥等目录，相对 `openmuse/`；与 DuckDB 无关；重启 API |
| `TASK_WORKER_ENABLED` | `false` | 首版关闭后台调度；设为 true 在 API 内运行任务；重启 API |
| `WEB_SEARCH_ENABLED` | `false` | 关闭网页搜索；业务语义查询不依赖它 |
| `COMPUTER_ENABLED` | `false` | 关闭电脑容器 |
| `JEV_MODE` | `off` | 关闭 Jev |
| `CPK_INTELLIGENCE_API_KEY` | 空 | 聊天 API 必填，服务端项目密钥；重启 API |
| `MODEL` | 空 | 聊天 API 必填，形如 `openai/模型名`、`anthropic/模型名`、`google/模型名`；重启 API |
| `OPENAI_API_KEY` | 空 | 使用 OpenAI 或兼容网关时必填，仅服务端 |
| `ANTHROPIC_API_KEY` | 空 | 使用 Anthropic 时必填，仅服务端 |
| `GOOGLE_API_KEY` | 空 | 使用 Google 模型时必填，与 Google OAuth client secret 不同 |
| `RDS_AGENT_ROOT` | `../../rds_agent` | RDS 源码目录，相对部署根目录；修改后重启 RDS |
| `RDS_DB_PATH` | `../data/workspace.duckdb` | 已存在的业务 DuckDB，相对部署根目录；修改后重启 RDS |
| `RDS_METADATA_DB_PATH` | `../../rds_agent/var/metadata.db` | 已发布的 SQLite metadata，相对部署根目录；修改后重启 RDS |
| `RDS_API_PORT` | `8766` | Python RDS 服务端口；修改后重启 RDS，并同步 `RDS_API_URL` |
| `RDS_API_URL` | `http://127.0.0.1:8766` | OpenMuse 服务端调用的内部 RDS 基址；修改后重启 API |
| `RDS_API_TOKEN` | 首次安装随机生成 | API → RDS 的共享 bearer token，至少 32 字符；双方必须一致，修改后重启 RDS 与 API |

推荐自定义数据源使用绝对路径。`.env` 由 dotenv / Node 加载，不是 shell 脚本，不要 `source .env`；特别是相对路径、URL 和带特殊字符的密钥。已导出的同名环境变量优先于文件，OpenMuse 会提示被覆盖的变量名；测试时如有旧配置需在当前 shell `unset`。移动端 configure 从 `.env` 文件复制公开地址，因此也应检查是否与 shell 的旧 `EXPO_PUBLIC_API_URL` 冲突。

修改客户端地址后：

```sh
python3 scripts/configure.py
cd openmuse
corepack pnpm build:web
cd ..
```

若移动端 `.env` 为用户自建文件，脚本不会覆盖它，应手工同步公开地址。客户端只能保存公开配置；模型密钥、Intelligence key、RDS token、数据库路径都不能添加到 `EXPO_PUBLIC_*` 中。

### 聊天与可选配置

最低聊天配置示例：

```dotenv
CPK_INTELLIGENCE_API_KEY=你的项目密钥
MODEL=openai/你的模型名
OPENAI_API_KEY=你的模型密钥
# 兼容网关按需设置，不需要时不填：
# OPENAI_BASE_URL=https://你的网关/v1
# OPENAI_CHAT_COMPLETIONS=true
```

Intelligence 负责 OpenMuse 会话持久化、列表与回放，当前所有模式都需要它；模型 API key 无法替代。按照[上游配置说明](../../openmuse/README.md)通过 `npx copilotkit@latest login` 和 `npx copilotkit@latest project select` 取得项目配置，再将生成值保存到部署 `.env`；如果 CLI 生成了 `CPK_TELEMETRY_ID`，一并保存生成值，不要自行编造。CLI 应在自己的配置目录操作，避免覆盖本部署已生成的 `.env`。当前用户选择稍后提供密钥，因此不尝试连接外部聊天服务。

| 可选变量 | 用途 |
| --- | --- |
| `OPENAI_BASE_URL` / `OPENAI_CHAT_COMPLETIONS=true` | OpenAI 兼容端点；需要 Chat Completions 而不支持 Responses 工具循环的网关使用后一项 |
| `ANTHROPIC_BASE_URL` / `GOOGLE_GENERATIVE_AI_BASE_URL` | 对应 provider 的可选端点；格式见 [OpenMuse .env.example](../../openmuse/.env.example) |
| `OPENMUSE_ACCESS_KEY` | live 模式登录共享密钥，至少 24 字符 |
| `TOKEN_ENCRYPTION_KEY` | live 模式必填，32 随机字节的 base64 字符串；加密 Google 凭据 |
| `DATABASE_URL` | 用 PostgreSQL 替代本地 PGlite；API 和独立任务 worker 需共享它 |
| `TRUST_PROXY` | 仅当受控反向代理会覆盖转发头时设为 true；用于按真实客户端地址限流 |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | live 邮件 / 日历 OAuth，可选；回调为 `PUBLIC_API_URL + /api/google/callback` |
| `CPK_TELEMETRY_ID` / `COPILOTKIT_TELEMETRY_SAMPLE_RATE` | 上游 telemetry 身份与采样；默认采样值为 1；用 `COPILOTKIT_TELEMETRY_DISABLED=true` 或 `DO_NOT_TRACK=1` 显式关闭 SDK telemetry |

浏览器、电脑、Jev 等上游功能使用各自额外配置，见[可选依赖](dependencies.md#必需配置与可选组件)。此部署未启用这些能力；不要直接使用上游 `render.yaml` 替代本说明，其不会为你部署本地 Python RDS 适配器、SDK 和两个数据文件。

## 数据与连接生命周期

### 准备业务库和已发布语义层

全新 Git checkout 不包含数据。可通过工作台导入并发布，也可恢复一组相互匹配的 DuckDB + SQLite 备份。工作台安装与启动使用它自己的根目录 `.venv`、`frontend/` 和 `config/workbench.env`，与本部署独立。

1. 在 DuckDB Tools 导入 CSV/XLSX，确认业务库文件路径。
2. 在语义层扫描、确认和编辑草稿，校验通过后发布 metadata；仅保存草稿不够。
3. 确认发布 SQLite 与业务库匹配，设置本部署的两个 `RDS_*_PATH`。
4. 完成导入后释放工作台对同一 DuckDB 的读写连接，再启动或恢复查询。

具体页面操作见[工作台语义发布流程](../../../docs/guides/semantic-integration.md)。工作台配置的 `DUCKDB_TOOLS_DATABASE` 应等于本部署 `RDS_DB_PATH` 指向的实际文件；`RDS_AGENT_METADATA_DB` 应等于 `RDS_METADATA_DB_PATH`。两份配置文件不会自动同步。

两个文件都必须已经存在，metadata 必须有 `semantic_publications` 发布记录；服务不会自动创建示例数据、迁移 YAML 种子或替你发布。首次完整查询应使用目录返回的实际指标名，避免照抄当前实例的指标。

### 只读、元数据与文件锁

RDS 适配器每次请求显式传 `read_only=True`，由 SDK 的语义编译器生成 SQL，经 SQLGuard 校验，再由执行器查询。请求成功或失败都关闭 SDK，不保留业务库长连接；单个 Python 进程内串行处理目录和查询。只读连接禁止写入业务库，首版未实现用户级、表级、行列级 ACL。

只读约束针对 **DuckDB 业务库**。当前 RDS 的 SQLite catalog/semantic adapter 仍使用普通 SQLite 连接，并可能执行兼容字段迁移，所以不要直接假定 metadata 能以 OS 只读挂载运行。部署账号需能读取 DuckDB、访问其目录，并能按 RDS schema 兼容逻辑访问/写入 metadata 及其 SQLite journal 所在目录。适配层不提供语义编辑或发布接口。

DuckDB 同一文件不支持工作台读写进程与其他进程的只读连接同时持有锁。建议流程：

```text
工作台连接并导入 / 编辑
    → 校验并发布 metadata
    → 工作台断开对应 DuckDB 读写连接
    → OpenMuse / RDS 查询
    → 停止接收新查询并等待当前请求完成（可停止 API、RDS）
    → 工作台恢复读写连接
```

若无法在 UI 释放连接，可以在确认导入结束后，通过工作台自身管理脚本停止其后端，再查询。本部署不会自动断开其他服务，也不会杀掉未登记的进程。每次查询会刷新 metadata；需要避免查询期间同时修改数据库结构或切换发布版本。持续写入与持续查询并行需要另建一致性查询快照，当前未实现。

## 五、启动、停止与开发

| 服务 | 默认地址 | 前提 |
| --- | --- | --- |
| `rds` | `http://127.0.0.1:8766` | Python 环境、源码路径、token；数据准备就绪后才能查询 |
| `api` | `http://127.0.0.1:8787` | 服务端已编译、模型与 Intelligence 配置；真实数据工具还需要 RDS 可达 |
| `web` | `http://127.0.0.1:8081` | Web 已导出；8081 在当前管理脚本中固定 |

```sh
# 无外部聊天密钥时，先验证数据服务：
./start.sh rds
./start.sh web
.venv/bin/python scripts/check.py
./status.sh

# 补齐聊天密钥后：
./start.sh api
# 或依次尝试三个服务：
./start.sh

# 按服务重启（没有 restart 子命令）：
./stop.sh api
./start.sh api

# 停止单个服务或全部：
./stop.sh web
./stop.sh
```

启动脚本将子进程放入后台，PID/进程身份保存到 `.run/<服务>.json`，日志追加到 `.run/<服务>.log`。停止时按 web → api → rds 顺序发送 SIGTERM，只操作本部署登记且核对身份的进程。`./start.sh` 即使 API 缺配置也会尝试 RDS 和 Web，最后返回非零；这不代表已启动的服务被回滚。`./status.sh` 显示进程记录和 HTTP 探活；它不是模型、数据源或会话可用性验收。

`/health`（RDS）和 `/api/health`（OpenMuse）不证明模型 key 有效、Intelligence 可达、文件无锁或 metadata 完整。查看日志：

```sh
tail -n 80 .run/rds.log
tail -n 80 .run/api.log
tail -n 80 .run/web.log
```

Web 使用 Python 静态文件服务器，适合本地验证；当前没有自启动、日志轮转、崩溃自动拉起或完整生产服务管理。自定义 Web 端口需调整 `scripts/manage.py` 或使用自己的静态服务器，并同步 `ALLOWED_ORIGINS`；没有 `WEB_PORT` 环境变量。

开发模式从 `openmuse/` 执行 `corepack pnpm dev` 启动 tsx watch API，另一个终端执行 `corepack pnpm dev:web`。先停掉管理脚本启动的对应 api/web，避免端口冲突。RDS 仍单独用 `./start.sh rds`。生产构建的 API 不会因源码保存而热更新。

## 验收与检查

### 无模型依赖的数据链路

从部署根目录执行：

```sh
.venv/bin/python -m pytest tests -q
./start.sh rds
.venv/bin/python scripts/check.py
cd openmuse
corepack pnpm exec tsx scripts/check-rds.ts
corepack pnpm test
corepack pnpm typecheck
corepack pnpm build:server
corepack pnpm build:web
cd ..
```

`check.py` 会请求目录并选择一个已发布计数指标（或第一个指标）；输出聚合结果和 SQL，不打印 token。`check-rds.ts` 验证 TypeScript 工具 → HTTP → RDS → DuckDB，示例固定查询 `user_order_history_record_count`；切换数据集需改成新目录存在的指标。

2026-10-15 本机已执行：Python **9 项通过**，OpenMuse 完整测试集 **488 项通过**；TypeScript 类型检查、服务端构建和 Web 导出通过。测试覆盖真实临时 DuckDB、只读写入拒绝、认证、语义编译、筛选、连接释放、版本刷新、工具链、取消和 session 边界；模型服务边界使用 fixture。真实数据的两个 smoke check 返回订单数量 **416**；此前按 `country` 分组验证 **33 组**，与独立 SQL 聚合一致。

测试不证明新机器的运行配置正确，也不证明真实外部模型与 Intelligence 可用。当前实例快照为 `user_order_history` / semantic revision 1；数据改变后不要把 416 写成固定验收断言。

### 配置密钥后的聊天验收

1. 启动 API，访问 <http://localhost:8081> 并建立 session；live 模式输入访问密钥。
2. 提问“订单数量是多少？”；确认 Agent 先发现语义目录再查询，结果卡与数据 smoke check 一致。
3. 提问“按 country 统计订单数量和 pay_amount”；检查维度、指标、SQL、warnings 和 semantic revision。
4. 请求一个未发布指标，确认说明无法匹配；当前指标没有 `time_column`，指定时间范围应明确报错。
5. 新建、重命名会话，刷新并回放，确认结果卡仍能展示；检查服务端未报告 Intelligence/provider 认证错误。
6. 暂时停止 RDS，确认查询失败可见，且不会以示例数据或猜测值代替；之后恢复 RDS。

以上真实聊天与历史回放尚未执行，等待用户自行配置密钥后验收。

## 七、接口与数据约束

RDS HTTP 层不依赖 OpenMuse 登录，使用独立的服务端 `Authorization: Bearer <RDS_API_TOKEN>`。业务客户端应走 OpenMuse 的 session 及代理，不持有此 token。

| 接口 | 鉴权 | 含义 |
| --- | --- | --- |
| RDS `GET /health` | 无 | 进程探活，返回 `read_only: true`；不触发数据源校验 |
| RDS `GET /api/v1/catalog` | RDS bearer | 已发布表、指标、维度、时间字段、版本；省略维度 mappings |
| RDS `POST /api/v1/query` | RDS bearer | 结构化语义查询 |
| OpenMuse `GET /api/health` | 无 | OpenMuse 探活 |
| OpenMuse `POST /api/session` | live 需 accessKey | 建立现有 OpenMuse session，返回客户端 session token |
| OpenMuse `GET /api/data/catalog`、`POST /api/data/query` | OpenMuse session bearer | 登录后代理 RDS；由服务端注入私有 RDS token |

查询体示例（指标/维度名称必须来自实际目录）：

```json
{
  "question": "按国家统计订单数量",
  "metrics": ["user_order_history_record_count"],
  "dimensions": ["country"],
  "filters": {},
  "semantic_filters": [],
  "order_by": {"field": "user_order_history_record_count", "direction": "desc"},
  "limit": 100
}
```

约束：至少 1 个指标、至多 20 个指标；维度至多 10 个；`filters` 是维度/字段到标量或标量列表的映射，具体可用形式受 RDS 编译器约束；`semantic_filters` 至多 20 项；`question` 至多 4000 字符；`limit` 1–1000，默认 100；可选 `order_by` 的方向为 asc/desc。`time_range` 需要相关指标发布 `time_column`，实际表达式由 RDS 时间解析器解释。未知参数如 `sql`、`db_path` 会被拒绝。TypeScript 契约见 [rds.ts](../../openmuse/packages/domain/src/rds.ts)，Python 请求约束见 [app.py](../../rds_api/app.py)。

返回含 `success`、`data`、`columns`、`row_count`、`execution_time`、`sql`、`error`、`warnings`、`read_only`、`semantic_revision`。`execution_time` 单位为秒；Decimal 以字符串保持精度，日期为 ISO 字符串，非有限浮点数为 null。业务执行失败可能以 HTTP 200 + `success:false` 返回，调用方必须检查该字段。达到 limit 会提示更多分组可能未返回。

RDS 直接接口：401 为 token 错误，422 为请求/语义编译校验失败，503 为文件缺失、没有发布版本、锁冲突等暂不可用。OpenMuse 代理本地 JSON/Zod 校验失败返回 422，上游 RDS 错误可能统一映射为 503；工具执行把错误作为结果交回 Agent。Node RDS 客户端超时为 75 秒；它不等同于数据库执行已被取消，停止客户端请求后仍需等待服务端释放连接。

## 八、远程主机与原生客户端

### 保持本地绑定，使用 SSH 隧道

最接近已验证拓扑的远程访问方式是在服务器按上文安装，并保持 `.env` 的 loopback 默认值。从自己的电脑建立双端口转发：

```sh
ssh -N -L 8081:127.0.0.1:8081 -L 8787:127.0.0.1:8787 用户名@服务器地址
```

在电脑打开 <http://localhost:8081>；Web 的 `localhost:8787` 也会通过隧道访问。RDS 8766 无需向客户端转发。若本机端口占用，应同步修改公开 URL、origin 和客户端构建，不能只换 SSH 映射后仍使用旧 bundle。

### 提供 HTTPS 站点

公网/团队部署在本次本地验证范围外，建议先完成 SSH 隧道验收，再配置反向代理与常驻服务：

- OpenMuse 使用 `WORKSPACE_MODE=live`、`AGENT_BACKEND=model`，设置随机 `OPENMUSE_ACCESS_KEY` 和 `TOKEN_ENCRYPTION_KEY`。sample 模式无访问密钥门槛且只能本地绑定。live 是 OpenMuse 应用模式，与 DuckDB 数据是否真实无关。
- 配置 HTTPS 的实际 `PUBLIC_API_URL`、`EXPO_PUBLIC_API_URL` 和 `ALLOWED_ORIGINS`，重建客户端。API 的 `/` 返回 JSON，静态站点需单独托管 `apps/mobile/dist/web`。
- 反向代理将 API 请求转给 loopback8787，静态文件来自 Web 产物；使用同域代理时保留 `/api` 路径，AG-UI/SSE 流关闭代理缓冲并设置合适的读取超时。RDS8766 保持内部可达。
- 用 systemd/launchd 等管理独立前台进程，工作目录分别为部署根目录（`.venv/bin/python -m rds_api`）、`openmuse/`（`node dist/apps/server/src/index.js`）。由一个管理器负责同一端口，避免与 `start.sh` 同时管理。
- API 进程读取 `openmuse/.env`，RDS 读取部署 `.env`；服务账号只需相应持久化目录权限，预先创建并保护 `.env`。`DATA_DIR` 使用持久盘绝对路径，数据库与 metadata 使用本机实际路径。
- 默认 PGlite 只运行一个 API 进程，禁止 API 与独立任务 worker 同时打开同一 PGlite；需要分离时先配置 PostgreSQL 和共享文件目录。

本版没有提供已验证的 Docker Compose、Kubernetes、完整 systemd 单元或多租户 ACL。现有 session 是单 owner + 共享访问密钥；将只读服务对外开放前，按实际访问需求配置入口认证和网络范围。

### 原生设备

在 `openmuse/` 用 `corepack pnpm dev:mobile` 运行 Expo dev client。`build:ios` / `build:android` 是 JS/资源导出，安装原生应用还需要上游的 dev client / Xcode / Android SDK 流程，见 [OpenMuse README](../../openmuse/README.md)。

真机上的 localhost 是手机自身；Android 模拟器访问宿主通常使用 `10.0.2.2`。本部署生成的移动端 `.env` 显式指定 localhost，会覆盖源码内的 Android 默认地址；使用设备可达的 HTTPS API 地址更新它。当前 API loopback + sample 配置不能直接通过局域网 IP 给真机使用；可采用有认证的 live API/代理，然后重新运行 configure 并重启 Expo。设备只需访问 OpenMuse API，不需要读取数据库或拿到 RDS token。

## 九、升级、备份与回滚

需要持久化和备份：业务 DuckDB、匹配的 SQLite metadata、OpenMuse `DATA_DIR`（默认 `openmuse/.openmuse`，含状态、文件与签名密钥）、私有 `.env` 及两个源码版本。Intelligence 保存的远端会话不在本地备份范围内；本地文件缺失时，远端会话里的文件引用仍可能失效。

备份前停止新的查询和工作台写入，等待请求完成。停止 API、RDS 以及工作台写入进程后，再复制 DuckDB 及整组本地持久化目录；SQLite 若仍被其他进程访问，使用 SQLite backup API 或先停止写入方，不要只复制可能有未合并 WAL 的主文件。备份放在仓库外并保护权限，不能将数据库或 `.env` 加入 Git。

更新步骤：

1. 记录当前父仓库和 RDS SHA，备份数据及配置，确认本地改动已保存。
2. 停止 API/RDS（及会写库的工作台）。在干净仓库获取目标版本；普通分支更新用 `git pull --ff-only`，不要覆盖未提交改动。
3. 检查依赖、schema、默认配置变更。`setup.sh` 保留旧 `.env`，新增配置需与 `.env.example` 对照合并。
4. 重跑安装、server/Web 构建、测试和真实数据检查，启动服务，再验证聊天与会话回放。
5. 回滚时停服，在干净检出中恢复已知代码与外部 SDK 版本，按锁文件重新安装/构建。如果升级改变了 schema，还需恢复兼容的数据/metadata/应用状态备份；仅回退 Git 不会回退数据库。

## 十、故障排查

| 现象 | 检查与处理 |
| --- | --- |
| `ModuleNotFoundError: integration` / `core` | RDS 源码未安装到默认相邻位置；检查 `RDS_AGENT_ROOT`、工作目录和验证提交，重启 RDS |
| `No module named pip` | 环境由 uv 创建，使用 `uv pip --python .venv/bin/python` |
| pnpm frozen lock / 版本错误 | 先进入 `openmuse/`，用 `corepack pnpm --version` 确认 11.19.0；不要为安装成功直接删锁文件 |
| 缺少 Python wheel / Node 编译错误 | 对照推荐运行时版本和目标平台，检查实际 PATH；更换 Python 后需重建虚拟环境并重新验收 |
| RDS health 正常但 catalog/query503 | health 只探活；检查两个数据路径、发布记录、文件权限、metadata schema 和 DuckDB 锁 |
| `DuckDB is busy` / lock / different configuration | 工作台或其他进程还持有同一文件的 RW 连接；等导入完成并通过所属服务释放连接，再重试；不要强杀未知进程 |
| `No published semantic revision` | 只保存了草稿或指错 metadata；在工作台校验并发布，确认两边使用同一 SQLite |
| RDS401 | API/RDS token 不一致、太短或被 shell 覆盖；同步配置并重启双方，避免打印 token |
| 查询422 / 指标找不到 | 先读 catalog，使用已发布 canonical name；检查 filters、关联、limit 等编译器约束 |
| `has no published time column` | 该指标没有 `time_column`；补充语义定义并发布，或明确不做时间筛选 |
| `success:false` | 数据执行失败，查看返回 error 和服务日志；不要仅以 HTTP200 判成功 |
| API 提示缺 key / MODEL | 按聊天配置填入 `.env`；`start.sh api` 会拒绝空值；sample 工作区也需要 Intelligence |
| API 探活正常但登录/聊天失败 | 实测外部 key、模型工具调用和 Intelligence 网络；health 不验证外部账号，查看 `.run/api.log` |
| Web 空白 / Network failed / CORS | 检查静态产物、8787服务、公开 URL 与 origin，确认 Web bundle 已重建；API不是静态站点服务器 |
| 手机/模拟器无法访问 | 检查 localhost 指向、移动端生成 `.env`、可达 HTTPS API，以及是否仍使用 sample loopback 配置 |
| `unmanaged service` / 端口占用 | 管理脚本保留其他服务；用所属服务管理器处理，或改端口并同步 URL；Web8081需改管理脚本或自建静态托管 |
| `.run` 显示未运行但 health 正常 | 可能是未登记/进程身份已变化的服务；检查 PID 和实际命令，再用原管理器处理，不能按端口盲目杀进程 |
| 改 `.env` 不生效 | 检查 shell 覆盖、OpenMuse符号链接、自定义移动端文件；重启对应服务，公开变量需重新构建 |
| PGlite / 应用状态目录锁 | 默认只运行一个 API；先停止多余进程，独立 worker改用 PostgreSQL，不要删除状态库来解锁 |

排错时分享日志前移除用户数据和凭据。`.env`、`.venv`、`node_modules`、数据库、构建产物、`.run` 和日志不进入版本提交。已提交的是源码、许可证、锁文件、配置模板和说明文档。
