# OpenMuse + RDS 本地部署

此目录包含可独立安装的 OpenMuse 副本和 RDS HTTP 适配服务。原始 `openmuse/`、`rds_agent/` 仓库保持不变。

本目录随 `duckdb_tools` 提交；其中 `openmuse/` 是保留 MIT 许可证的源码副本，不是 Git 子模块。RDS 源码、业务 DuckDB 和已发布的 SQLite metadata 为外部依赖，不随本目录分发。

## 文档入口

| 文档 | 内容 |
| --- | --- |
| [完整依赖说明](docs/guides/dependencies.md) | 系统工具、精确版本、锁文件、外部服务、可选组件和升级约定 |
| [完整部署说明](docs/guides/deployment.md) | 全新安装、配置表、数据准备、启动停止、验收、远程访问、备份恢复与排错 |
| [变更记录](docs/changelog.md) | 本部署模块的对外行为变更 |
| [工作台语义发布流程](../docs/guides/semantic-integration.md) | 导入、扫描、字段标注、校验与发布 |

核验日期：2026-10-15。文档与本目录代码同次提交，可用 `git log -1 -- data_agent_deploy` 查看版本。下面是当前本地实例的快速参考；跨机器安装请使用完整部署说明。

```text
OpenMuse Web / iOS / Android
  → OpenMuse Hono + CopilotKit Runtime
  → get_semantic_catalog / query_semantic
  → 本地 RDS HTTP 服务
  → RDS SemanticQueryCompiler → SQLGuard → QueryExecutor
  → DuckDB（read_only=True）
```

## 默认数据源

| 配置 | 默认值（相对此目录） |
| --- | --- |
| RDS_AGENT_ROOT | ../../rds_agent |
| RDS_DB_PATH | ../data/workspace.duckdb |
| RDS_METADATA_DB_PATH | ../../rds_agent/var/metadata.db |
| RDS_API_URL | http://127.0.0.1:8766 |
| OpenMuse API | http://localhost:8787 |
| OpenMuse Web | http://localhost:8081 |

当前语义版本为 1，业务表为 `user_order_history`，记录数为 **416**。可用指标包括 `user_order_history_record_count`（订单数量）和 `pay_amount`；维度由发布目录返回。

这是共享真实文件，不复制业务数据，也不会创建示例库或自动发布/修改语义定义。路径可在 `.env` 中更改；绝对路径最方便。新增或修改业务定义后，先在 duckdb_tools 校验并发布，下一次请求会重新读取语义元数据。

## 安装与构建

需要 Node 24、Corepack、uv 和 Python，已验证 Python 3.14.6；其他 Python 版本需重新验证锁文件兼容性。OpenMuse 使用锁定的 CopilotKit 1.70.1，来源提交记录于 `openmuse/UPSTREAM_REVISION`。所有 `corepack pnpm` 命令都应在 `openmuse/` 中执行，以使用项目指定的 pnpm 11.19.0。

```sh
cd /Users/rgwei/pj/pj_data/duckdb_tools/data_agent_deploy
./setup.sh
cd openmuse
corepack pnpm build:server
corepack pnpm build:web
```

`setup.sh` 创建独立 `.venv`，从 `requirements.lock.txt` 安装 Python 包，并使用 OpenMuse 原始 pnpm lockfile。它首次运行会创建权限为 600 的 `.env` 和随机的服务端 `RDS_API_TOKEN`，以后保留现有配置。`openmuse/.env` 指向部署配置；移动端 `.env` 仅生成公开的 API 地址，不包含密钥。修改公开 API 地址后重新运行 `python3 scripts/configure.py` 并重新导出 Web。

## 启动、状态与停止

```sh
./start.sh rds           # 不需要模型或 Intelligence 密钥
./start.sh web           # 提供已导出的 Web 静态页面
./status.sh
.venv/bin/python scripts/check.py

./start.sh api           # 配置聊天密钥后使用
./start.sh               # 依次尝试启动三个服务；缺配置时返回非零退出码
./stop.sh               # 仅停止该部署记录并核对身份的进程
```

进程信息和日志位于 `.run/`。脚本在后台启动服务；占用端口的其他服务不会被停止。RDS 和 Web 可以独立运行，但缺少 OpenMuse API 时 Web 无法登录或聊天。当前按用户选择保留聊天密钥为空，API 暂不启动。

## 稍后配置聊天

在本地 `.env` 填写：

```dotenv
CPK_INTELLIGENCE_API_KEY=你的项目密钥
MODEL=openai/你的模型名
OPENAI_API_KEY=你的模型密钥
# 如使用兼容网关：
# OPENAI_BASE_URL=https://你的服务/v1
# OPENAI_CHAT_COMPLETIONS=true
```

也可使用 `anthropic/模型名` + `ANTHROPIC_API_KEY`，或 `google/模型名` + `GOOGLE_API_KEY`。Intelligence 是 OpenMuse 当前会话持久化所需的独立服务；没有做绕过或虚假密钥配置。密钥仅保存在本地 `.env`，不应写入 `EXPO_PUBLIC_` 配置。

填写后执行 `./start.sh api`，打开 http://localhost:8081。可尝试“订单数量是多少？”或“按 country 统计订单数量和 pay_amount”。Agent 先发现语义目录，再提交结构化查询；聊天中会展示表格、耗时、语义版本、warnings 和可展开 SQL。

默认 `WORKSPACE_MODE=sample` 仅用于 OpenMuse 本地应用工作区；数据工具始终查询上述真实 DuckDB。服务绑定 loopback。首版关闭网页搜索、电脑容器和后台任务 worker；如需后台报告，可配置 `TASK_WORKER_ENABLED=true` 并重启 API，同一套 RDS 工具已接入任务 Agent。

## 查询接口

RDS 服务的 `/health` 可用于进程探活；目录和查询均要求 `Authorization: Bearer <RDS_API_TOKEN>`。

- `GET /api/v1/catalog`：发布的指标、维度、表、语义版本；省略可能包含原始值的维度 mappings。
- `POST /api/v1/query`：只接受语义查询，不接受原始 SQL 或数据库路径；至少指定一个指标，limit 为 1–1000，默认 100。

示例请求体：

```json
{
  "question": "按国家统计订单数量",
  "metrics": ["user_order_history_record_count"],
  "dimensions": ["country"],
  "filters": {},
  "order_by": {"field": "user_order_history_record_count", "direction": "desc"},
  "limit": 100
}
```

查询由现有 RDS SDK 的语义编译器、SQLGuard 和执行器完成。数值型 Decimal 以字符串无损返回，日期以 ISO 字符串返回。编译失败返回 422；文件锁冲突等暂不可用状态返回 503。达到 limit 会提示结果可能不完整。

OpenMuse 登录后还可使用 `/api/data/catalog`、`/api/data/query`；这些接口经过现有 session 中间件，由服务端转发私有 RDS token。聊天和后台任务复用 `apps/server/src/rds-tools.ts`；客户端通过 `useRenderTool` 渲染 `data-tool-card.tsx`。

当前数据源的指标尚未发布 time_column，因此带 `time_range` 的请求会明确拒绝，避免悄悄返回全时间范围结果。需要时间分析时先完善语义定义。编译器仍受 rds_agent 现有能力限制，例如至少一个指标、受支持的关联和筛选形式。

## 只读连接与导入切换

每个 RDS 请求打开 `read_only=True` 的 DuckDB 连接，并在成功或失败后关闭；不保留业务库的长连接。权限首版使用数据库只读模式，ACL 后续补充；现有 SQLGuard 保留。

DuckDB 只读连接不能与工作台的读写连接同时持有同一文件。导入完成后，在 duckdb_tools 中断开读写连接，再查询。恢复导入前暂停查询并等待请求完成。此服务不会自动断开工作台或杀掉其他进程。需要持续导入与持续查询并行时再引入查询快照。

## 已执行的验证

- Python 集成测试：**9 项通过**，覆盖真实临时 DuckDB、语义编译、筛选、认证、请求校验、只读写入拒绝、连接释放、语义版本刷新和本地进程识别。
- OpenMuse 完整测试集：**488 项通过**，其中 RDS 集成覆盖 HTTP 客户端、工具执行、失败与取消、会话认证、实际 ConversationAgent 的 AG-UI 语义结果事件以及任务 Agent；模型服务边界使用本地 fixture。
- TypeScript 类型检查、服务端构建和 Expo Web 导出。
- 真实数据端到端：OpenMuse TypeScript 工具 → 本地 RDS HTTP → 只读 DuckDB，订单数量返回 **416**；按国家分组返回 **33 组**，记录数和金额聚合均与独立 SQL 一致。

复查命令：

```sh
.venv/bin/python -m pytest tests -q
.venv/bin/python scripts/check.py
cd openmuse
corepack pnpm exec tsx --import ./tests/setup.ts --test tests/rds.test.ts
corepack pnpm exec tsx scripts/check-rds.ts
corepack pnpm typecheck
```

真实模型 + Intelligence 的聊天、会话保存/回放尚未验证，等待用户补充密钥；测试中的 provider fixture 不代表外部服务验证通过。
