# 数据助手部署变更记录

## 未发布 — 2026-10-15

- 引入基于 CopilotKit 1.70.1 的 OpenMuse 源码副本与 Web / 原生数据结果卡。
- 通过服务端语义目录和结构化查询工具接入 RDS SDK，使用 DuckDB 只读连接，保留 SQLGuard。
- 读取工作台发布的共享 SQLite metadata，每次请求释放连接；数据源缺失或未发布时明确报错。
- 提供锁定依赖、私有配置生成、服务启停、集成测试、真实数据验证脚本和完整部署说明。
- 首版使用服务间 bearer token 与 OpenMuse session；业务 ACL 待完善。真实模型和 Intelligence 的完整聊天验收待配置密钥。
