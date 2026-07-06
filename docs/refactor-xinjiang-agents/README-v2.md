# 新疆智能体重构方案 v2：完全内嵌至本项目

Daily Report功能点：
1. 自主画图
2. 下载成为word + png并保存

QA功能点：
1. taskID，session ID和user ID
2. 画图触发与图表展示
3. **gis交互和接口：可联动的对象是什么？需要什么信息？如何联动？**
4. **如何与系统集成**
5. SSE推流格式

---
> 状态：里程碑 1（DailyReport 本地 SQL + LLM）已完成，后续里程碑待实施
> 相对于 v1 的变化：
> - 从“Python 后端 + 参考架构”改为“**完全内嵌到本项目 TypeScript 架构**”
> - 从“可选 ECharts/PNG”改为“**使用本项目已有 recharts 前端渲染**”
> - 从“Redis session 记忆”改为“**复用本项目现有 MemoryManager**”
> - 自定义报告不在本次范围内

---

## 1. 目标与范围

### 1.1 目标

将新疆智能体的 `qa`（智能问答）和 `daily`（日报生成）能力，以**完全内嵌**方式集成到当前项目（`D:/0 ysq文件/DSI-agent-loop`）中：

- 使用本项目的 **Skill + Domain Tool + Agent Loop** 架构
- 使用本项目的 **TypeScript 后端** 和 **Next.js 前端**
- 使用本项目已有的 **recharts** 组件渲染图表
- 复用本项目现有的 **MemoryManager** 实现会话记忆
- 不再调用外部 Python 服务或日报 API

### 1.2 包含范围

| 能力 | 说明 |
|------|------|
| 边防 QA | 自然语言查询 → SQL → MySQL → Markdown 回答，支持图表与明细列表 |
| 日报生成 | 日期/类型解析 → 本地 SQL 模板 → 图表 → LLM 生成 Markdown 日报 |
| 图表展示 | 柱状图、饼图、折线图；在线用 recharts，Word 下载用后端 PNG |
| 会话记忆 | 同 task 内多轮 + 跨 task 复用 `sessionSummaryMemoryManager` |
| 报告下载 | Word (.docx) 格式，后端生成 PNG 插入图表 |

### 1.3 不包含

- 自定义报告智能体（`custom/`）
- Python 后端或桥接服务
- matplotlib / ECharts（统一使用 recharts）

---

## 2. 现状分析

### 2.1 本项目已有基础

| 组件 | 当前状态 | 是否可复用 |
|------|----------|------------|
| `skills/border-defense-qa/SKILL.md` | 已存在，含基础路由规则 | ✅ 增强 |
| `skills/daily-report/SKILL.md` | 已存在，原调用外部 API | ✅ 已重写为本地执行 |
| `MysqlQuery` / `MysqlQuerySchema` | 已存在，连接 `border-defense` 别名 | ✅ 直接使用 |
| `DailyReport` domain tool | 原调用外部 API | ✅ 已重写为本地 SQL + LLM |
| `MemoryManager` | 已存在，基于 userId + 最近 completed tasks | ✅ 复用 |
| 前端 `src/components/ui/chart.tsx` | 已基于 recharts 封装 | ✅ 复用 |
| `ToolRegistry` / `ToolGateway` | 已存在 | ✅ 直接使用 |

### 2.2 原项目需要迁移的内容

| 原项目文件 | 迁移目标 |
|------------|----------|
| `qa/system_prompt_qa.py` | `skills/border-defense-qa/SKILL.md` 正文 |
| `qa/agent_qa.py` 中的图表工具 | `ChartRenderData` domain tool |
| `qa/agent_qa.py` 中的拦截函数 | `skills/border-defense-qa/SKILL.md` 特殊回复规则 |
| `daily/daily_report_sql.py` | `api/src/modules/agent-loop/tools/domain/dailyReport/dailyReportSql.ts` |
| `daily/daily_report_system_prompt.py` | `skills/daily-report/SKILL.md` 输出格式规则 |
| `daily/daily_report_agent.py` 主逻辑 | `api/src/modules/agent-loop/tools/domain/dailyReport/dailyReport.ts` |

---

## 3. 总体架构

### 3.1 整体流程

```text
用户请求
  └── Agent Loop
        ├── SkillManager 加载 Skill（border-defense-qa / daily-report）
        ├── MemoryManager 注入历史上下文
        ├── ModelClient 决策
        │     ├── final_answer（自我介绍/无关问题/直接回答）
        │     └── tool_calls
        ├── ToolGateway 执行 Tool
        │     ├── MysqlQuery / MysqlQuerySchema（QA）
        │     ├── ChartRenderData（图表数据准备）
        │     └── DailyReport（本地 SQL + 图表 + LLM 报告）
        └── 模型总结为 Markdown（含图表占位符/数据）

前端收到 Markdown + chart data，渲染文本和 recharts 图表
```

### 3.2 会话与记忆设计

本项目以 `task` 为基本单位。

| 概念 | 说明 | 存储位置 |
|------|------|----------|
| `task` | 一次 Agent Loop 运行实例 | `tasks` 表 |
| `taskId` | 任务唯一标识 | `tasks.id` (UUID) |
| `userId` | 用户标识 | `tasks.user_id` |
| `transcript` | 单次 task 内的完整对话记录 | `agent_transcript_entries` 表 |
| `session summary memory` | 跨 task 的历史任务摘要 | `sessionSummaryMemoryManager` |

#### 同 task 内多轮对话

`runAgentLoop` 内部维护 `conversationMessages` 数组，每轮将 `assistant_message` 和 `tool_message` 追加进去，作为下一轮模型的上下文。因此：

> **同一个 taskId 内，天然支持多轮对话上下文。**

但当前 `POST /tasks` 每次都会创建新 task。如果前端需要多轮对话复用 taskId，需要扩展：

```text
POST /tasks/:taskId/continue
  ├── 校验 taskId 存在且状态为 completed 或 running
  ├── 从 agent_transcript_entries 加载历史消息
  ├── 将用户新消息追加到 conversationMessages
  ├── 调用 runAgentLoop 继续执行（传入 resumeMessages）
  └── 通过 SSE 推送后续事件
```

#### 跨 task 记忆

复用现有 `sessionSummaryMemoryManager`：

- 按 `userId` 查询最近完成的 N 个 tasks
- 加载这些 tasks 的 transcript
- 生成摘要后注入当前 task 的 system prompt

| 场景 | 实现复杂度 | 推荐 |
|------|------------|------|
| 同 task 多轮 | 中 | **一期工程**，最符合现有架构 |
| 跨 task session 记忆 | 高 | 如需，作为二期扩展 |

### 3.3 接口入口

推荐 **主入口 + 同步入口** 结合：

| 入口 | 路径 | 用途 |
|------|------|------|
| 主入口（前端/聊天） | `POST /tasks` + `GET /tasks/:taskId/stream` | 通过 Skill 自动路由到 QA 或日报 |
| QA 同步入口 | `POST /api/agent/intelligent-qa` | 外部系统 / Dify 同步调用 |
| 日报同步入口 | `POST /api/agent/daily-report` | 外部系统 / Dify 同步调用 |
| 日报下载 | `GET /tasks/:taskId/daily-report/download` | 下载 Word 报告 |

两个同步入口底层都走同一个 agent loop，避免逻辑分叉。

---

## 4. 边防 QA（Question Answering）

### 4.1 功能点

| 功能点 | 说明 | 状态 |
|--------|------|------|
| 自然语言转 SQL | 用户用中文提问，模型生成 MySQL 查询 | 已完成 |
| 表结构感知 | `MysqlQuerySchema` 先查 `information_schema.columns` | 已完成 |
| 聚合统计 | 支持 COUNT/SUM/AVG/GROUP BY 等 | 已完成 |
| 明细查询 | 支持返回具体记录列表 | 已完成 |
| 图表展示 | `MysqlQuery` 返回数据后默认调用 `ChartRenderData` 生成图表，空数据或用户明确不需要时跳过 | 已完成 |
| 特殊回复拦截 | 自我介绍、无关问题、敏感词等直接 final_answer | 已完成 |
| 同 task 多轮 | 通过 `POST /tasks/:taskId/continue` 实现追问 | **尚未实现** |

### 4.2 Skill 设计

`allowed-tools` 扩展为：

```yaml
allowed-tools: MysqlQuerySchema, MysqlQuery, ChartRenderData
```

#### 路由规则

- 默认情况下，`MysqlQuery` 返回非空数据后调用 `ChartRenderData`，`chart_type` 用 `auto`
- 以下情况跳过 `ChartRenderData`：用户明确说不要图、纯明细列表无需统计图、结果为空、自我介绍/无关问题
- 当查询涉及明细实体（预警事件 `alarm_event`、卡口 `buckle_info`/通行记录、部门 `sys_dept`、设备 `tb_device`）时，使用 `MysqlQuery` 直接查询目标表
- 当问题为自我介绍、无关问题、敏感词时，直接 final_answer，不调用工具

#### 图表占位符

最终 Markdown 中：

```markdown
最近一周预警等级分布如下：

![预警等级分布](chart://chart_abc123)
```

### 4.3 明细查询迁移方案

#### 原项目设计（已标记“暂时放弃”）

原项目 `app/qa/system_prompt_qa.py` 中实现了两套明细查询提示词：

- `sys_prompt_data_detail_query_rewrite`：将统计类问题重写为明细查询问题
- `sys_prompt_data_detail_merge_sql_operation`：生成返回固定四字段的 SQL

统一返回字段：

```text
data_detail_type:  预警事件-alarm_event / 卡口-buckle_info / 部门-sys_dept / 设备-device
data_detail_pk:    主键值
data_detail_longitude: 经度
data_detail_latitude:  纬度
```

并通过环境变量 `QA_REPORT_DATA_DETAIL_STATUS`（默认 `disabled`）控制是否启用。

#### 迁移思路：简化，复用现有 GIS 能力

原方案为了把明细标到地图上，强制抽象出四字段。本项目中已有 `RegionMark` 等 GIS 工具，但 `RegionMark` 面向区域/多边形，不适合直接标注单点。因此当前方案先以文本表格返回坐标，地图联动作为后续增强。

| 场景 | 新方案 | 工具 |
|------|--------|------|
| 列表明细（如“列出今天一级预警”） | `MysqlQuery` 直接查询相关字段，模型用 Markdown 表格呈现 | `MysqlQuery` |
| 地图明细（如“高发预警点位在哪里”） | `MysqlQuery` 查 lat/lng + 业务字段，当前以 Markdown 表格输出坐标；自动地图渲染需后续GIS实体输出支持 | `MysqlQuery`（当前）/ GIS tool（后续） |
| 统计+明细（如“告警率最高的设备是哪些”） | 先 `MysqlQuery` 聚合，再用 `MysqlQuery` 查 TOP N 明细 | `MysqlQuery` |

#### 具体规则（写入 `skills/border-defense-qa/SKILL.md`）

1. **识别明细意图**
   - 明细查询由涉及的实体类型触发，而非关键词。四种明细实体为：
     - 预警事件：`alarm_event`
     - 卡口：`buckle_info` / `buckle_access_record`
     - 部门：`sys_dept`
     - 设备：`tb_device`（设备与传感器是同一概念）
   - 如果用户问题涉及上述任一实体，把统计类问题转换为对该实体明细列表的查询
   - 例句：“列出本周触发黑名单预警的所有车牌号及进入时间” → 涉及卡口通行记录，按明细列表查询

2. **列表明细**
   - 直接用 `MysqlQuery` 查询目标表，返回用户需要的字段
   - 结果以 Markdown 表格形式输出
   - 记录较多时，使用 `LIMIT 20` 并提示用户“仅展示前 20 条”

3. **地图明细**
   - 查询结果包含 `longitude` / `latitude` 字段
   - 如果需要在地图上展示，调用 `RegionMark` 工具，传入点坐标
   - 如果只需文字回答经纬度，则直接输出

4. **不引入独立 detail 工具**
   - 不新增 `DataDetailQuery` domain tool
   - 不强制返回 `data_detail_type/pk/longitude/latitude` 四字段
   - 由 `MysqlQuery` 的通用 SQL 能力覆盖

#### 迁移收益

- 减少一个专用 agent 和两套提示词
- 避免原方案中“重写问题 → 生成固定字段 SQL → 再消费”的复杂链路
- 列表和地图展示可以分别用现有 `MysqlQuery` + `RegionMark` 实现
- 不依赖 `QA_REPORT_DATA_DETAIL_STATUS` 开关

### 4.4 Domain Tool 设计

#### `MysqlQuerySchema`

已存在，用于查询表结构。

#### `MysqlQuery`

已存在，执行用户生成的 SQL。

#### `ChartRenderData`（新增）

**不是“绘图工具”，而是“图表数据准备工具”**。接收 `MysqlQuery` 结果，生成前端 recharts 可用的结构化数据。

输入示例：

```json
{
  "chart_type": "auto",
  "data": [
    {"level": "一级预警", "count": 12},
    {"level": "二级预警", "count": 34}
  ],
  "title": "预警等级分布",
  "x_key": "level",
  "y_key": "count"
}
```

输出示例：

```json
{
  "chart_type": "bar",
  "title": "预警等级分布",
  "chart_id": "chart_abc123",
  "data": [
    {"level": "一级预警", "count": 12},
    {"level": "二级预警", "count": 34}
  ],
  "config": {
    "x_axis": "level",
    "y_axis": "count"
  }
}
```

#### 自动图表推荐

当 `chart_type: "auto"` 时，工具根据数据特征推荐：

- X 轴字段含 `time/date/hour/day/month` → 折线图
- 只有两列（一字符串一数值）且数据行 ≤ 5 → 饼图
- 否则 → 柱状图

### 4.5 图表渲染

#### 在线查看

前端 `src/components/ui/chart.tsx` 已封装 `ChartContainer`、`ChartTooltip`、`ChartLegend`。

渲染流程：

1. 解析 Markdown，识别 `![...](chart://<chart_id>)`
2. 从 task.result 的 charts 数组找到对应数据
3. 根据 `chart_type` 选择 recharts 组件：`BarChart` / `LineChart` / `PieChart`
4. 用 `ChartContainer` 包裹渲染

默认开启 tooltip 和 legend 交互。

### 4.6 文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `skills/border-defense-qa/SKILL.md` | 修改 | 增加图表规则、完整表结构、SQL 示例、特殊回复、**明细查询规则** |
| `api/src/modules/agent-loop/tools/domain/chartRenderData/chartRenderData.ts` | 新增 | 将查询结果转为 recharts 结构化数据 |
| `api/src/modules/agent-loop/tools/domain/index.ts` | 修改 | 注册 `ChartRenderData`（**不新增独立明细查询 tool**） |
| `src/components/chat/ChartRenderer.tsx` | 新增 | 解析 chart:// 占位符并渲染 recharts |
| `src/components/chat/MarkdownContent.tsx` | 修改 | 识别 chart:// 并渲染 ChartRenderer |
| `src/hooks/useTaskChat.ts` | 修改 | 从 agent loop 事件和任务结果中提取 charts |
| `src/lib/agentLoopCharts.ts` | 新增 | 从事件/结果中提取图表数据 |
| `src/types/prd.ts` | 修改 | `ChatMessage` 新增 `charts` 字段 |

> 以下文件在当前阶段**尚未创建**，属于后续接口增强：
> - `api/src/app/api/agent/intelligent-qa/route.ts`（QA 同步接口）
> - `api/src/app/api/agent/daily-report/route.ts`（日报同步接口）

---

## 5. 日报生成（Daily Report）

### 5.1 功能点

| 功能点 | 说明 | 状态 |
|--------|------|------|
| 日期解析 | 支持“今天/昨天/前天”、ISO 日期、中文日期 | 已完成 |
| 报告类型 | `all`（总体）、`buckle`（设备监控/卡口）、`event`（预警事态） | 已完成 |
| 本地 SQL 执行 | 直接连接 border-defense MySQL，执行 SQL 模板 | 已完成 |
| 图表生成 | 自动生成预警等级饼图、卡口繁忙度 Top5 柱状图 | 已完成 |
| LLM 生成报告 | 调用 Qwen 等模型生成标准 Markdown 日报 | 已完成 |
| 无模型降级 | 未配置 API key 时，使用模板化报告 | 已完成 |
| 报告保存 | Markdown 保存到 `api/tmp/agent-loop/reports/` | 已完成 |
| Word 下载 | 后端生成 PNG 插入 docx | 已完成 |
| 定时清理 | 每天 00:00 清理超过 30 天的报告文件 | 已完成 |

### 5.2 Skill 设计

`allowed-tools`：

```yaml
allowed-tools: DailyReport
```

工作流程：

1. 从用户输入提取日期和 `report_type`
2. 直接调用 `DailyReport` tool
3. Tool 内部执行 SQL 模板、生成 chart data、调用 LLM 生成 Markdown
4. 模型只需简单总结，不暴露复杂推理

### 5.3 Domain Tool 设计

`DailyReport` tool 核心流程：

```ts
async execute(input, context) {
  const date = extractDate(input.query);
  const reportType = input.report_type; // all / buckle / event

  // 1. 执行本地 SQL 模板
  const sql = buildDailyReportSql(reportType, startTime, endTime);
  const rows = await runMysqlQuery(sql);

  // 2. 生成图表数据
  const charts = buildDailyReportCharts(reportType, rows[0]);

  // 3. LLM 生成 Markdown 报告
  const reportContent = await generateReportWithModel(rows[0], charts, reportType, date);

  return {
    date,
    report_type: reportType,
    report_content: reportContent,
    charts,
  };
}
```

### 5.4 SQL 模板

从原项目 `daily/daily_report_sql.py` 迁移为 `dailyReportSql.ts`，包含：

- `ALL_SQL`：总体日报（预警 + 设备 + 卡口）
- `BUCKLE_SQL`：设备监控日报
- `EVENT_SQL`：预警事态日报

通过 `{start_time}` / `{end_time}` 占位符替换为具体日期范围。

### 5.5 图表生成

#### 预警等级占比饼图

当 `report_type === "all" || "event"` 时生成：

```json
{
  "chart_type": "pie",
  "title": "预警等级占比",
  "data": [
    {"level": "一级预警", "count": 5},
    {"level": "二级预警", "count": 6},
    {"level": "三级预警", "count": 4}
  ],
  "config": {
    "label_key": "level",
    "value_key": "count"
  }
}
```

#### 卡口繁忙度 Top5 柱状图

当 `report_type === "all" || "buckle"` 时生成：

```json
{
  "chart_type": "bar",
  "title": "卡口繁忙度Top5",
  "data": [
    {"buckle_name": "A卡口", "count": 256},
    {"buckle_name": "B卡口", "count": 198}
  ],
  "config": {
    "x_axis": "buckle_name",
    "y_axis": "count"
  }
}
```

### 5.6 报告保存与下载

> **当前状态**：`DailyReport` tool 返回 `report_content` 和 `charts`，前端可直接渲染；后端会保存 Markdown 文件到 `api/tmp/agent-loop/reports/`。Word 下载已实现。

#### 保存位置

| 内容 | 保存路径 | 说明 |
|------|----------|------|
| Markdown 报告 | `api/tmp/agent-loop/reports/{date}_{report_type}_{taskId}.md` | 生成时即保存 |
| Word 报告 | `api/tmp/agent-loop/reports/{date}_{report_type}_{taskId}.docx` | 下载时生成并缓存 |
| 图表 PNG | `api/tmp/agent-loop/reports/{date}_{report_type}_{taskId}_{chartId}.png` | 用于插入 Word |

#### 文件清理

已使用 `node-cron` 实现定时清理，默认每天 00:00 执行，保留 **30 天**（与原有项目 `RETAIN_DAYS` 一致，可通过 `DAILY_REPORT_RETAIN_DAYS` 调整）。

实现文件：`api/src/modules/agent-loop/tools/domain/dailyReport/reportCleanupJob.ts`，并在 `api/src/index.ts` 中随服务启动。

#### Word 下载

```text
GET /tasks/:taskId/daily-report/download
  ├── 从 tasks.result 读取 report_content 和 charts
  ├── 根据 chart data 后端生成 PNG
  ├── 将 Markdown + PNG 插入 docx
  └── 返回 application/vnd.openxmlformats-officedocument.wordprocessingml.document
```

后端 PNG 生成推荐 `@observablehq/plot` 或 `quickchart-js`，Word 生成使用 `docx` 库。

### 5.7 文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `skills/daily-report/SKILL.md` | 重写 | 本地 SQL + LLM，定义同步接口输入输出 |
| `api/src/modules/agent-loop/tools/domain/dailyReport/dailyReport.ts` | 重写 | 本地 SQL + 图表 + LLM 报告 |
| `api/src/modules/agent-loop/tools/domain/dailyReport/dailyReportSql.ts` | 新增 | all / buckle / event SQL 模板 |
| `api/src/modules/agent-loop/tools/domain/dailyReport/dailyReportTypes.ts` | 新增 | 输入输出类型定义 |
| `api/src/modules/agent-loop/tools/domain/dailyReport/dailyReportDownloader.ts` | 新增 | Word 下载 + PNG 生成 |
| `api/src/modules/agent-loop/tools/domain/chartRenderData/chartPngGenerator.ts` | 新增 | 根据 chart data 生成 PNG |
| `api/src/modules/agent-loop/tools/domain/dailyReport/reportCleanupJob.ts` | 新增 | 定时清理报告文件 |
| `api/src/modules/agent-loop/tools/domain/index.ts` | 修改 | 注册重写后的 `DailyReport` |

> 以下文件在当前阶段**尚未创建**，属于后续下载/同步接口增强：
> - `api/src/app/api/agent/daily-report/route.ts`（日报同步接口）

---

## 5.8 日报迁移完成度结论

**结论：日报（Daily Report）核心功能点已全部迁移完成。**

### 已迁移的核心功能

| 原项目文件/能力 | 当前实现 | 状态 |
|-----------------|----------|------|
| `daily/daily_report_sql.py` | `dailyReportSql.ts`（ALL / BUCKLE / EVENT SQL） | ✅ 已迁移 |
| `daily/daily_report_system_prompt.py` | `dailyReport.ts` 内 `buildSystemPrompt()` | ✅ 已迁移 |
| `daily/daily_report_agent.py` 主逻辑 | `dailyReport.ts` | ✅ 已迁移 |
| 日期解析（今天/昨天/前天/具体日期） | `extractDate()` | ✅ 已迁移 |
| 三种报告类型（all / buckle / event） | `DailyReportInputSchema` | ✅ 已迁移 |
| SQL 执行与数据格式化 | `runMysqlQuery()` + `formatDataResult()` | ✅ 已迁移 |
| 图表生成（饼图、柱状图） | `buildDailyReportCharts()` + `chartPngGenerator.ts` | ✅ 已迁移 |
| LLM 生成 Markdown 报告 | `generateReportWithModel()` | ✅ 已迁移 |
| 无模型降级（fallback 模板） | `dailyReport.ts` fallback | ✅ 已迁移 |
| 报告保存为 Markdown | `saveDailyReportMarkdown()` | ✅ 已迁移 |
| Word 下载 | `dailyReportDownloader.ts` + `GET /tasks/:taskId/daily-report/download` | ✅ 已迁移 |
| 文件定时清理 | `reportCleanupJob.ts` | ✅ 已迁移 |

### 与原项目的差异（非功能缺失）

| 差异项 | 原项目 | 当前项目 | 说明 |
|--------|--------|----------|------|
| 调用入口 | 独立 FastAPI 接口 `/daily-report`、`/daily-report-direct` | 通过 `POST /tasks` + Skill 路由到 `DailyReport` tool | 架构差异，能力等价 |
| Session 记忆 | Redis session + `save_round` | 复用 `tasks` 表 + `agent_transcript_entries` | 架构差异，结果已持久化 |
| 图表文件接口 | `/figure/{filename}` 独立获取 PNG | PNG 仅在 Word 下载时生成，未暴露独立接口 | 当前设计已满足 Word 下载需求 |
| 中间产物 | SQL 结果保存为 CSV | 不保存 CSV | 当前直接格式化后传给 LLM |
| Word 样式 | 中文字体嵌入 + 表格样式 | 基础 docx 渲染 | 如需字体/表格样式增强，可后续优化 |

### 尚未实现（可选增强）

如需 100% 兼容原项目接口，可补充：

1. `POST /daily-report` 流式接口（内部调用 `runAgentLoop`）
2. `POST /daily-report-direct` 同步接口（供 Dify 调用）
3. 独立的图表文件服务接口（如前端需要单独查看 PNG）
4. Word 下载增加中文字体嵌入与表格样式

---

## 6. 迁移状态与剩余缺口

### 6.1 已完成的功能

| 模块 | 功能 | 当前实现 |
|------|------|----------|
| QA | 自然语言转 SQL | `skills/border-defense-qa/SKILL.md` + `MysqlQuerySchema`/`MysqlQuery` |
| QA | 自我介绍/无关问题拦截 | SKILL.md `Special responses` 规则 |
| QA | 默认画图规则 | SKILL.md `Chart rules`：非空数据默认调用 `ChartRenderData` |
| QA | 明细查询（列表） | SKILL.md `Detail query rules`：按实体类型触发，`MysqlQuery` 直接返回 |
| QA | 图表数据准备 | `ChartRenderData` domain tool |
| QA | 前端图表渲染 | `ChartRenderer.tsx` + `MarkdownContent.tsx` + `agentLoopCharts.ts` |
| QA/Daily | 跨 task 记忆 | `sessionSummaryMemoryManager` + `pipelineMemory.ts`（需 `AGENT_MEMORY_SESSION_SUMMARY=1`） |
| Daily | 日期/类型解析 | `DailyReport` tool 本地解析 |
| Daily | 本地 SQL 模板 | `dailyReportSql.ts` |
| Daily | 图表生成 | `dailyReport.ts` 内生成 chart data |
| Daily | LLM 生成报告 | `dailyReport.ts` 调用 Qwen 等模型 |
| Daily | 无模型降级 | `dailyReport.ts` fallback 模板 |
| Daily | 报告文件定时清理 | `reportCleanupJob.ts` + `api/src/index.ts` |

### 6.2 尚未实现/待补齐

| 模块 | 原项目功能 | 当前状态 | 影响 | 建议方案 |
|------|-----------|----------|------|----------|
| QA | `/intelligent-QA` 流式接口 | **未实现** | 前端当前走 `POST /tasks` + SSE，等价但路径不同 | 如需兼容原接口，新增 `/intelligent-QA` 路由内部调用 `runAgentLoop` |
| QA | `/intelligent-QA-direct` 同步接口（Dify） | **未实现** | README 中列出的同步入口不存在 | 新增 `/api/agent/intelligent-qa` 同步路由 |
| QA | Session 管理（`/sessions/*`） | **未实现** | 当前无 session CRUD 接口 | 原项目基于 Redis；如需保留，新增 `/sessions` 路由 + Redis/数据库存储 |
| QA | 同 task 多轮对话（`POST /tasks/:taskId/continue`） | **未实现** | 每次 `POST /tasks` 都创建新 task | 扩展 `CreateTaskRequest` 支持 `session_id`，新增 continue 路由 |
| QA | 明细地图联动（经纬度标到地图） | **部分实现** | 原项目返回 `data_detail_longitude`/`data_detail_latitude`；当前 `MysqlQuery` 仅返回表格，无 GIS 实体输出 | 为 `borderDefenseQa` 的 `MysqlQuery` 增加 `tryBuildGisDataFromRows`，或新增点标注 tool |
| QA | 明细查询 agent（两套提示词 + 固定四字段） | **已简化** | 不再作为独立 agent；按实体类型直接查明细 | 当前方案已覆盖列表类明细，地图类需补齐 GIS 输出 |
| QA | QA 报告保存为 `.md` 文件 | **未实现** | 当前结果存 `tasks.result` | 如需文件保存，在 pipeline 完成时写 `api/tmp/agent-loop/reports/` |
| Daily | `/daily-report` 独立流式接口 | **未实现（架构差异）** | 当前日报已走 `POST /tasks` + SSE，能力等价 | 如需兼容原 FastAPI 接口，新增 `/daily-report` 路由内部调用 `runAgentLoop` |
| Daily | `/daily-report-direct` 同步接口（Dify） | **未实现（架构差异）** | 当前无独立同步入口 | 如需兼容原 FastAPI 接口，新增 `/api/agent/daily-report` 同步路由 |
| Daily | QA 式 Redis Session 记忆 | **未实现（架构差异）** | 日报作为 Agent Loop tool 执行，结果持久化在 `tasks` 表；无独立 Redis session 列表/消息/标题管理 | 如需保留原项目 session 管理，新增 `/sessions` 路由 + 存储 |

### 6.3 需要用户确认的问题

1. **同步接口优先级**：是否需要立即实现 `/api/agent/intelligent-qa` 和 `/api/agent/daily-report` 供 Dify 调用？
2. **Session 管理范围**：是否需要保留原项目的 Redis Session 管理（列表、消息历史、标题修改、删除），还是复用当前 `tasks` 表 + `AGENT_MEMORY_SESSION_SUMMARY` 即可？
3. **地图联动方案**：明细查询的经纬度希望如何展示？
   - A. 当前方案：Markdown 表格输出坐标；
   - B. 增强 `MysqlQuery` 自动输出 GIS entity；
   - C. 新增独立点标注 tool（如 `PointMark`）。
4. **Word 下载优先级**：日报 Word 下载是否为当前里程碑必须？

---

## 7. 关键设计决策确认

| 题号 | 问题 | 用户确认 |
|------|------|----------|
| 1 | 图表方案 | **A. 后端返回 recharts 结构化数据，前端渲染** |
| 2 | QA 图表触发 | **默认尽量画图**（空数据/用户明确不要/纯明细/自我介绍/无关问题跳过） |
| 3 | 图表颜色 | **默认 recharts 配色** |
| 4 | 日报 SQL 模板 | **是，直接复用原项目 `daily_report_sql.py`** |
| 5 | 日报占位符 | **是，保留 `![图表描述](...)` 格式，但引用 chart data** |
| 6 | 同步接口 | **是，需要支持外部系统/Dify 调用**（尚未实现） |
| 7 | 自我介绍/无关问题拦截 | **是，保留** |
| 8 | QA 明细查询 | **是，支持返回具体记录列表** |
| 9 | QA 表结构/示例 | **是，完整迁移 `system_prompt_qa.py`** |
| 10 | 记忆复用 | **是，`sessionSummaryMemoryManager` 足够** |
| 11 | Session 记忆场景 | **同 task 内多轮对话**（`POST /tasks/:taskId/continue` 尚未实现） |
| 12 | 扩展 continue 接口 | **是，但希望了解具体含义**（尚未实现） |
| 13 | ChartRenderData 默认 chart_type | **A. `"auto"` 自动推荐** |
| 14 | 前端图表交互 | **默认开启 tooltip/legend** |
| 15 | 报告保存方式 | **B. 保存到 `api/tmp/agent-loop/reports/`**（已完成） |
| 16 | 下载格式 | **B. Word (.docx)**（已完成） |
| 17 | Word 中图表处理 | **B. 后端生成 PNG 插入 Word**（已完成） |

---

## 8. 实施计划

### 里程碑 1：日报本地 SQL + LLM（已完成）

- [x] 迁移 `daily_report_sql.py` 为 `dailyReportSql.ts`
- [x] 重写 `DailyReport` domain tool（本地 SQL + LLM + fallback）
- [x] 更新 `skills/daily-report/SKILL.md`
- [x] 更新 `promptManager.ts` 路由提示
- [x] 添加 smoke test 与单元测试

### 里程碑 2：图表工具与前端渲染（已完成）

- [x] 新增 `ChartRenderData` domain tool
- [x] 增强 `skills/border-defense-qa/SKILL.md` 图表规则
- [x] 前端 `ChartRenderer.tsx` 解析 chart:// 占位符
- [x] 测试 QA 图表链路

### 里程碑 3：同 task 多轮对话

- [ ] 扩展 `POST /tasks/:taskId/continue`
- [ ] 更新 `runAgentLoop` 支持 resume 模式
- [ ] 测试多轮 QA 与日报追问

### 里程碑 4：Word 下载与报告保存（已完成）

- [x] 实现 `dailyReportDownloader.ts`
- [x] 实现 `chartPngGenerator.ts`
- [x] 新增 `GET /tasks/:taskId/daily-report/download`
- [x] 定时清理 `api/tmp/agent-loop/reports/`
- [x] `DailyReport` tool 执行成功后保存 Markdown 到 reports 目录

### 里程碑 5：边防 QA 完整迁移（已完成主要规则，地图联动待增强）

- [x] 完整迁移 `system_prompt_qa.py` 到 Skill
- [x] 特殊回复拦截规则（自我介绍、无关问题）
- [x] 明细查询支持（按实体类型触发，`MysqlQuery` 直接返回，不新增独立 detail tool）
- [ ] 明细地图联动（经纬度自动 GIS 实体输出）
- [x] 数据一致性对比测试

---

## 9. 核心代码骨架

### 9.1 `skills/daily-report/SKILL.md`

```markdown
---
name: daily-report
description: 生成边防日报：总体日报、设备监控日报、预警事态日报
argument-hint: "[日期 + 报告类型]，例如：今天总体日报、昨天设备监控、2025-11-10 预警事态"
allowed-tools: DailyReport
---

# Daily Report

用于生成边防系统的每日/指定日期报告。

## Required Input

传递用户原始查询作为 `$ARGUMENTS`。查询应包含：

1. 日期：今天、昨天、前天、具体日期如 `2025-11-10` 或 `2025年11月10日`
2. 报告类型（可选）：
   - `总体` / `all` / 综合 → report_type: "all"
   - `设备监控` / `设备` / 卡口 → report_type: "buckle"
   - `预警事态` / `预警` / 事态 → report_type: "event"
   - 未指定 → report_type: "all"

## Workflow

1. 从 `$ARGUMENTS` 中提取日期，解析为 `YYYY-MM-DD`。
2. 确定 report_type。
3. 调用 `DailyReport` tool：

```json
{
  "query": "今天",
  "report_type": "all"
}
```

4. Tool 会返回 `report_content`（Markdown）和 `charts`（recharts 数据）。
5. 将 `report_content` 作为最终回答返回，不要额外编造数据。

## Rules

- 不要自行查询数据库或编写 SQL，全部交给 `DailyReport` tool。
- 如果用户只问“日报”没指定日期，默认今天。
- 如果用户要求具体某一天的明细数据，不要用 `DailyReport`，应使用 `MysqlQuery`。
- 最终输出必须是标准 Markdown，图表占位符保留 `![图表标题](chart://<chart_id>)` 格式。
```

### 9.2 `ChartRenderData` Tool

```typescript
import { z } from "zod";
import type { ToolDefinition } from "../../_shared/types.js";

const ChartRenderDataInputSchema = z.strictObject({
  chart_type: z.enum(["auto", "bar", "line", "pie"]).default("auto"),
  data: z.array(z.record(z.union([z.string(), z.number()]))),
  title: z.string().min(1),
  x_key: z.string().optional(),
  y_key: z.string().optional(),
  label_key: z.string().optional(),
  value_key: z.string().optional(),
  series_keys: z.array(z.string()).optional(),
});

export function buildChartRenderDataTool(): ToolDefinition {
  return {
    name: "ChartRenderData",
    aliases: ["chart-render"],
    description: "将 MysqlQuery 返回的表格数据转换为前端 recharts 可用的结构化图表数据。",
    kind: "domain",
    inputSchema: ChartRenderDataInputSchema,
    isReadOnly: () => true,
    execute(input) {
      // 根据数据推荐 chart_type，生成 chart_id
      return Promise.resolve({ chart_type, title, data, config, chart_id });
    },
  };
}
```

### 9.3 `DailyReport` Tool 核心结构

```typescript
export function buildDailyReportTool(): ToolDefinition {
  return {
    name: "DailyReport",
    aliases: ["daily-report", "daily_report"],
    kind: "domain",
    inputSchema: z.strictObject({
      query: z.string().min(1),
      report_type: z.enum(["all", "buckle", "event"]).default("all"),
    }),
    isReadOnly: () => true,
    async execute(input, context) {
      const date = extractDate(input.query);
      const { startTime, endTime } = getMidnightStrings(date);
      const sql = buildDailyReportSql(input.report_type, startTime, endTime);
      const rows = await runMysqlQuery(sql);
      const charts = buildDailyReportCharts(input.report_type, rows[0]);
      const reportContent = await generateReportWithModel(rows[0], charts, input.report_type, date);
      return { date, report_type: input.report_type, report_content: reportContent, charts };
    },
  };
}
```

### 8.4 前端 `ChartRenderer.tsx`

```tsx
import { BarChart, Bar, XAxis, YAxis, LineChart, Line, PieChart, Pie, Cell } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";

export function ChartRenderer({ chartData }: { chartData: ChartData }) {
  const { chart_type, data, config } = chartData;

  if (chart_type === "bar") {
    return (
      <ChartContainer config={{}} className="h-[300px]">
        <BarChart data={data}>
          <XAxis dataKey={config.x_axis} />
          <YAxis />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Bar dataKey={config.y_axis} fill="#8884d8" />
        </BarChart>
      </ChartContainer>
    );
  }

  // line / pie 类似...
}
```

---

## 10. 测试计划

| 测试 | 命令 | 说明 |
|------|------|------|
| 日报单元测试 | `pnpm agent:test:daily-report` | 验证 tool 输入输出 |
| 日报 v2 单元测试 | `pnpm agent:test:daily-report:v2` | 验证 SQL 替换、schema |
| 日报 smoke | `pnpm agent:smoke:daily-report` | fake model + mock MySQL |
| QA 图表测试 | `pnpm agent:test:border-defense-qa` | 验证 SQL + 图表链路 |
| 构建 | `pnpm build` | TypeScript 编译 |

---

*文档更新时间：2026-06-30*
*方案作者：Kimi Code CLI*
