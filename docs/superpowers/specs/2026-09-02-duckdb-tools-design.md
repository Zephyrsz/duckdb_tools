# DuckDB 数据工作台设计

## 目标

为业务人员提供远程浏览器可用的基础 DuckDB 数据工作台：上传带表头的 CSV/Excel 文件，预览并导入到服务器上的 DuckDB 数据集；随后按表浏览字段和样例数据，或执行查询类 SQL 并查看结果。

## 用户流程

1. 用户进入工作台，看到当前数据集和已有表列表。
2. 点击上传，选择 `.csv` 或 `.xlsx` 文件。
3. 后端保存上传文件并生成预览：文件名、列名、推断类型、前 5 行；用户确认目标表名。
4. 后端导入 DuckDB，返回表名、行数、列定义；前端显示阶段轨道和完成提示。
5. 用户从表列表选择表，查看字段摘要和前 100 行。
6. 用户进入 SQL 查询模式，编辑查询类 SQL，点击执行，查看列、类型、行数与结果。

## 后端边界

- `POST /api/upload/preview`：接收 `.csv` 或 `.xlsx` 文件，保存到 `data/uploads`，返回解析类型、列定义和前 5 行。
- `POST /api/import`：接收上传文件路径、目标表名和表头选项，写入 `data/workspace.duckdb`。
- `GET /api/database`：返回数据库文件名和表级摘要。
- `GET /api/tables/{table_name}`：返回表列定义和前 100 行。
- `POST /api/query`：只执行单条只读查询，拒绝 `INSERT/UPDATE/DELETE/CREATE/DROP/ALTER/COPY/ATTACH/DETACH` 等写入或管理语句；返回列、类型、行数、结果行和耗时。

查询安全采用首关键字白名单（`SELECT`, `WITH`, `DESCRIBE`, `SHOW`, `EXPLAIN`）并拒绝多语句分隔符；服务器不暴露任意文件路径，表名通过 DuckDB 标识符引用。

## 前端边界

React 单页工作台包含 `Sidebar`、`Topbar`、`ImportPanel`、`TableBrowser`、`SqlWorkspace`、`DataGrid` 和状态提示。前端状态只保存当前数据集、表列表、选中表、导入阶段、查询文本、结果和错误；不引入状态管理库。

## 错误与空状态

- 文件格式不支持：说明支持的扩展名。
- 解析失败：显示文件名与可恢复动作“重新选择文件”。
- 导入失败：保留预览结果，不清空表单。
- 查询失败：在结果区展示服务端错误，不替换编辑器内容。
- 无表：侧栏显示上传入口和“还没有数据表”的引导。

## 验证策略

- Python 单元测试覆盖 CSV/Excel 预览、导入、表信息、查询白名单。
- 前端构建验证 TypeScript 与 Vite 产物。
- 启动 FastAPI 与 Vite，手动/浏览器验证主流程和窄屏布局。
