# Agent Loop Capability Probe 运行指南

测试脚本位置：`api/tests/agent-loop/test-agent-loop-capability-probe.mjs`

用途：批量运行真实模型调用，验证 agent-loop 在 AIS、航空、灾害三个 domain skill 方向以及不命中 skill 的泛化问题上的表现。

## 前置条件

所有命令默认在 `api/` 目录下执行：

```bash
cd api
```

确保 `api/.env` 已存在且包含以下关键配置：

| 变量 | 说明 |
|---|---|
| `DATABASE_URL` | PostgreSQL 连接串 |
| `DEEPSEEK_API_KEY` | DeepSeek API Key |
| `DEEPSEEK_MODEL` | 可选，默认 `deepseek-v4-flash` |
| `AGENT_WORKSPACE_ROOT` | 仓库根目录 |
| `AGENT_SQL_ALLOWED_SCHEMAS` | 例如 `{"default":["public"]}` |

脚本启动时会自动加载 `api/.env`，不依赖当前 shell 的工作目录。

## 快速开始

```bash
pnpm agent:capability-probe
```

等价于：

```bash
npx tsx tests/agent-loop/test-agent-loop-capability-probe.mjs
```

## 命令参数

| 参数 | 示例 | 说明 |
|---|---|---|
| `--dry-run` | `--dry-run` | 只列出 21 个测试问题，不调用模型/数据库 |
| `--category=<name>` | `--category=ais` | 只跑指定类别：`ais` / `aircraft` / `disaster` / `broad` |
| `--run=<substring>` | `--run=earthquake` | 按测试名称子串匹配，跑单个或若干测试 |
| `--max-turns=<n>` | `--max-turns=8` | 覆盖所有测试的 maxTurns |
| `-h, --help` | `--help` | 显示帮助 |

## 常用示例

```bash
# 1. 先做一次 dry-run，确认环境变量和测试列表
npx tsx tests/agent-loop/test-agent-loop-capability-probe.mjs --dry-run

# 2. 跑全部 21 个测试
npx tsx tests/agent-loop/test-agent-loop-capability-probe.mjs

# 3. 只跑 AIS 方向
npx tsx tests/agent-loop/test-agent-loop-capability-probe.mjs --category=ais

# 4. 只跑航空方向
npx tsx tests/agent-loop/test-agent-loop-capability-probe.mjs --category=aircraft

# 5. 只跑灾害方向（轮次较多，耗时较长）
npx tsx tests/agent-loop/test-agent-loop-capability-probe.mjs --category=disaster

# 6. 只跑不命中 skill 的泛化问题
npx tsx tests/agent-loop/test-agent-loop-capability-probe.mjs --category=broad

# 7. 跑单个测试（按名称子串匹配）
npx tsx tests/agent-loop/test-agent-loop-capability-probe.mjs --run=ais-region-count-and-list

# 8. 给灾害类测试额外增加轮次上限
npx tsx tests/agent-loop/test-agent-loop-capability-probe.mjs --category=disaster --max-turns=12
```

## 测试结果判定

每个测试通过以下基本断言：

- loop 必须正常结束，`stoppedBy === "final_answer"`
- 最终回答非空
- AIS / Aircraft / Disaster 方向必须调用对应的 skill：
  - `ais-region-query`
  - `aircraft-region-query`
  - `disaster-satellite-query`
- Broad 方向**禁止**调用 `Skill`
- `broad-stock-research` 额外要求调用 `WebSearch`

注意：当前断言偏保守，只检查路由和终止状态；回答质量、数据正确性、幻觉等需要人工 review 最终输出。

## 输出说明

控制台会打印每轮 tool 调用、观测结果、最终回答摘要。最后输出一段 JSON report：

```text
REPORT_JSON_START
{
  "generatedAt": "2026-06-15T...",
  "total": 21,
  "passed": 19,
  "failed": 2,
  "results": [ ... ]
}
REPORT_JSON_END
```

每个 result 包含：

- `name` / `category` / `query`
- `durationMs`
- `pass`
- `stoppedBy`
- `turns`
- `tools`（本次调用过的工具列表）
- `skills`（本次调用过的 skill 名称）
- `summary` / `error`
- `finalAnswer`

## 注意事项

- **真实 API 调用**：会消耗 DeepSeek token，灾害/卫星影像类问题轮次多、输出长，费用较高。
- **数据库写入**：每个测试会创建 `tasks` / `taskSteps` 记录，结束后自动清理。
- **耗时**：单个 domain 测试通常几秒到几十秒；灾害卫星链可能分钟级。
- **AIS 数据为空**：已知 `/ais/data` 返回空，AIS 类测试仍可能通过，但最终回答可能显示“无数据”。
- **网络依赖**：Broad 类部分问题依赖 `WebSearch`，需要对应搜索服务可用。
