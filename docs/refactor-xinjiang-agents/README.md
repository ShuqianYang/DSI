# 新疆智能体重构方案：迁移至本项目 Skill + Domain Tool 架构

> 来源目录：`D:\0 ysq文件\20260613_新疆智能体\app`
> 目标目录：本项目的 `skills/` + `api/src/modules/agent-loop/tools/domain/`
> 方案状态：草案，待确认关键问题后细化

---

## 1. 目标

将原有项目中的两个核心智能体：

| 原目录 | 原入口 | 功能 |
|--------|--------|------|
| `qa/` | `agent_qa.py` | 边防数据智能问答（SQL 查询、统计分析、图表生成） |
| `daily/` | `daily_report_agent.py` | 日报生成（SQL 聚合、图表生成、报告撰写） |

重构为符合本项目的 **Skill + Domain Tool** 架构：

- **Skill**：仅保留提示词/路由说明，放在 `skills/<skill-name>/SKILL.md`
- **Domain Tool**：实际执行逻辑，放在 `api/src/modules/agent-loop/tools/domain/<tool-name>/<tool-name>.ts`
- 统一通过 `agent-loop` 的 `ToolDefinition` 注册、调度、权限控制

---

## 2. 现状分析

### 2.1 原项目架构

```text
app/
├── app.py                      # FastAPI 入口，提供 /daily-report、/intelligent-qa 等接口
├── config.py                   # 模型、MySQL、文件目录配置
├── qa/
│   ├── agent_qa.py             # ReActAgent + Toolkit（SQL、matplotlib 图表、记忆）
│   ├── system_prompt_qa.py     # 超大系统提示词（表结构、SQL 规则、示例）
│   └── system_prompt_qa_new.py # 新版提示词
├── daily/
│   ├── daily_report_agent.py   # ReActAgent + 预定义 SQL 模板 + 子绘图 Agent
│   ├── daily_report_sql.py     # all / buckle / event 三套 SQL 模板
│   └── daily_report_system_prompt.py
└── utils/                      # 流式输出、模型格式化、绘图子 Agent、session 记忆等
```

**原项目技术栈**：`agentscope + fastapi + pymysql + matplotlib/seaborn + apscheduler`

**原项目能力要点**：

- QA：
  - 自然语言 → SQL → MySQL 查询 → Markdown 回答
  - 支持图表生成（柱状图、折线图、饼图、热力图）
  - 自我介绍拦截、无关问题拦截
  - 当前时间感知、多轮 session 记忆（Redis）
  - 明细查询、数据可视化
- Daily Report：
  - 按日期 + 报告类型（`all/buckle/event`）执行预定义 SQL
  - 生成柱状图/饼图
  - LLM 根据数据和图片生成 Markdown 日报
  - 同步/流式两种输出模式

### 2.2 本项目架构

```text
skills/                         # Skill 提示词目录
├── daily-report/SKILL.md       # 日报 Skill 路由说明
├── border-defense-qa/SKILL.md  # 边防问答 Skill 路由说明
└── ...

api/src/modules/agent-loop/
├── tools/domain/
│   ├── borderDefenseQa/borderDefenseQa.ts   # MysqlQuery / MysqlQuerySchema
│   ├── dailyReport/dailyReport.ts           # DailyReport domain tool
│   └── index.ts                             # 注册所有 domain tools
├── skillManager.ts             # 加载 skills/ 下的 SKILL.md
├── promptManager.ts            # 系统提示词 + 路由规则
└── runAgentLoop.ts             # Agent 循环调度
```

**本项目技术栈**：`Next.js 16 + React 19 + TypeScript 5 + Zod + mysql2 + 自定义 agent loop`

**已有能力要点**：

- `MysqlQuery` / `MysqlQuerySchema`：只读 MySQL 查询，已配置 `border-defense` 别名
- `DailyReport`：调用外部日报服务 `DAILY_REPORT_API_URL`
- Skill 通过 frontmatter 声明 `allowed-tools`，正文描述路由规则
- promptManager 已内置 `DailyReport Routing Rules` 和 `Database Timezone Rule`

### 2.3 关键发现

| 维度 | 原项目 | 本项目 | 差异 |
|------|--------|--------|------|
| 实现语言 | Python | TypeScript | 需要重写或桥接 |
| Agent 框架 | agentscope ReActAgent | 自定义 agent loop | 执行模型相同，调度方式不同 |
| 数据库 | MySQL (`xjzhdd_bj` / `xjzhdd`) | MySQL (`border-defense` 别名) | 数据库结构一致，别名已存在 |
| SQL 生成 | Agent 自动生成 + 少量模板 | Agent 自动生成 | 原项目有详细 prompt 和示例可迁移 |
| 图表生成 | matplotlib 本地生成 | 暂无 | 需要新增或外部化 |
| 日报 | 本地 SQL + LLM | 调用外部 API | 本项目当前是代理模式 |
| Session 记忆 | Redis | 未明确 | 需要确认是否需要 |
| 流式输出 | SSE | 已有 agent loop 事件流 | 可复用 |

**重要观察**：

- 本项目的 `border-defense-qa` 和 `daily-report` Skill 已经存在，且与原项目意图高度重合。
- 因此本次重构的重点不是“新建两个 Skill”，而是**如何把原项目更丰富的业务逻辑（图表、SQL 模板、拦截规则、记忆）合并/下沉到本项目中**。

---

## 3. 架构映射

### 3.1 QA 智能体映射

| 原项目组件 | 本项目对应位置 | 说明 |
|------------|----------------|------|
| `qa/agent_qa.py` 中的 ReActAgent | 无需单独 Agent，由 `agent-loop` 统一调度 | 原 ReAct 行为由模型 + Skill 提示词替代 |
| `qa/agent_qa.py` 中的 SQL 执行工具 | `api/src/modules/agent-loop/tools/domain/borderDefenseQa/borderDefenseQa.ts` 的 `MysqlQuery` | 已存在，可直接使用 |
| `qa/agent_qa.py` 中的图表工具 | 新增 `ChartGenerate` domain tool | 需要新增，见 4.2 |
| `qa/system_prompt_qa*.py` | `skills/border-defense-qa/SKILL.md` + `promptManager.ts` 路由规则 | 将表结构、示例、SQL 规则迁移到 Skill 正文和系统提示词 |
| 自我介绍/无关问题拦截函数 | `skills/border-defense-qa/SKILL.md` 的 `Special responses` 部分 | 已存在类似规则，可扩展 |
| `utils/session_memory.py` Redis 记忆 | 复用 `api/src/modules/agent-loop/memoryManager.ts` / `sessionSummaryMemoryManager.ts` | 需要确认是否启用 |

### 3.2 Daily Report 智能体映射

| 原项目组件 | 本项目对应位置 | 说明 |
|------------|----------------|------|
| `daily/daily_report_agent.py` | 替换或增强 `api/src/modules/agent-loop/tools/domain/dailyReport/dailyReport.ts` | 当前为外部 API 代理，建议内嵌 |
| `daily/daily_report_sql.py` | 迁移到 `dailyReport.ts` 中的 SQL 模板或新的 SQL 模板文件 | 替换外部 API 调用 |
| `daily/daily_report_system_prompt.py` | `skills/daily-report/SKILL.md` + `promptManager.ts` | 迁移最终输出格式要求 |
| `utils/draw_plot_subagent.py` 子绘图 Agent | 简化为 `ChartGenerate` domain tool 或直接本地图表库 | 避免子 Agent 循环，减少延迟 |
| `/daily-report` FastAPI 路由 | 复用本项目的 `/api/chat` 或新增 `/api/daily-report` | 需要确认入口 |

---

## 4. 重构方案（推荐：分阶段）

### 方案 A：桥接模式（第一阶段，快速可用）

保持原 Python 服务独立运行，在本项目新增两个 domain tool：

- `XinjiangQaBridge`：接收自然语言问题，转发到原 `/intelligent-qa` 接口，返回结果
- `XinjiangDailyReportBridge`：接收日期和报告类型，转发到原 `/daily-report` 接口，返回报告

**优点**：
- 改动最小，快速验证
- 保留原项目所有能力（图表、记忆、复杂 prompt）
- 不需要重写 Python 逻辑

**缺点**：
- 仍是双系统维护
- 无法享受本项目的统一权限、并发、记忆、上下文管理
- 流式输出需要额外适配

### 方案 B：完全内嵌（第二阶段，长期目标）

将原项目的业务逻辑逐步迁移到本项目的 domain tool 和 Skill 中：

1. **QA 内嵌**：
   - 复用现有 `MysqlQuery` + `MysqlQuerySchema`
   - 新增 `ChartGenerate` domain tool（本地生成图表）
   - 扩充 `skills/border-defense-qa/SKILL.md` 中的表结构、SQL 规则、示例
   - 将自我介绍/无关问题拦截规则写入 Skill
   - 可选：接入 `sessionSummaryMemoryManager` 实现多轮记忆

2. **Daily Report 内嵌**：
   - 改造 `DailyReport` domain tool：从“调用外部 API”改为“本地执行 SQL 模板 + LLM 生成报告”
   - 将 `daily_report_sql.py` 中的 `all/buckle/event` SQL 迁移为 TypeScript 模板
   - 调用 `ChartGenerate` 生成饼图/柱状图
   - 复用模型客户端生成最终 Markdown 报告

**优点**：
- 单系统、统一架构
- 完全受 `ToolDefinition` 权限、只读约束、并发控制
- 可复用本项目的流式输出、记忆、上下文窗口管理

**缺点**：
- 工作量大
- 需要把 Python SQL 模板和 matplotlib 图表逻辑重写为 TypeScript
- 需要完整测试数据一致性

### 推荐方案

**采用“先桥接、后内嵌”的两阶段策略**：

1. **Phase 1（1-2 天）**：桥接，让本项目的 Skill 能快速调用原有能力，验证用户体验
2. **Phase 2（1-2 周）**：内嵌，把 SQL 模板、图表生成、报告生成逐步迁移到本项目中，最终下线原 Python 服务

这样可以在不中断现有能力的前提下完成架构迁移。

---

## 5. 详细设计

### 5.1 Skill 文件设计

#### 5.1.1 QA Skill（复用/增强 `skills/border-defense-qa/SKILL.md`）

需要补充原项目中更详细的：

- 当前时间推断规则（已部分存在，需统一）
- 自我介绍/无关问题关键词拦截（已部分存在，需统一）
- 数据可视化流程：何时调用 `ChartGenerate`
- 明细查询规则
- 更完整的 SQL 示例（从 `system_prompt_qa.py` 中挑选高频示例）

#### 5.1.2 Daily Report Skill（复用/增强 `skills/daily-report/SKILL.md`）

需要补充：

- 报告类型映射：`all` → 总体，`buckle` → 设备监控/卡口，`event` → 预警事态
- 日期解析规则（今天/昨天/前天/具体日期）
- 当用户要求“详细告警”时，应路由到 `MysqlQuery` 而非 `DailyReport`
- 输出格式要求（从 `daily_report_system_prompt.py` 迁移）

### 5.2 Domain Tool 设计

#### 5.2.1 复用：`MysqlQuery` / `MysqlQuerySchema`

已存在，直接使用。需要确认：

- 原项目数据库名是 `xjzhdd_bj` 或 `xjzhdd`，本项目 `border-defense` 别名目前指向 `xjzhdd_bj`，是否需要调整？
- 是否需要增加表级 schema 发现能力（当前已支持 `table` 参数）

#### 5.2.2 新增：`ChartGenerate`

建议新增一个 domain tool，用于根据 CSV/JSON 数据生成图表：

```text
name: ChartGenerate
kind: domain
input:
  - type: bar | line | pie | heatmap
  - data: JSON array or CSV string
  - x_col / y_col / labels_col / values_col
  - title, xlabel, ylabel
  - output_format: png | base64 | url
output:
  - image_url: /agent-loop/charts/<filename>.png
  - image_base64?: string
```

实现方式二选一：

- **A. 本地 Node.js 图表库**：使用 `@observablehq/plot` / `chartjs-node-canvas` / `quickchart-js` 在 `api/` 中生成图片
- **B. 调用外部 Python 图表服务**：保留原 Python 的 matplotlib 能力，作为独立微服务

推荐 **A**，因为更符合本项目技术栈；如果图片效果要求极高，可选 **B** 作为过渡。

#### 5.2.3 改造：`DailyReport`

有两种实现路径：

- **路径 1（桥接）**：保持当前实现，仅调整输入输出格式
- **路径 2（内嵌）**：重写为本地 SQL + ChartGenerate + LLM

内嵌版伪代码：

```ts
async execute(input, context) {
  const date = extractDate(input.query);
  const reportType = normalizeReportType(input.report_type);

  // 1. 执行对应 SQL 模板
  const sql = buildDailyReportSql(reportType, date);
  const queryResult = await runMysqlQuery(sql);

  // 2. 生成图表
  const charts = await generateCharts(reportType, queryResult);

  // 3. 调用模型生成 Markdown 报告
  const reportContent = await generateReportWithModel(queryResult, charts, reportType);

  return { date, report_type: reportType, report_content: reportContent, charts };
}
```

### 5.3 数据库访问

原项目直接使用 `pymysql` 连接 MySQL。本项目已有 `mysql2/promise`，可直接复用。

需要新增/确认的环境变量：

```bash
# 已存在
BORDER_DEFENSE_DB_HOST
BORDER_DEFENSE_DB_PORT
BORDER_DEFENSE_DB_USER
BORDER_DEFENSE_DB_PASSWORD
BORDER_DEFENSE_DB_NAME

# 新增（可选）
CHART_OUTPUT_DIR=./api/tmp/agent-loop/charts
DAILY_REPORT_SQL_TIMEOUT_MS=30000
```

### 5.4 文件输出与清理

原项目有 `OUTPUT_DIR`、`FIGURE_DIR`、`REPORT_DIR` 和定时清理任务。

本项目建议：

- 图表输出到 `api/tmp/agent-loop/charts/`
- 报告输出到 `api/tmp/agent-loop/daily-reports/`
- 清理逻辑复用或新增一个 Node.js 定时任务（避免依赖 Python 的 `apscheduler`）

### 5.5 API 入口

原项目入口是 FastAPI 的 `/daily-report` 和 `/intelligent-qa`。

本项目建议：

- 如果已有 `/api/chat` 可以满足，则直接复用
- 如果需要独立接口，可在 `api/src/app/` 中新增：
  - `POST /api/agent/daily-report`
  - `POST /api/agent/intelligent-qa`
- 如果采用桥接方案，这些接口内部调用原 Python 服务

---

## 6. 实施计划

### Phase 1：桥接验证（1-2 天）

| 步骤 | 内容 | 产出 |
|------|------|------|
| 1 | 确认原 Python 服务启动方式和接口地址 | 环境就绪 |
| 2 | 新增 `XinjiangQaBridge` domain tool + Skill 增强 | `skills/border-defense-qa/SKILL.md` 更新 |
| 3 | 新增 `XinjiangDailyReportBridge` domain tool + Skill 增强 | `skills/daily-report/SKILL.md` 更新 |
| 4 | 注册 domain tools 到 `tools/domain/index.ts` | 可调用 |
| 5 | 编写 smoke test | 验证端到端 |

### Phase 2：内嵌迁移（1-2 周）

| 步骤 | 内容 | 产出 |
|------|------|------|
| 1 | 迁移 `daily_report_sql.py` 三套 SQL 到 TypeScript | `dailyReportSqlTemplates.ts` |
| 2 | 新增 `ChartGenerate` domain tool（本地或外部） | `tools/domain/chartGenerate/chartGenerate.ts` |
| 3 | 改造 `DailyReport` 为本地执行 | `dailyReport.ts` 内嵌版 |
| 4 | 扩充 `border-defense-qa` Skill 提示词和规则 | 更完整的 `SKILL.md` |
| 5 | 迁移自我介绍/无关问题拦截到 Skill | 特殊回复规则 |
| 6 | 可选：接入 session 记忆 | memory 配置 |
| 7 | 下线桥接 tool，清理代码 | 最终版 |

---

## 7. 需要确认的问题

在继续实施之前，请你确认以下问题，这将直接影响方案细节和工作量：

### 7.1 范围与目标

1. **最终目标是什么？**
   - A. 只要本项目能通过 Skill 调用原有智能体即可（桥接）
   - B. 彻底把原有 Python 逻辑迁移到本项目，最终下线原服务（完全内嵌）
   - C. 先桥接验证，再逐步内嵌（推荐）

2. **是否需要保留原有 FastAPI 服务独立运行？**
   - 是（桥接必需）
   - 否（完全内嵌后不需要）

### 7.2 数据库

3. **原项目连接的 MySQL 数据库名是 `xjzhdd`（智算网）还是 `xjzhdd_bj`（本机）？**
   - 本项目当前 `border-defense` 别名默认指向 `xjzhdd_bj`，是否需要改为 `xjzhdd`？

4. **数据库表结构是否与原项目 `system_prompt_qa.py` 中描述的一致？**
   - 原项目提示词中有 `bjzhdd_XJ` / `xjzhdd_bj` 两套结构，需要确认当前实际表结构

### 7.3 图表生成

5. **日报和 QA 中的图表（柱状图、饼图、折线图等）是否必须保留？**
   - 必须保留
   - 可以先用文字表格替代，后续再补

6. **如果保留图表，倾向于哪种实现？**
   - A. 在 Node.js 中用图表库本地生成（推荐长期）
   - B. 保留原 Python matplotlib 服务，通过 HTTP 调用（过渡方案）

### 7.4 日报

7. **本项目的 `DailyReport` domain tool 当前调用外部 API `http://192.168.0.27:18820/daily-report`，这个地址是否就是原 Python 服务？**
   - 如果是，桥接方案已经部分存在，只需调整输入参数
   - 如果不是，需要确认日报服务部署位置

8. **日报的报告类型映射是否与原项目一致？**
   - 原项目：`all / buckle / event`
   - 本项目当前：`all / 总体 / 设备监控 / 预警事态`
   - 是否需要统一为原项目的 `all / buckle / event`？

### 7.5 记忆与交互

9. **QA 的多轮 session 记忆（Redis）是否需要迁移？**
   - 需要
   - 不需要，单轮即可

10. **是否需要保留同步接口（供 Dify 等外部系统调用）？**
    - 需要
    - 不需要，只保留流式接口

### 7.6 其他

11. **原项目中 `custom/` 目录的自定义报告智能体是否也需要迁移？**
    - 需要
    - 不需要，本次只处理 qa 和 daily

12. **是否有权限要求？例如某些 SQL 查询只能查特定部门数据？**
    - 有，需要按部门过滤
    - 没有，只读全量即可

---

## 8. 下一步行动

1. 请你确认上述 12 个问题（可以直接回复选项字母或文字）。
2. 根据你的确认，我会细化出具体的实施步骤、文件变更清单和代码示例。
3. 然后按 Phase 1 或 Phase 2 开始实际编码。

---

## 9. 用户确认与 Python 后端落地方案

### 9.1 用户确认结果

| 问题 | 用户答复 |
|------|----------|
| 最终目标 | **B. 彻底迁移，下线原 agentscope 实现** |
| 数据库 | 无需调整，继续使用当前配置 |
| 图表 | **保留，但用 ECharts 替代 matplotlib** |
| 日报 | 改为本地 SQL + LLM 生成，不走外部 API |
| 多轮记忆 | **保留 Redis Session 记忆** |
| 技术栈 | **保留 Python 后端 + 原有前端**，参考本项目 skill/tool 架构 |

### 9.2 关键调整说明

用户明确希望：

1. **不强制使用本项目的 TypeScript 技术栈**，而是用 Python 后端实现同样的架构思想。
2. **原有前端保持不变**，后端只提供 API 接口。
3. **ECharts 替代 matplotlib**，图表渲染更美观，且更适合 Web 前端直接展示。
4. **日报完全本地化**：不再调用外部日报服务，而是在后端执行 SQL 模板 + LLM 生成报告。
5. **保留 Redis 多轮 Session 记忆**。

因此，最终方案从“把 Python 逻辑迁移到本项目的 TypeScript domain tool”调整为：

> **在原项目（或本项目内新建的 Python 后端目录）中，用 Python 重写 qa 和 daily 智能体，使其架构对齐本项目的 `Skill + Domain Tool` 模式，但保持 Python 技术栈和原有前端。**

---

### 9.3 Python 后端 Skill + Domain Tool 架构设计

本项目的核心架构思想是：

```text
Skill（提示词/路由说明）
  └── 声明 allowed-tools、输入要求、工作流、特殊回复规则

Domain Tool（可执行单元）
  └── 实现 name / inputSchema / execute / 权限声明

Agent Loop
  └── 加载 Skill → 模型选择 Tool → 执行 Tool → 返回 Observation → 模型生成最终回答
```

在 Python 后端中，我们可以用以下结构复刻这一架构：

```text
app/  或  xinjiang-agent-python/
├── skills/
│   ├── border_defense_qa/
│   │   └── SKILL.md          # 边防问答 Skill（提示词、规则、示例）
│   └── daily_report/
│       └── SKILL.md          # 日报 Skill（日期解析、报告类型、输出格式）
├── tools/
│   ├── __init__.py
│   ├── registry.py           # ToolRegistry：注册、查找、调度 tool
│   ├── gateway.py            # ToolGateway：schema 校验、权限检查、执行、结果截断
│   ├── base.py               # ToolDefinition 基类/协议
│   ├── mysql_query.py        # MysqlQuery / MysqlQuerySchema
│   ├── chart_generate.py     # ChartGenerate（生成 ECharts option，由前端渲染）
│   └── daily_report.py       # DailyReport（本地 SQL + LLM）
├── agents/
│   ├── __init__.py
│   ├── loop.py               # Agent Loop：消息 → 模型决策 → tool 调用 → 总结
│   ├── prompt_manager.py     # 系统提示词 + Skill 列表 + 路由规则
│   ├── skill_manager.py      # 加载 skills/ 下的 SKILL.md
│   ├── memory_manager.py     # Redis 多轮 Session 记忆
│   └── model_client.py       # LLM 调用封装（OpenAI 兼容接口）
├── sql/
│   └── daily_report/         # 日报 SQL 模板（all / buckle / event）
├── config.py                 # 模型、DB、Redis、目录配置
├── app.py                    # FastAPI 入口（复用原项目接口，但内部走新架构）
└── utils/
    ├── date_parser.py        # 自然语言日期解析
    ├── echarts_builder.py    # ECharts option 生成器
    └── response_formatter.py # 结果格式化、空值处理
```

### 9.4 与原项目的关键变化

| 原项目 | 重构后 |
|--------|--------|
| `agentscope.ReActAgent` + `Toolkit` | 自定义 `AgentLoop` + `ToolRegistry` |
| 工具函数散落在 `agent_qa.py` 中 | 工具拆分为独立 `ToolDefinition`，统一注册到 `tools/registry.py` |
| 系统提示词是巨型 Python 字符串 | 拆分为 `skills/<name>/SKILL.md` 文件，frontmatter + 正文 |
| `matplotlib` 本地生成 PNG | `ChartGenerate` 返回 **ECharts option JSON**，由前端渲染 |
| 日报调用子绘图 Agent | 日报 Tool 内部直接生成 ECharts option，无子 Agent |
| 日报调用外部 API | 日报 Tool 本地执行 SQL + LLM |
| Redis session 记忆在 `utils/session_memory.py` | 由 `agents/memory_manager.py` 统一封装，按 session_id 读写 |

### 9.5 Skill 设计（Python 版）

Python 后端的 `SKILL.md` 格式可以直接参考本项目：

```markdown
---
name: border-defense-qa
description: 回答边防数据相关的自然语言问题
argument-hint: "[用户查询，例如：最近一周一级预警有多少？]"
allowed-tools: MysqlQuerySchema, MysqlQuery, ChartGenerate
---

# Border Defense QA

用于回答关于预警事件、卡口通行、设备、部门、巡逻考勤等数据的问题。

## Required Input

传递用户原始问题作为 `$ARGUMENTS`。

## Workflow

1. 解析问题中的实体、时间范围、聚合意图。
2. 不确定字段时，先调用 `MysqlQuerySchema`。
3. 生成只读 SELECT SQL，调用 `MysqlQuery`。
4. 如用户要求可视化，调用 `ChartGenerate` 生成 ECharts option。
5. 用 Markdown 总结结果。

## Special responses

### 自我介绍

如果用户问“你是谁/你能做什么”，直接回复：
...

### 无关问题

如果问题与边防数据无关（天气、新闻、股票、编程等），直接回复：
...
```

Skill 加载器解析 frontmatter，正文作为系统提示词的一部分注入到模型上下文。

### 9.6 Domain Tool 设计（Python 版）

每个 tool 是一个 Python 类或 dataclass，字段与本项目 `ToolDefinition` 对齐：

```python
from dataclasses import dataclass
from typing import Callable, Any

@dataclass
class ToolDefinition:
    name: str
    description: str
    input_schema: dict          # JSON Schema
    execute: Callable[..., Any]
    aliases: list[str] = None
    is_read_only: bool = True
    is_destructive: bool = False
    is_concurrency_safe: bool = True
    risk_level: str = "low"     # low / medium / high
    max_result_size_chars: int = 80000
```

#### 9.6.1 `MysqlQuery` / `MysqlQuerySchema`

直接复用本项目的设计：

- `MysqlQuerySchema`：查询 `information_schema.columns`，返回表/列信息
- `MysqlQuery`：执行单条 SELECT/WITH，限制返回行数，禁止 DML/DDL
- 数据库别名 `border-defense`，配置复用 `config.py`

#### 9.6.2 `ChartGenerate`（ECharts 版）

不生成 PNG，而是生成 **ECharts option**，由前端直接渲染：

```python
{
  "type": "echarts",
  "option": {
    "title": {"text": "预警等级占比"},
    "xAxis": {"type": "category", "data": [...]},
    "yAxis": {"type": "value"},
    "series": [{"type": "bar", "data": [...]}]
  }
}
```

后端提供 `echarts_builder.py`，根据查询结果和图表类型生成 option。前端收到后直接用 `echarts.init()` 渲染。

#### 9.6.3 `DailyReport`

内嵌版日报 Tool：

```python
async def execute(input):
    date = parse_date(input["query"])          # 今天/昨天/2025-11-10
    report_type = input.get("report_type", "all")

    sql = load_daily_report_sql(report_type, date)
    data = await mysql_query(sql)

    charts = []
    if report_type in ("all", "event"):
        charts.append(build_pie_chart(data, "预警等级占比"))
    if report_type in ("all", "buckle"):
        charts.append(build_bar_chart(data, "卡口繁忙度Top5"))

    report_content = await llm_generate_report(data, charts, report_type)
    return {
        "date": date,
        "report_type": report_type,
        "report_content": report_content,
        "charts": charts,
    }
```

### 9.7 Agent Loop 设计（Python 版）

核心流程与本项目一致：

```text
1. 接收用户 query + session_id
2. SkillManager 加载可用 Skills，生成系统提示词
3. MemoryManager 读取历史消息
4. ModelClient 决定：
   - final_answer（直接回答，如自我介绍/无关问题）
   - tool_calls（调用 tool）
5. ToolGateway 执行 tool，返回 observation
6. 循环直到模型输出 final_answer
7. MemoryManager 保存本轮对话
8. 返回前端（流式 SSE 或同步 JSON）
```

### 9.8 FastAPI 接口

复用原项目接口，保持前端不变：

```python
@app.post("/intelligent-qa")
async def intelligent_qa(request: ReportRequest):
    # 内部调用 AgentLoop，传入 qa skill
    ...

@app.post("/daily-report")
async def daily_report(request: DailyReportRequest):
    # 内部调用 AgentLoop，传入 daily-report skill
    ...
```

### 9.9 依赖调整

可以移除：

- `agentscope`（自定义 loop 替代 ReActAgent）
- `matplotlib`、`seaborn`（由 ECharts 前端渲染替代）
- `pypandoc-binary`（如不再用）

保留：

- `fastapi`、`uvicorn`
- `pymysql`、`redis`
- `openai`（或兼容的 LLM SDK）
- `pandas`（数据处理）
- `apscheduler`（文件清理定时任务）

新增：

- `pydantic`（如未使用）
- `pyyaml` / `python-frontmatter`（解析 SKILL.md frontmatter）
- `jsonschema`（校验 tool input）

---

## 10. 落地方案选择（需要你最后确认）

基于以上设计，还有两个实施位置需要你来定：

### 方案 A：在原项目目录重构（推荐）

直接在 `D:\0 ysq文件\20260613_新疆智能体\app` 中改造：

- 优点：不破坏原有项目结构，原有前端配置不用改
- 缺点：本项目只保留方案文档，代码不在本项目中

### 方案 B：在本项目新建 Python 后端目录

在 `D:/0 ysq文件/DSI-agent-loop` 下新建例如 `api-python/` 或 `xinjiang-agent/`：

- 优点：方案、前端、后端都在一个仓库，便于统一版本管理
- 缺点：本项目现有 `api/` 是 TypeScript，新增 Python 目录会造成双后端并存，需要明确职责边界

**请确认选择 A 还是 B？**

---

## 11. 下一步行动

1. 确认落地方案（A 在原项目重构 / B 在本项目新建 Python 目录）。
2. 确认后，我会立即输出详细目录结构和第一批代码骨架：
   - `tools/registry.py` + `tools/base.py`
   - `skills/border-defense-qa/SKILL.md`
   - `skills/daily-report/SKILL.md`
   - `tools/mysql_query.py`
   - `tools/chart_generate.py`（ECharts 版）
   - `tools/daily_report.py`（本地 SQL + LLM）
   - `agents/loop.py` + `agents/skill_manager.py` + `agents/memory_manager.py`
3. 然后按模块逐个实现并测试。

---

*文档生成时间：2026-06-30*
*方案作者：Kimi Code CLI*
