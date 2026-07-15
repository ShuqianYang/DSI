# 智能体项目文档（ysq 归档）

本文档整理了本仓库 `projects_new` 项目的代码逻辑、架构设计、Skills 机制以及 Harness 现状。原位于 `docs_ysq/`，现已归档至 `docs/archive/ysq/`。

## 文档目录

| 文件 | 说明 |
|------|------|
| [01-architecture.md](./01-architecture.md) | 项目整体架构与技术栈 |
| [02-skills.md](./02-skills.md) | Skills 机制：定义、发现、注册与调用 |
| [03-agent-loop.md](./03-agent-loop.md) | Agent Loop 执行流程与调用链路 |
| [04-harness.md](./04-harness.md) | Harness 设计文档与当前实现状态 |
| [05-testing.md](./05-testing.md) | 测试框架与验证脚本 |
| [06-summary.md](./06-summary.md) | 关键结论与后续建议 |

## 快速定位

- Agent Loop 主入口：`api/src/modules/agent-loop/runAgentLoop.ts`
- 任务 Pipeline 入口：`api/src/modules/tasks/pipeline.ts`
- Skill 管理器：`api/src/modules/agent-loop/skillManager.ts`
- 工具注册表：`api/src/modules/agent-loop/tools/_shared/toolRegistry.ts`
- Harness 设计文档：`api/docs/harness-flow.md`
