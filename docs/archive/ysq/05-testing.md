# 五、测试框架

## 5.1 测试方式

项目**没有使用 Jest/Vitest** 等单元测试框架，而是采用 **Node.js 原生 `assert` + `.mjs` 脚本** 进行测试验证。

## 5.2 API 层测试脚本

位于 `api/tests/agent-loop/`：

```
api/tests/agent-loop/
├── test-agent-loop-smoke-gis-helpers.mjs
├── test-agent-loop-sse-mode.mjs
├── test-agent-loop-result-projection.mjs
├── test-prompt-manager.mjs
├── test-prompt-manager-gis-routing.mjs
├── test-context-window-manager.mjs
├── test-context-provider.mjs
├── test-transcript-store.mjs
└── ...
```

## 5.3 根目录验证脚本

位于 `scripts/`：

```
scripts/
├── test-agent-loop-events.mjs
├── test-agent-loop-shared-contract.mjs
├── test-agent-loop-gis-link.mjs
├── test-agent-loop-step-formatter.mjs
├── test-agent-loop-task-view.mjs
└── test-info-center-agent-loop.mjs
```

## 5.4 package.json 脚本

`api/package.json` 中定义的相关脚本：

```json
{
  "scripts": {
    "agent:smoke": "tsx scripts/agent-loop-smoke.ts",
    "agent:edge": "tsx scripts/agent-loop-edge-cases.ts",
    "agent:skills": "tsx scripts/agent-loop-skill-tests.ts",
    "agent:domain-tools": "tsx scripts/agent-loop-domain-tool-tests.ts"
  }
}
```

## 5.5 测试运行方式

```bash
# 进入 api 目录
cd api

# 运行冒烟测试
pnpm agent:smoke

# 运行边界测试
pnpm agent:edge

# 运行 Skill 测试
pnpm agent:skills

# 运行领域工具测试
pnpm agent:domain-tools
```

也可以直接运行单个 `.mjs` 脚本：

```bash
node api/tests/agent-loop/test-prompt-manager.mjs
```

## 5.6 测试覆盖范围

当前测试主要覆盖：

- Agent Loop 核心逻辑
- Prompt Manager 的 Prompt 组装
- 上下文窗口管理
- Context Provider 上下文加载
- Transcript Store 持久化
- SSE 事件模式
- GIS 路由与联动
- Skill 执行
- 领域工具调用

## 5.7 后续改进建议

如果项目规模扩大，建议考虑引入：

- **Vitest** 或 **Jest** 作为正式单元测试框架
- **测试覆盖率报告**（如 `v8` 或 `istanbul`）
- **CI 集成**（GitHub Actions / GitLab CI）自动运行测试
- **端到端测试**（如 Playwright）验证前端与 Agent Loop 的联动
