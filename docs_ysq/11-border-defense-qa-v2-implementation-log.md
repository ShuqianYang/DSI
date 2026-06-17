# 实施日志

---

## 记录一：`border-defense-qa` Skill v2 代码-设计文档对齐与验证

> 日期：2026-06-17  
> 基础分支：`local-0617/agent-loop`（`d44501f`）  
> 实施范围：将 v1 Python 脚本型 Skill 迁移为声明式 Skill + 新增 Agent Loop 域工具

### 1.1 背景与目标

v1 方案（`skills_ysq/qa/`）通过 Bash 调用 Python + AgentScope 实现，存在高风险工具依赖、上下文隔离、Python 运行时强依赖、安全审计困难等问题。

v2 目标：

- 改为声明式 `skills/border-defense-qa/SKILL.md`；
- 新增 `MysqlQuerySchema` / `MysqlQuery` 域工具；
- 与 `aircraft-region-query`、`ais-region-query`、`daily-report` 保持统一架构；
- 沉淀可复用的 MySQL 只读查询能力。

### 1.2 设计文档更新

已根据 `skills_ysq/`（v1 Python 实现）和 `new_skill.md` 完善 `docs_ysq/09-border-defense-qa-skill-design-v2.md`：

- 补充 v1 → v2 的明细/时空数据、图表能力对比；
- 明确 `MysqlQuery` 输出为内联 JSON 截断，非写入文件；
- 明确 `MysqlQuerySchema` 内部使用 `information_schema`，但禁止用户传入系统库；
- 新增从 v1 迁移的 prompt 资产清单：
  - 当前日期提示；
  - 时间词统一解释（今天/本周/本月/上周/最近 7 天/24 小时）；
  - “处理”→`handle_xxx` / “处置”→`dispose_xxx` 术语对照；
  - SQL few-shot 示例；
  - 空数据、编码转名称规则。
- 修正 package.json 脚本说明（默认 fake 路径不再错误地标为 `--mock-api`）。

### 1.3 新增与修改文件

#### 新增文件

| 文件 | 说明 |
|------|------|
| `api/src/modules/agent-loop/tools/domain/borderDefenseQa/borderDefenseQa.ts` | `MysqlQuerySchema`、`MysqlQuery` 工具实现 |
| `api/scripts/agent-loop/agent-loop-smoke-border-defense-qa.ts` | smoke helper，含 fake model、mock MySQL、validation |
| `api/tests/agent-loop/test-border-defense-qa-tool.mjs` | 工具注册、schema 校验、安全拦截、fake model、validation 测试 |

#### 修改文件

| 文件 | 修改内容 |
|------|----------|
| `api/src/modules/agent-loop/tools/domain/index.ts` | 注册 `buildMysqlQuerySchemaTool()` 和 `buildMysqlQueryTool()` |
| `skills/border-defense-qa/SKILL.md` | 重写为声明式 Skill，补充自我介绍/无关问题拦截、日期提示、表结构、SQL 规则、few-shot、空数据处理 |
| `api/src/instructions/database-description.md` | 已有 `border-defense` / `xjzhdd_bj` catalog，无需变更 |
| `api/scripts/agent-loop/agent-loop-smoke.ts` | 引入 smoke helper，加入 `knownScenarios`、tool defaults、fake model、mock fetch、validation 分支 |
| `api/package.json` | 添加 `agent:smoke:border-defense-qa`、`agent:smoke:border-defense-qa:real`、`agent:test:border-defense-qa` 脚本 |

### 1.4 关键问题与修复

#### 问题 1：ESM 环境下无法 mock `mysql2/promise`

**现象**：v1 思路是 `require("mysql2/promise")` 后替换 `createConnection`，但在 ESM 中 `import { createConnection } from "mysql2/promise"` 的绑定在模块加载时即已捕获，运行时 `require` 修改 exports 无法生效。导致单元测试和 smoke 都连到真实 MySQL。

**修复**：

1. `borderDefenseQa.ts` 中将数据库配置改为每次调用时重新读取环境变量，避免模块加载时固化；
2. 新增 `setCreateConnectionOverride()` 测试接缝；
3. smoke helper 与单元测试均改用该接缝注入 mock 连接，不再依赖 `require` 修改模块 exports。

#### 问题 2：smoke 测试缺少 PostgreSQL `datasource` 数据库

**现象**：smoke runner 依赖任务表，连接 Postgres 时报 `数据库 "datasource" 不存在`。

**修复**：在本机 Postgres 创建 `datasource` 数据库并执行 `pnpm db:migrate` 完成表结构初始化。

### 1.5 验证结果

```bash
cd api
pnpm tsc --noEmit                 # ✅ 通过
pnpm agent:test:border-defense-qa # ✅ 通过
pnpm agent:smoke:border-defense-qa# ✅ 通过
```

### Smoke 执行路径验证

以查询 “统计本月各级预警数量” 运行 fake model smoke，实际路径：

1. `MysqlQuerySchema` 查询 `alarm_event` 表结构；
2. `MysqlQuery` 执行 `SELECT event_level_name, COUNT(*) ... GROUP BY event_level_name`；
3. Agent 输出最终答案。

验证报告：

```text
[border-defense-qa-smoke] validation passed
[border-defense-qa-smoke] raw tools: MysqlQuerySchema -> MysqlQuery
[border-defense-qa-smoke] schemaCalled=true queryCalled=true finalAnswer=true
```

### 1.6 遗留与待确认事项

- 图表生成、明细/时空数据查询能力 v2 尚未实现，后续可按设计文档新增 `ChartGenerate`、`DetailQuery` 等域工具。
- 真实 MySQL 路径（`pnpm agent:smoke:border-defense-qa:real`）需要目标数据库可达且 `BORDER_DEFENSE_DB_*` 环境变量正确配置，本次未验证。

---

## 记录二：lint 错误修复

> 日期：2026-06-17  
> 触发场景：执行 `pnpm lint` 时发现 6 个 error、15 个 warning

### 2.1 修复内容

| 文件 | 错误/警告 | 修复方式 |
|------|----------|----------|
| `api/src/modules/agent-loop/tools/domain/borderDefenseQa/borderDefenseQa.ts` | warning: `normalized` 已赋值未使用 | 删除该变量 |
| `api/src/modules/agent-loop/tools/system/shell.ts` | error: 4 处 `require("node:path")` 被禁止 | 统一改为文件顶部已导入的 `path` |
| `api/src/modules/ais/ingestion.ts` | error: 局部变量 `module` 触发 `@next/next/no-assign-module-variable` | 重命名为 `repositoryModule` |
| `api/src/modules/opensky/ingestion.ts` | error: 局部变量 `module` 触发 `@next/next/no-assign-module-variable` | 重命名为 `repositoryModule` |

### 2.2 验证结果

```bash
cd api
pnpm lint
# 结果：0 errors，剩余 13 warnings 均为既有代码，不在本次改动范围内
```

### 2.3 剩余 warnings 清单

剩余 warning 来自以下既有文件，未在本次改动中处理：

- `api/src/middleware/errorHandler.ts`
- `api/src/modules/agent-loop/skillManager.ts`
- `api/src/modules/agent-loop/tools/_shared/toolPolicy.ts`
- `api/src/modules/agent-loop/tools/_shared/types.ts`
- `api/src/modules/agent-loop/tools/domain/dailyReport/dailyReport.ts`
- `api/src/modules/agent-loop/tools/domain/satellite/satellite.ts`
- `api/src/modules/agent-loop/tools/domain/sql/_shared.ts`
- `api/src/modules/ais/client.ts`
- `api/src/modules/dashboard/service.ts`
- `api/src/modules/tasks/service.ts`

---

## 参考文档

- `docs_ysq/09-border-defense-qa-skill-design-v2.md`
- `docs_ysq/10-border-defense-qa-test-plan.md`
- `skills/border-defense-qa/SKILL.md`
- `skills_ysq/qa/system_prompt_qa.py`
- `skills_ysq/qa/agent_qa.py`
- `new_skill.md`
