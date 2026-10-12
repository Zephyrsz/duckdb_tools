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
3. 在“语义目录”选择一张表，进入表级字段元数据表格。字段名、类型、可空约束、空值数、不同值数和样例为只读信息；业务名称、字段说明、主键标注和确认状态可以直接编辑。点击“保存字段标注”一次保存多个字段，或用“撤销修改”恢复未保存的内容。首次保存会自动为该表生成缺失草稿，无须先扫描。
4. 点击“校验草稿”。校验会检查表/列存在性、重复 canonical name 和危险 SQL 表达式。
5. 所有需要发布的候选确认且校验通过后，点击“发布 metadata”。不采用的候选可标为“忽略”，不参与发布，也不阻止校验。发布在一个 SQLite 事务中执行并生成递增 revision。

字段元数据保存到共享 SQLite 的 `semantic_drafts`，保存不立即更改 Agent 正在使用的已发布元数据。发布时业务名称、说明和主键标注写入 SQLite `columns`；业务名称使用兼容新增的 `display_name` 列，RDS Agent 现有读取接口继续使用字段名和说明。主键标注是业务元数据，不会修改 DuckDB 的实际约束；可空属性来自 DuckDB 表结构。

日期、时间等字段也会生成字段草稿。再次扫描同一张表时，会更新数据样例并保留已有人工名称、说明、主键标注和确认状态；没有草稿的已发布字段会从 SQLite 恢复已有标注。字段已被删除时不会继续生成该字段草稿。发布更新现有字段记录，保留字段 ID、外键、枚举等本次未编辑的元数据。“忽略标注”保留实际字段结构，沿用已发布标注或默认信息。批量保存会先检查字段是否存在和是否重复，再在一个 SQLite 事务内写入，失败时保留页面上的修改供重试。

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
