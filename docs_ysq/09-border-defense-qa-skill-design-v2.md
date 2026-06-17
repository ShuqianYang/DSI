# 九、`border-defense-qa` Skill 设计方案（v2）

## 9.1 背景与目标

v1 方案采用**脚本型 Skill**（Bash 调用 Python），虽然实现快速，但存在以下问题：

- 依赖 `Bash` 工具（风险等级 high）；
- Python 脚本与 Agent Loop 上下文隔离；
- 强依赖 `agentscope==1.0.16` 和 Python 运行时；
- 安全校验在脚本内部，难以统一审计；
- SQL 执行逻辑无法被其他 Skill 复用。

v2 目标是将 `border-defense-qa` 改造为**声明式 Skill + 新增域工具**，与 `aircraft-region-query`、`ais-region-query` 保持一致架构，同时沉淀出可复用的 MySQL 查询能力。

> v2 严格遵循 `CLAUDE.md` 中 **Agent Loop Skill Development** 的规范，并参考 `docs/templates/agent-loop-skill/` 模板。

---

## 9.2 设计决策

| 决策项 | v1 | v2 |
|--------|-----|-----|
| 整体方案 | 脚本型 Skill（Bash + Python） | 声明式 Skill + 新增域工具 |
| 允许工具 | `Read`, `Bash` | `Read`, `MysqlQuerySchema`, `MysqlQuery` |
| SQL 执行 | Python `pymysql` | Node.js `mysql2` 域工具 |
| Agent 框架 | `AgentScope` `ReActAgent` | Agent Loop 统一调度，Skill 内描述工作流 |
| Schema 描述 | 硬编码在 Python Prompt 中 | 静态写入 `SKILL.md` + `database-description.md` |
| 图表生成 | Python `matplotlib`（脚本内） | v2 暂不提供，后续如需可再新增 `ChartGenerate` 域工具 |
| 依赖 Python | 是 | 否 |
| 可复用性 | 低 | 中（`MysqlQuery`/`MysqlQuerySchema` 可被其他 MySQL Skill 复用） |

---

## 9.3 总体架构

```text
用户提问
   │
   ▼
Skill（skills/border-defense-qa/SKILL.md）
   │   ├─ 描述 MySQL 表结构
   │   ├─ 描述调用 MysqlQuerySchema / MysqlQuery 的示例
   │   ├─ 描述 SQL 模板与规则
   │   └─ 描述回答格式
   │
   ▼
Agent Loop 调度新增域工具
   ├─ MysqlQuerySchema  → 查询 MySQL 表结构
   └─ MysqlQuery        → 执行只读 MySQL SQL
   │
   ▼
返回 Markdown 文本回答
```

---

## 9.4 新增域工具

按照 `CLAUDE.md` 规范，域工具统一放在：

```text
api/src/modules/agent-loop/tools/domain/<skill-name>/<skill-name>.ts
```

本 Skill 使用 `borderDefenseQa` 目录（与现有 `dailyReport` 命名风格一致）。

### 9.4.1 `MysqlQuerySchema`

| 属性 | 说明 |
|------|------|
| 名称 | `MysqlQuerySchema` |
| 功能 | 查询 MySQL 数据库的表结构、列信息、注释 |
| 输入 | `database`（连接别名，如 `border-defense`）、`schema`（库名）、`table?`（可选表名） |
| 输出 | JSON 描述的表、列、类型、注释 |
| 实现 | Node.js `mysql2`，封装在 `borderDefenseQa.ts` 中 |
| 安全 | 只读；禁止访问 `information_schema`、`mysql`、`performance_schema` 等系统库 |
| 工具属性 | `kind: "domain"`, `isReadOnly: true`, `isDestructive: false`, `riskLevel: "low"` |

### 9.4.2 `MysqlQuery`

| 属性 | 说明 |
|------|------|
| 名称 | `MysqlQuery` |
| 功能 | 执行只读 MySQL 查询 |
| 输入 | `database`、`sql`、`limit?`、`offset?`、`timeout_ms?` |
| 输出 | JSON 行数据；大数据量时写入 `api/tmp/agent-loop/mysqlquery/*.jsonl` |
| 实现 | Node.js `mysql2`，封装在 `borderDefenseQa.ts` 中 |
| 安全 | 仅允许单条 `SELECT`/`WITH`；正则拦截 DML/DDL；外层自动包 `LIMIT/OFFSET` |
| 工具属性 | `kind: "domain"`, `isReadOnly: true`, `isDestructive: false`, `riskLevel: "medium"` |

### 9.4.3 工具实现文件

```text
api/src/modules/agent-loop/tools/domain/
└── borderDefenseQa/
    └── borderDefenseQa.ts    # 导出 buildMysqlQuerySchemaTool() 和 buildMysqlQueryTool()
```

`borderDefenseQa.ts` 必须包含：

- Zod `inputSchema`，每个字段带 `.describe()`；
- `kind: "domain"`；
- `isReadOnly()` / `isDestructive()` / `isConcurrencySafe()` / `riskLevel`；
- 执行失败时 throw Error，不返回 fake data。

---

## 9.5 文件变更计划

### 新增文件

| 文件 | 内容 |
|------|------|
| `api/src/modules/agent-loop/tools/domain/borderDefenseQa/borderDefenseQa.ts` | `MysqlQuerySchema` 和 `MysqlQuery` 工具实现 |
| `api/scripts/agent-loop/agent-loop-smoke-border-defense-qa.ts` | smoke 场景 helper |
| `api/tests/agent-loop/test-border-defense-qa-tool.mjs` | 工具注册、schema 校验、成功/失败 case |

### 修改文件

| 文件 | 修改内容 |
|------|----------|
| `api/src/modules/agent-loop/tools/domain/index.ts` | 注册 `buildMysqlQuerySchemaTool()` 和 `buildMysqlQueryTool()` |
| `skills/border-defense-qa/SKILL.md` | 重写为声明式 Skill，allowed-tools 改为 `Read, MysqlQuerySchema, MysqlQuery` |
| `api/src/instructions/database-description.md` | 新增 `border-defense` / `xjzhdd_bj` 数据库 catalog |
| `api/scripts/agent-loop/agent-loop-smoke.ts` | 引入 smoke helper，加入 `knownScenarios`、mock fetch、validation 分支 |
| `api/package.json` | 添加 `agent:smoke:border-defense-qa` 和 `agent:smoke:border-defense-qa:real` 脚本 |
| `api/.env` | 确认 `BORDER_DEFENSE_DB_*` 变量已配置 |

### 删除/保留文件

| 文件 | 处理方式 | 原因 |
|------|----------|------|
| `skills/border-defense-qa/scripts/border-defense-qa.py` | v2 验证通过后删除 | 核心逻辑由域工具替代 |
| `skills/border-defense-qa/scripts/prompts.py` | v2 验证通过后删除 | Schema 迁移到 `SKILL.md` 和 `database-description.md` |
| `skills/border-defense-qa/scripts/openai_formatter_thinking.py` | v2 验证通过后删除 | 不再使用 AgentScope |
| `skills/border-defense-qa/output/` | 保留 | 后续如需图表工具，仍可用于保存 PNG |

---

## 9.6 `SKILL.md` 设计

### Frontmatter

```yaml
---
name: border-defense-qa
description: Use when the user asks about border defense data, including alarm events, warning levels, checkpoint access records, devices, personnel/vehicle traffic, patrol records, or statistical analysis of these data.
argument-hint: "[user border defense query in Chinese]"
allowed-tools: Read, MysqlQuerySchema, MysqlQuery
---
```

### 正文结构

1. **适用场景**：明确触发条件；
2. **数据库连接**：使用 `border-defense` 别名，`MysqlQuerySchema`/`MysqlQuery` 会读取 `BORDER_DEFENSE_DB_*` 环境变量；
3. **表结构说明**：
   - 简要列出核心表：`alarm_event`、`buckle_access_record`、`tb_device`、`sys_dept`、`make_rounds_record` 等；
   - 复杂字段关系引导使用 `MysqlQuerySchema` 确认；
4. **工作流**：
   1. 解析用户问题，识别时间范围、区域、实体类型；
   2. 如需要，调用 `MysqlQuerySchema` 确认表结构；
   3. 生成只读 `SELECT` SQL，调用 `MysqlQuery`；
   4. 根据结果总结回答。
5. **SQL 生成规则**：
   - 仅允许 `SELECT`；
   - 时间条件优先使用当前系统日期；
   - 对不确定的字段先用 `MysqlQuerySchema` 确认；
6. **输出格式**：Markdown 文本，包含数据摘要和表格。

---

## 9.7 数据库描述补充

在 `api/src/instructions/database-description.md` 中新增 `border-defense` / `xjzhdd_bj` 章节：

```markdown
## `border-defense` / `xjzhdd_bj`

Border defense operational data. Use `MysqlQuerySchema` to confirm columns before writing `MysqlQuery`.

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `alarm_event` | Warning/alarm events | `alarm_time`, `alarm_level`, `alarm_type`, `alarm_status`, `longitude`, `latitude`, ... |
| `buckle_access_record` | Checkpoint access logs | `pass_time`, `person_name`, `id_card`, `buckle_name`, `direction`, ... |
| `buckle_info` | Checkpoint metadata | `buckle_name`, `longitude`, `latitude`, `dept_id`, ... |
| `tb_device` | Device/sensor inventory | `device_name`, `device_type`, `status`, `dept_id`, `longitude`, `latitude`, ... |
| `sys_dept` | Department hierarchy | `dept_id`, `parent_id`, `dept_name`, ... |
| `make_rounds_record` | Patrol records | `rounds_time`, `user_name`, `dept_id`, `longitude`, `latitude`, ... |
```

---

## 9.8 环境变量

复用 v1 中已配置的变量：

```bash
BORDER_DEFENSE_DB_HOST=127.0.0.1
BORDER_DEFENSE_DB_PORT=3306
BORDER_DEFENSE_DB_USER=root
BORDER_DEFENSE_DB_PASSWORD=root
BORDER_DEFENSE_DB_NAME=xjzhdd_bj
```

`borderDefenseQa.ts` 内部通过 `border-defense` 数据库别名映射到上述环境变量。

---

## 9.9 安全设计

### `MysqlQuery` 安全机制

1. 仅接受单条语句；
2. 正则拦截 `INSERT`、`UPDATE`、`DELETE`、`DROP`、`ALTER`、`CREATE`、`TRUNCATE`、`GRANT`、`REVOKE` 等关键字；
3. 禁止访问系统库；
4. 外层自动包裹 `LIMIT/OFFSET`；
5. 建议使用只读 MySQL 用户。

### `MysqlQuerySchema` 安全机制

1. 仅执行 `SHOW` 和 `DESCRIBE` 类查询；
2. 禁止查询 `information_schema`、`mysql`、`performance_schema`；
3. 返回结果做大小限制。

---

## 9.10 Smoke 测试设计

新增 `api/scripts/agent-loop/agent-loop-smoke-border-defense-qa.ts`，导出：

- `BORDER_DEFENSE_QA_SCENARIO`
- `BORDER_DEFENSE_QA_TOOLS`
- `BORDER_DEFENSE_QA_QUERY`
- `createBorderDefenseQaSmokeModelClient(): ModelClient`
- `installMockBorderDefenseQaFetch(options)`
- `validateBorderDefenseQaSmoke(input)`

参考现有 `agent-loop-smoke-daily-report.ts` 和 `agent-loop-smoke-gis.ts` 实现。

在 `agent-loop-smoke.ts` 中：

1. 引入 helper；
2. 加入 `knownScenarios`；
3. 配置 tool defaults、fake model selection、mock fetch、validation 分支。

---

## 9.11 单元 / 集成测试

新增 `api/tests/agent-loop/test-border-defense-qa-tool.mjs`，覆盖：

1. `MysqlQuerySchema` 和 `MysqlQuery` 在默认 registry 中已注册；
2. 输入 schema 校验（valid / default / invalid）；
3. 成功执行（mock MySQL 连接或本地测试库）；
4. 失败处理（网络错误、SQL 语法错误、DML 被拦截）；
5. Fake model client 的第一次和第二次决策；
6. Smoke validation 函数。

---

## 9.12 package.json 脚本

在 `api/package.json` 中添加：

```json
{
  "scripts": {
    "agent:smoke:border-defense-qa": "tsx scripts/agent-loop/agent-loop-smoke.ts --scenario border-defense-qa --mock-api",
    "agent:smoke:border-defense-qa:real": "tsx scripts/agent-loop/agent-loop-smoke.ts --scenario border-defense-qa"
  }
}
```

---

## 9.13 验证清单

实施完成后，必须运行并确认全部通过：

```bash
cd api
pnpm tsc --noEmit
npx tsx tests/agent-loop/test-border-defense-qa-tool.mjs
pnpm agent:smoke:border-defense-qa
```

如依赖外部 MySQL 服务，再验证真实路径：

```bash
pnpm agent:smoke:border-defense-qa:real
```

---

## 9.14 与 v1 的对比

| 维度 | v1 | v2 |
|------|-----|-----|
| 允许工具 | `Read`, `Bash` | `Read`, `MysqlQuerySchema`, `MysqlQuery` |
| 运行方式 | Bash 调 Python 脚本 | Agent Loop 直接调域工具 |
| Python 依赖 | 必须（agentscope + matplotlib） | 不需要 |
| 安全性 | 脚本级黑名单 | 工具级权限 + 统一安全校验 |
| 可复用性 | 低 | 中（MySQL 工具可被其他 Skill 复用） |
| 与现有 Skill 一致性 | 接近 `csv-profile` | 接近 `aircraft-region-query`、`ais-region-query` |
| 遵循 CLAUDE.md 规范 | 否 | 是 |
| 工程量 | 小 | 中 |

---

## 9.15 风险与应对

| 风险 | 应对措施 |
|------|----------|
| `mysql2` 与项目已有 `pg` 依赖冲突 | 两者都是数据库驱动，作用域不同，无冲突 |
| 大查询结果导致内存溢出 | `MysqlQuery` 设置默认 limit，大数据量转存文件 |
| 表结构变更需同步更新 | 同时更新 `SKILL.md` 和 `database-description.md` |
| 缺少图表能力 | v2 先聚焦文本回答；后续如需图表，再按相同规范新增 `ChartGenerate` 域工具 |

---

## 9.16 待确认事项

实施前需要确认：

1. 工具目录命名是否使用 `borderDefenseQa`（与 `dailyReport` 一致）？
2. `MysqlQuery`/`MysqlQuerySchema` 的环境变量是否继续用 `BORDER_DEFENSE_DB_*`，还是改为更通用的 `AGENT_MYSQL_*`？
3. 是否先保留 v1 脚本文件作为参考，等 v2 验证通过后再删除？
4. 是否需要 v2 同时支持图表，还是文本回答优先？
