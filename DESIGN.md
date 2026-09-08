# Design

<!-- impeccable:design-schema 1 -->

## Visual World

模块化数据工作台。界面像一张精密但友好的数据操作台：深石墨对象导航固定在左侧，浅灰工作区承载表格，青绿色作为当前对象与可执行动作的唯一强强调色，紫蓝用于导入阶段的流程识别。模块之间用清晰的边界、对齐线和稳定的密度表达层级，不用装饰性渐变或大面积圆角卡片。

## Mode

Operate

## Color Strategy

Restrained：冷白内容面、蓝灰分区面、深石墨导航面；青绿色只用于主操作、选中、成功和运行状态；紫蓝只用于导入流程的阶段标识；红色用于错误。

## Typography

使用系统无衬线字体栈，中文优先 `-apple-system`, `BlinkMacSystemFont`, `Segoe UI`, `PingFang SC`, `Microsoft YaHei`, sans-serif。SQL、文件名、表名和数值使用 `SFMono-Regular`, `Roboto Mono`, monospace。

## Composition

- 固定顶部工具栏：产品名、当前 DuckDB 数据集、上传入口、运行状态。
- 左侧 248px 对象导航：数据集信息、表列表、表行数、连接状态。
- 主区域采用上下分割：上方根据当前模式展示导入/表浏览/SQL 查询；下方在 SQL 模式固定展示结果。
- 移动端将左侧导航收为顶部抽屉，SQL 编辑区和结果区纵向排列。

## Interaction Grammar

- 导入流程为显式的四段状态：选择文件、检查预览、导入中、完成。
- 表列表点击即加载表结构和前 100 行数据。
- SQL 执行按钮在编辑器右上角，结果区显示列、类型、行数和耗时。
- 所有异步动作都提供 loading、error、empty 和 success 状态。

## Signature Detail

导入流程顶部有一条由四个模块组成的阶段轨道，当前阶段用青绿色填充，已完成阶段保留细线和对勾；它把 Airbyte 的可观察导入步骤转译成业务人员可理解的进度。

## Responsive Rules

- >= 1100px：固定侧栏 + 双区工作台。
- 720-1099px：侧栏缩至 208px，结果表可横向滚动。
- < 720px：侧栏折叠为抽屉，工具栏动作保留图标和短标签，编辑器最小高度 220px。
