# 贡献指南

> English readers can start from [README.en.md](./README.en.md)

感谢你关注 WebSSH Gateway 社区版。

## 当前状态

为保障系统稳定性与发布节奏，项目当前阶段 **暂不接受外部代码提交（Pull Request）**。

- 外部 PR 可能会被直接关闭或标记为暂缓处理。
- 欢迎继续通过 Issue 提交问题反馈、使用建议与需求讨论。

## 提交规范（预留）

- 分支命名建议：`feature/*`、`fix/*`、`docs/*`
- Commit 建议采用简洁语义：
  - `feat: ...`
  - `fix: ...`
  - `docs: ...`
  - `refactor: ...`

## Pull Request 要求（恢复开放后生效）

- 保持变更聚焦，避免一次 PR 混入无关内容。
- 提交前自测通过（至少本地可运行）。
- 如涉及行为变更，请补充文档。
- 如涉及接口改动，请说明兼容性影响。

## 开发建议

- 后端代码位于 `backend/`，前端代码位于 `frontend/`。
- 开发与部署步骤见 [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md)。
- 架构信息见 [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)。

## 社区版原则

社区版优先保障可部署、可维护、可扩展。当前欢迎通过 Issue 参与：

- 缺陷修复
- 安全改进
- 文档完善
- 可测试性优化
