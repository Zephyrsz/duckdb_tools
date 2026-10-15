# 依赖、版本与外部服务

文档类型：当前依赖与运维说明。核验日期：2026-10-15。权威版本来源为本目录 `requirements.lock.txt`、`openmuse/pnpm-lock.yaml` 及对应源码；本文随代码更新，不替代锁文件。

## 部署边界

本部署包含 OpenMuse 源码副本、RDS HTTP 适配代码、脚本和测试。安装依赖不会自动安装或启动工作台，不会下载业务数据，也不会替用户发布语义定义。

| 组件 | 是否已包含 | 用途及版本依据 |
| --- | --- | --- |
| OpenMuse 源码 | 是 | 上游 [CopilotKit/OpenMuse](https://github.com/CopilotKit/OpenMuse)，基于 `1ac68f3909f2478ab6280883f1ab5ea65eb5719d`；记录在 [UPSTREAM_REVISION](../../openmuse/UPSTREAM_REVISION) |
| CopilotKit SDK | 随 pnpm 安装 | Runtime 与 React Native SDK 均固定 `1.70.1`；无需编译相邻的 `CopilotKit/` 仓库 |
| RDS Agent 源码 | 否，单独检出 | [Zephyrsz/rds_agent](https://github.com/Zephyrsz/rds_agent)，本次验证提交 `935e16fac941f17caecb429e0737410759797a44`，分支 `codex/sqlite-semantic-layer-phase0-2` |
| DuckDB Tools 工作台 | 当前父仓库 | 数据导入、草稿编辑和语义发布入口；运行查询服务时无需持续运行工作台 |
| DuckDB 数据文件 | 否 | 已存在的业务数据；默认 `duckdb_tools/data/workspace.duckdb` |
| SQLite metadata | 否 | 工作台已校验发布的语义定义；默认 `rds_agent/var/metadata.db` |
| CopilotKit Intelligence | 外部服务 | 会话、历史与回放；必须有服务端项目密钥 |
| 模型服务 | 外部服务 | OpenAI 兼容服务、Anthropic 或 Google；启用真实数据聊天时必需 |

OpenMuse 的 MIT 许可证见 [LICENSE](../../openmuse/LICENSE)。Intelligence 和模型服务有独立的账号、网络与服务条款，不包含在源码许可证内。RDS 是源码路径依赖，当前没有作为此部署的 wheel 安装；仅保存 Python lockfile 不能替代保存 RDS 源码版本。

## 系统工具

| 工具 | 要求 / 已验证版本 | 说明 |
| --- | --- | --- |
| OS | 已验证 macOS Apple Silicon | Bash、`ps`、进程组信号可用；Linux 部署需在目标机重新执行验收；Windows 建议 WSL2，未验证原生 Windows 脚本 |
| Git / SSH 或 HTTPS 凭据 | 能读取两个源码仓库 | 部署无需仓库写权限 |
| Node.js | 上游声明 `>=22`，推荐已验证 `v24.13.1` | 用于 Hono API、编译和 Expo；生产 API 也需要 Node |
| Corepack | 已验证 `0.34.6` | 读取 OpenMuse 的 `packageManager` 字段；Node 安装未附带时可用 `npm install -g corepack` 安装 |
| pnpm | **11.19.0** | 在 `openmuse/` 中使用 `corepack pnpm`；不要使用系统里其他版本的 pnpm，也不要在部署根目录调用它来判定项目版本 |
| Python | 推荐已验证 `3.14.6` | 此 lockfile 在 Python 3.14 上生成并验证；其他 Python 版本需验证包兼容性和二进制 wheel，不能据此宣称全部支持 |
| uv | 已验证 `0.12.5` | `setup.sh` 用于创建虚拟环境、安装 Python 依赖；虚拟环境未内置 pip，使用 `uv pip --python ...` 管理 |

安装工具可参考 [Node.js](https://nodejs.org/en/download) 和 [uv 官方安装说明](https://docs.astral.sh/uv/getting-started/installation/)。例如 macOS 使用 Homebrew：

```sh
brew install node@24 python@3.14 uv
# 按 brew 提示把 node@24、python@3.14 的 bin 加入 PATH。
# 若 command -v corepack 没有结果，再执行：
npm install -g corepack
```

不需要全局安装 DuckDB CLI、PostgreSQL、Redis、Docker、CopilotKit 源码构建工具或 RDS MCP Server。默认聊天由 OpenMuse 模型完成语义意图转换，RDS 只负责编译和执行结构化查询，不需要额外配置 `RDS_LLM_*` 或 DeepSeek Harness。

网络安装需要访问 Python 包源、npm/pnpm 包源和 Git 仓库。运行时 RDS 查询留在本机；完整聊天还需访问所选模型与 Intelligence 服务。语义目录和查询结果会进入 Agent 上下文及会话链路，按业务数据要求选择允许使用的外部服务。

## Python 依赖

直接声明见 [requirements.txt](../../requirements.txt)，部署使用 [requirements.lock.txt](../../requirements.lock.txt) 的精确版本安装，目前锁定 62 个包。

| 直接依赖 | 声明 | 本次锁定版本 | 用途 |
| --- | --- | --- | --- |
| duckdb | `==1.5.5` | 1.5.5 | 业务库只读连接；建议工作台写入端使用相同版本 |
| fastapi | `>=0.115,<1` | 0.143.1 | RDS HTTP 接口、请求验证 |
| uvicorn | `>=0.30,<1` | 0.54.0 | ASGI 服务 |
| langgraph | `>=0.2,<2` | 1.2.15 | 现有 RDS SDK 导入的工作流依赖 |
| langchain-openai | `>=0.2,<2` | 1.7.2 | 现有 RDS SDK 的模型组件导入依赖；结构化查询不调用其模型 |
| sqlparse | `>=0.5,<1` | 0.6.0 | SQL 解析与校验 |
| sqlglot | `>=23,<31` | 30.23.0 | SQL AST 与安全校验 |
| pandas | `>=2,<4` | 3.0.6 | RDS 数据处理 |
| pyyaml | `>=6,<7` | 6.0.3 | RDS 配置导入 |
| structlog | `>=24,<27` | 26.1.0 | RDS 日志 |
| python-dotenv | `>=1,<2` | 1.2.4 | 加载本地 `.env` |
| pytest | `>=8,<10` | 9.1.1 | 集成测试 |
| httpx | `>=0.27,<1` | 0.28.1 | HTTP 测试与底层客户端依赖 |

锁文件还固定 Pydantic、NumPy、LangChain Core 等传递依赖。此列表是适配服务已验证的 SDK 导入闭包，不是 RDS 仓库所有功能的完整开发环境。不要向本虚拟环境直接安装 RDS 整份宽松 `requirements.txt`，否则可能改动已验证版本；需要 MCP 或其他 RDS 功能时使用该项目自己的环境。

## Node 与客户端依赖

权威文件为 [根 package.json](../../openmuse/package.json)、[移动端 package.json](../../openmuse/apps/mobile/package.json)、[worker package.json](../../openmuse/apps/worker/package.json) 和 [pnpm-lock.yaml](../../openmuse/pnpm-lock.yaml)。

| 组件 | 当前版本 | 用途 |
| --- | --- | --- |
| `@copilotkit/runtime` / `@copilotkit/react-native` | 1.70.1 | Agent Runtime、客户端聊天、工具结果渲染 |
| `@ag-ui/client` / `@ag-ui/core` | 0.0.59 | Agent 事件协议 |
| TanStack AI | 0.59.0 | 模型调用与 provider adapters |
| Hono | 4.13.13 | API、session、RDS 代理路由 |
| PGlite | 0.3.16 | 默认本地应用状态存储 |
| Expo | 54 系列 | Web 导出和原生客户端工具链 |
| React / React Native | 19.1.0 / 0.81.5 | 客户端运行时 |
| Zod | 4.6.5 | 请求、目录与结果契约 |
| TypeScript | 5.9.3 | 类型检查与服务端编译 |

服务端和共享 packages 由根 TypeScript 工程编译；pnpm workspace 包括移动端和 worker。安装过程中可能下载较大的移动端依赖，请预留数 GB 磁盘。服务运行需要 `node_modules`，不能只复制编译后的 `dist`。

## 必需配置与可选组件

| 场景 | 必需项 | 默认是否启用 |
| --- | --- | --- |
| RDS 数据接口与 CLI 验证 | RDS 源码、两个数据库文件、`RDS_API_TOKEN` | 是；无需外部聊天密钥 |
| OpenMuse 真实数据聊天 | 上述数据服务、`CPK_INTELLIGENCE_API_KEY`、`MODEL`、对应 provider key | 配置密钥后启动 |
| Web 静态页面 | Web 构建产物、可达的 OpenMuse API | 可独立展示页面；登录和聊天依赖 API |
| 后台任务 | 模型、Intelligence、`TASK_WORKER_ENABLED=true` | 否；首版可在 API 进程内运行任务 |
| 邮件 / 日历真实账号 | live 模式、Google OAuth 配置与授权 | 否；详见上游说明 |
| 网页搜索 | 上游搜索服务配置与网络 | 否，`WEB_SEARCH_ENABLED=false` |
| 浏览器 worker | Playwright worker、浏览器安装、worker URL/token | 否；数据查询不依赖浏览器 |
| 电脑容器 | Docker 或 E2B 账号与相关配置 | 否，`COMPUTER_ENABLED=false` |
| Jev | 上游 TypeSafe 配置 | 否，`JEV_MODE=off` |
| 独立任务 worker / 多进程应用存储 | PostgreSQL `DATABASE_URL`、共享持久化目录 | 否；PGlite 不支持 API 与独立 worker 进程同时打开 |
| iOS / Android 原生编译 | Xcode / Android SDK、Expo dev client | 非 Web 部署依赖；Web 导出不需要它们 |

## 依赖升级约定

1. 保存当前 Git 提交、RDS 源码提交、数据库/metadata 备份和本地配置备份。
2. 修改 Python 直接依赖后，在隔离环境安装、验证，再生成精确版本：`uv pip freeze --python .venv/bin/python > requirements.lock.txt`。锁文件是版本清单，不是 wheel 哈希校验清单。
3. 在 `openmuse/` 中用 `corepack pnpm` 更新包和锁文件；Runtime、React Native SDK 及相关 CopilotKit 包需一起评估，不单独替换为最新版本。
4. 升级 RDS 时检查 SDK、语义编译器及 SQLite schema 兼容性，更新本文的验证提交。当前脚本不自动强制 RDS checkout 到该提交。
5. 完成[验收步骤](deployment.md#验收与检查)，把代码、锁文件和文档同次提交。升级上游 OpenMuse 时保留本地 RDS 改动及许可证，更新 `UPSTREAM_REVISION`。
