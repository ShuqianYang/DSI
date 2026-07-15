# 六、总结与建议

## 6.1 关键结论

| 模块 | 状态 | 说明 |
|------|------|------|
| **Skills 系统** | ✅ 已实现 | 基于 `skills/*/SKILL.md`，`LocalSkillManager` 自动扫描，`Skill` 虚拟工具加载 |
| **Agent Loop** | ✅ 已实现 | DeepSeek LLM 驱动，多轮工具调用，上下文压缩，事件驱动 |
| **Harness** | ⚠️ 仅文档 | `api/docs/harness-flow.md` 有设计，代码未实现 |
| **当前 Pipeline** | ✅ 直接 Agent Loop | `api/src/modules/tasks/pipeline.ts` 直接调用 `runAgentLoop` |
| **测试框架** | ✅ 已有 | 原生 Node.js `assert` + `.mjs` 脚本，无 Jest/Vitest |
| **LLM 依赖** | ⚠️ 强依赖 | `DEEPSEEK_API_KEY` 缺失时 `createModelClient()` 会抛错 |

## 6.2 关键文件速查

| 文件 | 职责 |
|------|------|
| `api/src/modules/agent-loop/runAgentLoop.ts` | Agent Loop 主循环 |
| `api/src/modules/agent-loop/skillManager.ts` | Skill 发现、加载、`Skill` 工具注册 |
| `api/src/modules/agent-loop/tools/_shared/toolRegistry.ts` | 工具注册表 |
| `api/src/modules/agent-loop/tools/_shared/toolGateway.ts` | 工具调用网关 |
| `api/src/modules/agent-loop/modelClient.ts` | DeepSeek API 客户端 |
| `api/src/modules/agent-loop/promptManager.ts` | Prompt 组装 |
| `api/src/modules/agent-loop/contextProvider.ts` | 上下文加载 |
| `api/src/modules/agent-loop/contextWindowManager.ts` | 上下文窗口压缩 |
| `api/src/modules/agent-loop/transcriptStore.ts` | Transcript 持久化 |
| `api/src/modules/tasks/pipeline.ts` | 任务 Pipeline 入口 |
| `api/src/modules/tasks/routes.ts` | 任务 REST + SSE 路由 |
| `packages/shared/src/types/agent-loop.ts` | 前后端共享事件类型 |
| `api/docs/harness-flow.md` | Harness 设计文档 |

## 6.3 后续建议

1. **Harness 落地**
   - 如果业务需要“零 LLM 快速响应”或“旧 Pipeline 回退”，需要按 `api/docs/harness-flow.md` 实现 Harness 模块。
   - 实现后注意在 `api/src/modules/tasks/pipeline.ts` 中加入 `AGENT_HARNESS_ENABLED` 开关。

2. **测试框架升级**
   - 当前脚本式测试适合验证核心逻辑，但维护成本会随项目增长而上升。
   - 建议引入 Vitest 并迁移核心模块测试。

3. **文档同步**
   - 如果后续修改了 `AGENTS.md` 中提到的文件/结构/配置/工作流，需要同步更新 `AGENTS.md` 和本 `doc_ysq/` 文档。

4. **LLM 配置检查**
   - 部署前确保环境变量 `DEEPSEEK_API_KEY` 已配置，否则 Agent Loop 无法启动。
