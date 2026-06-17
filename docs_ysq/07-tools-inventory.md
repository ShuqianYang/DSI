# 七、工具清单与 Skill 调用关系

## 7.1 工具总览

Agent Loop 中的工具分为三类：

| 类别 | 数量 | 注册位置 | 说明 |
|------|------|----------|------|
| **系统工具（System Tools）** | 9 | `api/src/modules/agent-loop/tools/system/index.ts` | 文件、Shell、Web 等基础能力 |
| **域工具（Domain Tools）** | 8 | `api/src/modules/agent-loop/tools/domain/index.ts` | 面向业务的数据/GIS/灾害/卫星能力 |
| **Skill 工具** | 1 | `api/src/modules/agent-loop/skillManager.ts` | 加载并执行 `skills/` 目录下的 Skill |

另有 43 个工具仅在 `systemToolCatalog.ts` 中作为 Claude Code 参考目录存在，**未在本项目实际注册**，不可调用。

---

## 7.2 系统工具

### 文件类工具

| 工具名 | 定义文件 | 功能 | 读/写 | 并发 | 风险 |
|--------|----------|------|-------|------|------|
| **Read** | `tools/system/file.ts` | 读取工作区文本文件（最大 200 KB），支持行级偏移/限制 | 只读 | 安全 | low |
| **Write** | `tools/system/file.ts` | 创建或覆盖工作区文件 | 写入 | 不安全 | high |
| **Edit** | `tools/system/file.ts` | 基于精确字符串匹配替换文件内容 | 写入 | 不安全 | high |
| **Glob** | `tools/system/file.ts` | 按 glob 模式查找文件，最多返回 100 个 | 只读 | 安全 | low |
| **Grep** | `tools/system/file.ts` | 使用 ripgrep 搜索文件内容 | 只读 | 安全 | low |

### Shell 与自动化工具

| 工具名 | 定义文件 | 功能 | 读/写 | 并发 | 风险 |
|--------|----------|------|-------|------|------|
| **Bash** | `tools/system/shell.ts` | 执行 shell 命令，限制在工作区内，禁止重定向、命令替换、git 变更等 | 依输入 | 不安全 | high |
| **Sleep** | `tools/system/automation.ts` | 等待指定毫秒数 | — | 安全 | low |

### 任务与 Web 工具

| 工具名 | 定义文件 | 功能 | 读/写 | 并发 | 风险 |
|--------|----------|------|-------|------|------|
| **TodoWrite** | `tools/system/task.ts` | 替换会话 TODO 列表 | 写入 | 不安全 | low |
| **WebSearch** | `tools/system/web.ts` | 通过搜索 API 搜索网页 | 只读 | 安全 | medium |
| **WebFetch** | `tools/system/web.ts` | 抓取指定 URL 文本内容 | 只读 | 安全 | medium |

---

## 7.3 域工具

### SQL 数据查询

| 工具名 | 定义文件 | 功能 | 关键参数 | 风险 |
|--------|----------|------|----------|------|
| **SqlQuerySchema** | `tools/domain/sql/schema.ts` | 查询允许列表内 PostgreSQL schema 的表、列、外键关系 | `database`, `schema`, `table?` | low |
| **SqlQuery** | `tools/domain/sql/query.ts` | 执行只读 `SELECT`/`WITH` SQL，大结果集写入 JSONL artifact | `database`, `sql`, `limit?`, `offset?`, `timeout_ms?` | medium |

**SqlQuery 安全机制**：
- 仅接受单条语句；
- 正则拦截 DML/DDL/锁/管理操作；
- 禁止 `dblink`、`lo_*`、`pg_terminate_backend` 等危险函数；
- 禁止访问 `information_schema`、`pg_catalog` 等系统 schema；
- 外层自动包裹 `LIMIT/OFFSET`；
- 通过 `EXPLAIN (FORMAT JSON)` 检查并拒绝 Foreign Data Wrapper 计划。

### GIS 与区域工具

| 工具名 | 定义文件 | 功能 | 关键参数 | 风险 |
|--------|----------|------|----------|------|
| **RegionResolve** | `tools/domain/gis/regionResolve.ts` | 将地名解析为 bbox 与 geometry 引用 | `regionName`, `query`, `maxCandidates?` | low |
| **RegionMark** | `tools/domain/gis/regionMark.ts` | 在 GIS 地图上创建可视化区域图层 | `name`, `geometryRef?`, `bbox?`, `polygon?`, `regionType?` | low |

### 气象与灾害工具

| 工具名 | 定义文件 | 功能 | 关键参数 | 风险 |
|--------|----------|------|----------|------|
| **WeatherFetch** | `tools/domain/weather/weather.ts` | 从 Open-Meteo 获取风场/洋流数据 | `center?`, `bbox?`, `grid?`, `lookbackDays?` | low |
| **DisasterQuery** | `tools/domain/disaster/disaster.ts` | 查询 USGS/GDACS 公开灾害事件 | `regionName?`, `bbox?`, `disasterType`, `timeRange?` | low |
| **SatelliteImageSearch** | `tools/domain/satellite/satellite.ts` | 在 Copernicus STAC 搜索 Sentinel-2/Landsat 影像元数据 | `bbox`, `startDate?`, `endDate?`, `maxCloudCoverage?`, `source?` | low |
| **ImageAnalysis** | `tools/domain/satellite/imageAnalysis.ts` | 使用 Qwen 视觉模型分析卫星影像 | `imageUrls`, `analysisType?`, `context?` | low |

---

## 7.4 Skill 工具

| 工具名 | 定义文件 | 功能 | 关键参数 | 风险 |
|--------|----------|------|----------|------|
| **Skill** | `api/src/modules/agent-loop/skillManager.ts` | 按名称加载 `skills/` 目录下的 Markdown Skill，注入指令并限制可用工具 | `skill`, `args?` | low |

Skill 工具的运行时行为：
1. 扫描工作区根目录 `skills/`；
2. 将可用 Skill 摘要注入 system prompt；
3. 模型选择 Skill 后，加载其完整内容；
4. 替换 `$ARGUMENTS`、`${SKILL_DIR}` 等变量；
5. 执行嵌入的 shell 命令（如 `csv-profile` 的 Node 脚本）；
6. 将 Skill 声明的 `allowed-tools` 设为下一回合可用工具白名单。

---

## 7.5 Skill 与工具调用关系

下表列出每个标准 Skill 调用的工具：

| Skill | 所在目录 | 调用的工具 | 说明 |
|-------|----------|------------|------|
| **aircraft-region-query** | `skills/aircraft-region-query/` | `Read`, `SqlQuerySchema`, `SqlQuery` | 先查 schema 确认表结构，再执行 bbox 内航班查询 |
| **ais-region-query** | `skills/ais-region-query/` | `Read`, `SqlQuerySchema`, `SqlQuery` | 同上，针对 `ais_current_states` 表 |
| **conventional-commit-helper** | `skills/conventional-commit-helper/` | `Read` | 读取 diff 或变更摘要后生成提交信息 |
| **csv-profile** | `skills/csv-profile/` | `Read`, `Bash` | 通过 Bash 调用 `scripts/profile-csv.mjs` 分析 CSV |
| **disaster-satellite-query** | `skills/disaster-satellite-query/` | `RegionResolve`, `RegionMark`, `DisasterQuery`, `SatelliteImageSearch`, `ImageAnalysis` | 地名解析、地图标记、灾害事实、卫星影像、视觉分析 |

**通用规则**：
- 未加载 Skill 时，Agent 可使用所有系统工具和域工具；
- 加载 Skill 后，下一回合只能使用 Skill 白名单中的工具（加上 `Skill` 工具本身）；
- `skills_ysq/` 下的 Python Agent 服务**不经过** Agent Loop 的 Skill 工具调用，而是独立运行，直接操作 MySQL 与 Matplotlib。

---

## 7.6 工具注册流程

```
buildDefaultToolRegistry()
    ├── registerSystemTools(registry)        # 注册 9 个系统工具
    └── registerDomainTools(registry)        # 注册 8 个域工具

runAgentLoop()
    └── registerSkillTool(registry, skillManager)  # 注册 Skill 工具

ToolGateway.callTool(name)
    ├── 按 name/alias 查找 ToolDefinition
    ├── Zod schema 校验
    ├── validateInput()
    ├── checkPermissions()
    ├── execute()
    ├── 结果大小限制处理
    └── 返回 ToolObservation
```

---

## 7.7 目录-only 工具（不可调用）

`api/src/modules/agent-loop/systemToolCatalog.ts` 中保留了 43 个 Claude Code 参考工具条目，用于目录/元数据对照，**未在 `ToolRegistry` 中注册**。主要类别包括：

- **Agent / Task**：`Agent`, `TaskOutput`, `TaskCreate`, `TaskGet`, `TaskUpdate`, `TaskList`, `TaskStop`
- **计划与沟通**：`EnterPlanMode`, `ExitPlanMode`, `AskUserQuestion`, `SendMessage`, `SendUserMessage`
- **MCP**：`ListMcpResourcesTool`, `ReadMcpResourceTool`, `ToolSearch`, `MCPTool`
- **自动化**：`CronCreate`, `CronDelete`, `CronList`, `RemoteTrigger`, `Monitor`, `Workflow`
- **上下文/团队/工作区**：`LSP`, `CtxInspect`, `TerminalCapture`, `TeamCreate`, `TeamDelete`, `EnterWorktree`

这些工具在当前 Agent Loop 中不可直接调用；如需使用，需额外实现并注册。

---

## 7.8 维护建议

1. **新增域工具**：优先在 `tools/domain/` 下按业务领域分组，然后在 `tools/domain/index.ts` 中注册。
2. **新增 Skill**：在 `skills/<skill-name>/SKILL.md` 中声明，通过 `allowed-tools` 精确限制所需工具，避免暴露不必要能力。
3. **SQL 工具配置**：通过环境变量配置数据库别名与 schema 白名单：`DATABASE_URL`、`AGENT_SQL_DATABASE_URLS`、`AGENT_SQL_ALLOWED_SCHEMAS`。
4. **catalog-only 工具**：如果未来需要启用 `Task`、`Cron` 等高级工具，应在 `tools/` 下实现具体 builder，并在注册流程中加入，而不是直接依赖 catalog 元数据。
