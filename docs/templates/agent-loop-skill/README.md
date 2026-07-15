# Agent Loop Skill 测试模板

新增一个 skill 时，按以下步骤创建文件。模板中的占位符统一使用 `<...>` 格式，例如 `<skill-name>`、`<ToolName>`。

## 文件清单

| 模板 | 目标路径 | 说明 |
|---|---|---|
| `SKILL.md.template` | `skills/<skill-name>/SKILL.md` | Skill 提示词 |
| `tool.ts.template` | `api/src/modules/agent-loop/tools/domain/<skill-name>/<skill-name>.ts` | Tool 实现 |
| `smoke-helper.ts.template` | `api/scripts/agent-loop/agent-loop-smoke-<skill-name>.ts` | Smoke scenario 辅助函数 |
| `tool-test.mjs.template` | `api/tests/agent-loop/test-<skill-name>-tool.mjs` | 单元/集成测试 |

## 替换占位符

| 占位符 | 替换为 |
|---|---|
| `<skill-name>` | skill 目录名，例如 `daily-report` |
| `<ToolName>` | Tool 的 PascalCase 名称，例如 `DailyReport` |
| `<tool-alias>` | Tool 的 kebab_case 别名，例如 `daily-report` |
| `<UPPER_NAME>` | 环境变量前缀，例如 `DAILY_REPORT` |
| `<source-name>` | 数据源标识，例如 `daily-report-api` |

## 接入 agent-loop-smoke.ts

1. 在 `api/scripts/agent-loop/agent-loop-smoke.ts` 中 import scenario 常量：

```ts
import {
  create<ToolName>SmokeModelClient,
  <UPPER_NAME>_QUERY,
  <UPPER_NAME>_SCENARIO,
  <UPPER_NAME>_TOOLS,
  installMock<ToolName>Fetch,
  validate<ToolName>Smoke,
} from "./agent-loop-smoke-<skill-name>.js";
```

2. 在 `parseArgs` 的 `knownScenarios` 中加入 `<UPPER_NAME>_SCENARIO`。
3. 在工具默认选择分支中加入 scenario 对应的 tools。
4. 在 fake model client 选择分支中调用 `create<ToolName>SmokeModelClient()`。
5. 在 mock fetch 选择分支中调用 `installMock<ToolName>Fetch()`。
6. 在验证阶段调用 `validate<ToolName>Smoke()`。

## 添加 package.json 脚本

在 `api/package.json` 的 `scripts` 中加入：

```json
"agent:smoke:<skill-name>": "tsx scripts/agent-loop/agent-loop-smoke.ts --scenario <skill-name> --mock-api",
"agent:smoke:<skill-name>:real": "tsx scripts/agent-loop/agent-loop-smoke.ts --scenario <skill-name>"
```

## 验证

```bash
# 单元/集成测试
npx tsx api/tests/agent-loop/test-<skill-name>-tool.mjs

# Mock 端到端 smoke
pnpm agent:smoke:<skill-name>

# 真实端到端 smoke（依赖外部服务）
pnpm agent:smoke:<skill-name>:real
```

## 参考实现

- `skills/daily-report/SKILL.md`
- `api/src/modules/agent-loop/tools/domain/dailyReport/dailyReport.ts`
- `api/scripts/agent-loop/agent-loop-smoke-daily-report.ts`
- `api/tests/agent-loop/test-daily-report-tool.mjs`
