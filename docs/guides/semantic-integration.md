# DuckDB Tools 与 RDS Agent 语义层集成

`duckdb_tools` 和 `rds_agent` 使用两个存储边界：DuckDB 保存业务数据，SQLite 保存语义和 metadata。前台导入的表写入 `workspace.duckdb`；语义层页面扫描这个 DuckDB，生成草稿并把确认后的表、列、实体、度量、指标、维度和术语写入共享 SQLite。

默认路径：

```text
duckdb_tools/data/workspace.duckdb
rds_agent/var/metadata.db
```

可以通过环境变量覆盖：

```bash
export DUCKDB_TOOLS_DATA=/srv/data
export RDS_AGENT_ROOT=/srv/rds_agent
export RDS_AGENT_METADATA_DB=/srv/rds_agent/var/metadata.db
```

使用流程：

1. 在 DuckDB Tools 导入 CSV/XLSX。
2. 打开“语义层”，点击“扫描数据”。扫描只创建 SQLite 草稿，不修改 RDS Agent 的 active metadata。
3. 在字段标注页编辑显示名、描述、表达式和确认状态。
4. 点击“校验草稿”。校验会检查表/列存在性、重复 canonical name 和危险 SQL 表达式。
5. 所有候选确认且校验通过后，点击“发布 metadata”。发布在一个 SQLite 事务中执行并生成递增 revision。

RDS Agent 启动时直接指向同一份文件和 DuckDB：

```python
from integration.sdk import RDSAgent

with RDSAgent(
    db_path="/srv/data/workspace.duckdb",
    metadata_db_path="/srv/rds_agent/var/metadata.db",
) as agent:
    result = agent.query("按地区统计销售额")
```

SQLite schema 使用 RDS Agent 的 `adapters/sqlite_schema.sql`。发布后可用 RDS Agent 的 `SQLiteCatalog` 和 `SQLiteSemanticLayer` 读取 `metrics`、`dimensions`、`measures` 等对象；YAML 仍是 RDS Agent 的 seed/迁移格式，不是运行时 source of truth。
