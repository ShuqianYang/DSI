# 二、Skills 机制

## 2.1 什么是 Skill

Skill 是项目中可复用的智能体能力包，位于 `skills/` 目录下。每个 Skill 必须包含一个 `SKILL.md` 文件，采用 **YAML frontmatter + Markdown 正文** 的格式定义。

```
skills/
├── aircraft-region-query/
│   └── SKILL.md
├── ais-region-query/
│   └── SKILL.md
├── alarm-disposal-orchestrator/
│   └── SKILL.md
├── border-defense-qa/
│   └── SKILL.md
├── conventional-commit-helper/
│   └── SKILL.md
├── csv-profile/
│   └── SKILL.md
├── daily-report/
│   └── SKILL.md
├── disaster-satellite-query/
│   └── SKILL.md
├── earthquake-assessment/
│   └── SKILL.md
├── fire-investigation/
│   └── SKILL.md
├── flood-assessment/
│   └── SKILL.md
└── oil-spill-tracing/
    └── SKILL.md
```

## 2.2 SKILL.md 格式示例

以 `skills/aircraft-region-query/SKILL.md` 为例：

```yaml
---
name: aircraft-region-query
description: Use when the user asks about aircraft, flights, planes, ADS-B, OpenSky, air traffic, or aviation situation in a named region or bounding box...
argument-hint: "[user aircraft query with region or bbox]"
allowed-tools: Read, SqlQuerySchema, SqlQuery
---

# Aircraft Region Query

Use this skill to answer aircraft situation questions from the hourly OpenSky current-state read model...
```

## 2.3 Frontmatter 字段说明

| 字段 | 作用 |
|------|------|
| `name` | Skill 唯一标识名 |
| `description` | 给模型看的用途说明 |
| `when_to_use` / `whenToUse` | 触发条件描述 |
| `allowed-tools` | 加载该 Skill 后允许使用的工具白名单 |
| `argument-hint` | 调用 `Skill` 工具时 `args` 参数的提示 |
| `arguments` | 参数名列表 |
| `paths` | 条件 Skill 匹配的文件 glob 模式 |
| `model` | 指定模型 |
| `effort` | 努力程度 |
| `context` | `inline` 或 `fork` |
| `shell` | 嵌入命令的 shell 类型 |
| `disable-model-invocation` | 是否禁止模型主动调用 |
| `user-invocable` | 是否允许用户层调用（默认 `true`） |

## 2.4 Skill 的发现与注册

核心实现位于 `api/src/modules/agent-loop/skillManager.ts`。

### LocalSkillManager

```ts
export class LocalSkillManager implements SkillManager {
  private workspaceRoot: string | undefined;
  private skills = new Map<string, SkillDefinition>();
  private conditionalSkills = new Map<string, SkillDefinition>();
  // ...
}
```

- 自动扫描工作区根目录下的 `skills/` 目录。
- 普通 Skill 直接加载到 `skills` 中。
- 条件 Skill（带 `paths`）先放入 `conditionalSkills`，当相关文件被操作时动态激活。

### 条件 Skill 激活

文件工具（Read/Write/Edit）操作文件后，会触发：

- `discoverSkillDirsForPaths(filePaths, cwd)`：发现附近的 Skill 目录
- `activateConditionalSkillsForPaths(filePaths, cwd)`：激活匹配路径的条件 Skill

```ts
activateConditionalSkillsForPaths(filePaths: string[], cwd: string): string[] {
  // 遍历 conditionalSkills，对 paths 做 glob 匹配
  // 匹配成功后从 conditionalSkills 移到 skills
}
```

## 2.5 Skill 工具的注册

在 `api/src/modules/agent-loop/runAgentLoop.ts` 中：

```ts
const skillManager = options.skillManager ?? defaultSkillManager;
registerSkillTool(registry, skillManager);
```

`registerSkillTool()` 会往 `ToolRegistry` 注入一个名为 **`Skill`** 的虚拟工具。

## 2.6 Skill 如何被 Agent 调用

### 第一步：Skill 列表注入 Prompt

每轮模型请求前，`skillManager.getSkillListingSections()` 把所有可用 Skill 的摘要注入 system prompt：

```
Available local skills from the repository root skills directory:
- aircraft-region-query: ... | call: {"skill":"aircraft-region-query","args":"[user aircraft query with region or bbox]"}
- ais-region-query: ...
...

When a skill matches the user task, call the Skill tool first...
```

### 第二步：模型调用 Skill 工具

模型根据任务选择合适的 Skill：

```json
{"skill": "aircraft-region-query", "args": "查询台湾海峡航班"}
```

### 第三步：加载 Skill 内容

`Skill` 工具的 `execute()` 会：

1. 加载完整 Skill 内容
2. 做参数替换（`$ARGUMENTS`、`$1`、`$name`）
3. 执行嵌入的 shell 命令（`` !`cmd` `` 或 `` ```! ... ``` ``）
4. 注入到 `toolUseContext.invokedSkillSections`
5. 设置 `skillAllowedToolNames` 白名单

```ts
async execute(input, context) {
  const content = await renderSkillContent({ skill, args: parsed.args, context, registry });
  injectSkillContent(toolUseContext, skill, content);
  applySkillAllowedTools(toolUseContext, skill);
  return { success: true, ... };
}
```

### 第四步：受限工具调用

后续轮次中，模型只能使用白名单中的工具：

```ts
function applySkillAllowedTools(toolUseContext, skill) {
  const allowedToolNames = new Set<string>(["Skill"]);
  for (const allowedTool of skill.allowedTools) {
    allowedToolNames.add(normalizeAllowedToolName(allowedTool));
  }
  toolUseContext.skillAllowedToolNames = allowedToolNames;
  toolUseContext.skillAllowedToolsExpiresOnTurn = inferCurrentTurn(toolUseContext) + 1;
}
```

## 2.7 Skill 内容渲染

`renderSkillContent` 支持：

- 参数替换：`$ARGUMENTS`、`$1`、`$name`
- 变量替换：`${SKILL_DIR}`、`${SESSION_ID}`
- 嵌入 shell 命令：
  - 行内：`` !`cmd` ``
  - 代码块：`` ```!\ncmd\n``` ``

```ts
content = substituteArguments(content, input.args, skill.argumentNames);
content = content.replace(/\$\{SKILL_DIR\}/g, normalizePathForPrompt(skill.baseDir));
content = content.replace(/\$\{SESSION_ID\}/g, input.context.taskId);

if (content.includes("!`") || content.includes("```!")) {
  content = await executeEmbeddedShellCommands(content, input.context, input.registry, skill.name);
}
```

## 2.8 当前已有的 Skills

| Skill | 用途 |
|-------|------|
| `aircraft-region-query` | 按区域查询航班/OpenSky 数据 |
| `ais-region-query` | 按区域查询船舶 AIS 数据 |
| `conventional-commit-helper` | 辅助生成符合规范的提交信息 |
| `csv-profile` | CSV 数据分析 |
| `disaster-satellite-query` | 灾害卫星影像查询 |

## 2.9 各 Skill 功能与实现详解

### 2.9.1 `aircraft-region-query`（航空器区域查询）

- **触发条件**：用户询问飞机、航班、ADS-B、OpenSky、空域、航空器等信息，且包含区域或 bbox。
- **数据源**：数据库表 `public.aircraft_current_states`，由后端每小时刷新。
- **允许工具**：`Read`、`SqlQuerySchema`、`SqlQuery`。
- **实现方式**：声明式 Prompt 工程。Skill 内定义表结构、SQL 查询模板、单位换算规则与安全约束，由 LLM 生成 SQL 后调用 `SqlQuery` 执行。
- **关键能力**：
  - 按 bbox 汇总/明细查询航班；
  - 紧急信号查询（squawk 7500/7600/7700、SPI）。
- **主要约束**：
  - 必须使用 `RegionResolve.selected.bbox`；
  - `velocity` 默认单位为 m/s，展示 km/h 时需乘以 3.6；
  - 明细查询输出上限 100 条；
  - 禁止从位置推断军事活动、劫持、紧急事件等。

### 2.9.2 `ais-region-query`（船舶 AIS 区域查询）

- **触发条件**：用户询问船舶、船只、AIS、海事、海域态势等信息，且包含区域或 bbox。
- **数据源**：数据库表 `public.ais_current_states`，由后端每小时从 aisstream.io 刷新。
- **允许工具**：`Read`、`SqlQuerySchema`、`SqlQuery`。
- **实现方式**：与 `aircraft-region-query` 同构，通过 Markdown 工作流 + SQL 模板实现，只是表结构与字段不同。
- **关键能力**：按 bbox 汇总/明细查询船舶，输出 MMSI、船名、航速 SOG、航向 COG、航行状态等。
- **主要约束**：
  - 强制复用 `RegionResolve.selected.bbox`；
  - 禁止推断海军活动或碰撞风险。

### 2.9.3 `conventional-commit-helper`（约定式提交辅助）

- **触发条件**：用户请求生成 commit message、changelog 或 conventional commit。
- **允许工具**：`Read`。
- **实现方式**：纯 Prompt 规范，无独立脚本。Skill 内定义类型表、格式、语气与示例，由 LLM 直接输出符合 Conventional Commits 规范的消息。
- **关键能力**：将变更摘要或 diff 转换为 `<type>(<scope>): <subject>` 格式。
- **主要约束**：
  - 每次只选一个 type；
  - subject 使用祈使语气、小写、无句尾句号。

### 2.9.4 `csv-profile`（CSV 数据分析）

- **触发条件**：用户请求检查 CSV、汇总表格数据或验证小型数据集。
- **允许工具**：`Read`、`Bash`。
- **实现方式**：`SKILL.md` + Node.js 脚本 `scripts/profile-csv.mjs`。脚本用原生 Node.js 实现了一个支持引号转义的 CSV 解析器，输出 JSON 结构：

  ```json
  {
    "file": "path/to/file.csv",
    "rows": 100,
    "columns": 4,
    "profile": [
      { "name": "id", "missing": 0, "samples": ["1", "2"] }
    ]
  }
  ```

- **关键能力**：报告行数、列数、缺失值、样本值。
- **主要约束**：通过 `node "${SKILL_DIR}/scripts/profile-csv.mjs" "$ARGUMENTS"` 调用。

### 2.9.5 `disaster-satellite-query`（灾害卫星查询）

- **触发条件**：用户询问地震、洪水、台风、火灾、灾情、卫星影像、灾前灾后对比等。
- **数据源**：Agent Loop 域工具 `DisasterQuery`、`SatelliteImageSearch`、`ImageAnalysis`。
- **允许工具**：`RegionResolve`、`RegionMark`、`DisasterQuery`、`SatelliteImageSearch`、`ImageAnalysis`。
- **实现方式**：Prompt 驱动的多工具编排。Skill 负责把自然语言映射为工具参数（`disasterType`、`timeRange`、`bbox` 等），不直接访问数据库或外部 API。
- **关键能力**：
  - 灾害事件事实查询；
  - 卫星影像元数据/浏览器链接；
  - 可用时调用 `ImageAnalysis` 进行视觉分析。
- **主要约束**：
  - 不编造 bbox、伤亡、损失；
  - 卫星结果只是元数据或链接，不可当作可直接下载的图片；
  - 不能从元数据声称视觉损伤。

## 2.10 `skills/_archive/skills_ysq` 独立 Agent 服务

`skills/_archive/skills_ysq/` 不是 `skillManager` 扫描的标准 Skill 目录，而是一个独立的 Python FastAPI Agent 服务，主要面向“边防智能问答”业务。

### 2.10.1 整体架构

| 文件 | 作用 |
|------|------|
| `app.py` | FastAPI 应用入口，提供 REST 与 SSE 接口 |
| `config.py` | 模型、数据库、Redis、目录等配置 |
| `qa/agent_qa.py` | 基于 AgentScope 的 ReActAgent 实现 |
| `qa/system_prompt_qa.py` | 注入给 Agent 的数据库 schema 与业务规则 |
| `utils/openai_formatter_thinking.py` | 过滤 thinking block 的消息格式化器 |

### 2.10.2 `app.py`（FastAPI 应用入口）

- **框架**：FastAPI + uvicorn。
- **端点**：
  - `/customized-report`：自定义报告（流式 SSE）
  - `/daily-report`：日报生成（流式 SSE）
  - `/daily-report-direct`：日报生成（非流式，供 Dify 等外部系统）
  - `/intelligent-QA`：智能问答（流式 SSE）
  - `/intelligent-QA-direct`：智能问答（非流式，供 Dify）
  - `/figure/{filename}`：图表文件服务
  - `/md-to-docx`：Markdown 转 Word
  - `/health`：健康检查
- **定时任务**：APScheduler 每天 0 点清理超过 `RETAIN_DAYS` 天的文件。

### 2.10.3 `config.py`（配置中心）

- **模型配置**：当前默认使用阿里百练 `qwen3.5-27b`，可通过环境变量覆盖。
- **数据库**：MySQL 本地 `xjzhdd_bj`。
- **目录**：`OUTPUT_DIR`、`FIGURE_DIR`、`REPORT_DIR`。
- **Redis**：可选会话记忆，30 天 TTL，支持摘要阈值与最近轮数保留。

> 注意：文件中残留多条被注释的模型/数据库配置，建议后续清理或统一迁移到环境变量管理。

### 2.10.4 `qa/agent_qa.py`（智能问答 Agent 实现）

- **Agent 框架**：`agentscope.agent.ReActAgent` + `OpenAIChatModel`。
- **模型接口**：OpenAI 兼容 API（阿里百练）。
- **工具**：
  - MySQL 查询执行器（`WithOutputStoreSqlExecutor`）
  - Matplotlib 图表生成（柱状图、折线图、饼图）
- **安全控制**：
  - `is_sql_safe` 正则拦截 DDL/DML 关键字；
  - `execute_sql_tool` 分 valid/secure/execute 三阶段校验。
- **特殊处理**：
  - 自我介绍拦截；
  - 无关问题拦截；
  - 当前日期注入，避免模型默认使用错误年份。

### 2.10.5 `qa/system_prompt_qa.py`（系统提示词）

- **内容**：大量边防业务数据库表结构定义，如 `alarm_event`、`buckle_access_record`、`tb_device`、`sys_dept` 等。
- **用途**：注入给 ReActAgent，让模型理解 schema 并生成 MySQL SQL。
- **Few-shot**：包含时空分布、设备位置、在线率、告警结构、处理时效、卡口流量等示例。
- **约束**：纯中文输出、仅允许 SELECT、一次只调用一个工具、空结果用自然语言说明。

> 注意：表结构硬编码在 Prompt 字符串中，数据库变更时需要同步更新该文件。

### 2.10.6 `utils/openai_formatter_thinking.py`

继承 `OpenAIChatFormatter`，在格式化消息前过滤掉 `thinking` content block，避免 AgentScope 原实现因 OpenAI API 不支持 `reasoning_content` 而报警告。

## 2.11 标准 Skills 与 `skills/_archive/skills_ysq` 对比

| 维度 | `skills/` 标准 Skills | `skills/_archive/skills_ysq/` |
|------|----------------------|---------------|
| 注册方式 | `skillManager.ts` 自动扫描 `SKILL.md` | 独立 Python 服务，不注册到 Agent Loop |
| 主要形态 | Markdown + 少量脚本 | Python 代码 + Prompt + 配置 |
| Agent 框架 | 由 Agent Loop 统一调度 | AgentScope `ReActAgent` |
| 模型接入 | 由外层 Agent Loop 决定 | 直连阿里百练 OpenAI 兼容 API |
| 数据访问 | 通过 `SqlQuery` 等域工具 | 直接 PyMySQL 连接 MySQL |
| 可视化 | 无 | Matplotlib 生成图表 |
| 适用场景 | GIS/航空/海事/灾害等通用能力 | 边防业务智能问答与报告 |
| 可复用性 | 高，遵循项目统一 Skill 协议 | 低，属于独立垂直服务 |

## 2.12 维护建议

1. **`skills/_archive/skills_ysq` 与 Agent Loop 的关系**：`skills/_archive/skills_ysq` 不会被 Kimi Code CLI 的 `Skill` 工具自动加载；如需让 Agent Loop 使用，应额外封装为 MCP 工具或 HTTP 工具。
2. **Schema 管理**：`skills/_archive/skills_ysq` 的数据库表结构硬编码在 `system_prompt_qa.py` 中，后续建议引入动态 schema 发现或版本同步机制。
3. **配置清理**：`config.py` 中残留多组被注释的模型/数据库配置，建议清理或迁移到独立配置文件/环境变量。
4. **标准 Skill 扩展**：新增标准 Skill 时，优先复用现有域工具（如 `SqlQuery`、`RegionResolve`），保持声明式、低代码的风格。
