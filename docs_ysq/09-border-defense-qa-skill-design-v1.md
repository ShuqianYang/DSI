# 九、`border-defense-qa` Skill 设计方案（v1）

## 9.1 背景与目标

将 `skills_ysq` 中的边防智能问答能力改造为一个符合项目规范的 Skill，使其能够被 Agent Loop 的 `Skill` 工具自动发现和调用。

- **目标目录**：`skills/border-defense-qa/`
- **参考模式**：`csv-profile`（脚本型 Skill）
- **版本**：v1
- **日期**：2026-06-16

## 9.2 设计决策（已确认）

| 决策项 | 最终选择 |
|--------|----------|
| 整体方案 | 方案 A：脚本型 Skill（Bash 调用 Python） |
| Agent 框架 | 继续使用 AgentScope 的 `ReActAgent` |
| Agent 结构 | 保留 `data_agent` + `figure_report_agent` 双 Agent 分离 |
| 图表生成 | 保留 Matplotlib 柱状图/折线图/饼图 |
| 数据库凭证 | 读取环境变量 |
| 前置拦截 | 保留自我介绍 + 无关问题拦截 |
| 输出格式 | Markdown 文本 |
| 文件输出 | 仅生成图表 PNG 到 Skill 输出目录 |

## 9.3 候选方案对比

### 方案 A：脚本型 Skill（已选）

**实现方式**：
- 创建 `SKILL.md` + `scripts/border-defense-qa.py`；
- 通过 Bash 调用 Python 脚本；
- 脚本内部完成意图拦截 → NL2SQL → SQL 安全校验 → MySQL 查询 → 图表生成 → Markdown 回答。

**允许工具**：`Read`, `Bash`

**优点**：
- 最接近现有 Skill 规范，与 `csv-profile` 同构；
- 对 Agent Loop 侵入最小；
- 可最大程度复用 `skills_ysq` 的 Python 代码。

**缺点**：
- 依赖 Bash 工具（风险等级 high）；
- 脚本作为子进程运行，与 Agent Loop 上下文隔离；
- 需要运行环境已安装 Python 依赖包。

### 方案 B：新增域工具 + 声明式 Skill

**实现方式**：
- 在 `api/src/modules/agent-loop/tools/domain/` 下新增 MySQL 查询工具、MySQL schema 工具、图表生成工具；
- `SKILL.md` 变为纯声明式，描述表结构、SQL 模板、图表规则。

**允许工具**：`Read`, `SqlQuerySchemaMySQL`, `SqlQueryMySQL`, `ChartGenerate`

**优点**：
- 与 `aircraft-region-query`、`ais-region-query` 风格一致；
- 工具可复用、权限可控、审计更清晰；
- 不依赖 Bash。

**缺点**：
- 需要修改 Agent Loop 核心代码；
- 工程量大，需将多 Agent 逻辑拆分到 Prompt 中；
- 图表生成工具需要额外开发。

### 方案 C：HTTP 后端型 Skill

**实现方式**：
- 保留 `skills_ysq/app.py` 作为后台服务；
- 新增域工具 `BorderDefenseQaQuery` 调用 `/intelligent-QA-direct` 接口；
- `SKILL.md` 仅负责调用该工具。

**允许工具**：`BorderDefenseQaQuery`

**优点**：
- 对 `skills_ysq` 代码改动最小；
- 可完整复用现有功能。

**缺点**：
- Skill 依赖外部服务运行，不够自包含；
- 需要单独启动 `skills_ysq` 服务；
- 与“标准 Skill”理念偏离较大。

### 选择理由

选择 **方案 A**，原因：
1. 与现有 `csv-profile` 模式一致，改动范围可控；
2. 可快速落地验证；
3. 后续如需要，可再升级为方案 B 的域工具模式。

## 9.4 详细设计

### 9.4.1 目录结构

```
skills/border-defense-qa/
├── SKILL.md
├── scripts/
│   ├── border-defense-qa.py          # 主执行脚本
│   ├── prompts.py                    # 系统提示词
│   └── openai_formatter_thinking.py  # thinking block 过滤格式化器
└── output/
    └── .gitkeep
```

### 9.4.2 核心流程

```
用户提问
   │
   ▼
[前置拦截] ──► 自我介绍 / 无关问题直接返回
   │
   ▼
data_agent（数据分析智能体）
   │   ├─ 理解自然语言
   │   ├─ 生成 MySQL SQL
   │   └─ 调用 execute_sql_tool 执行
   │
   ▼
figure_report_agent（画图与回答撰写智能体）
   │   ├─ 根据数据选择图表类型
   │   ├─ 调用 create_bar_chart / create_line_chart / create_pie_chart
   │   └─ 生成最终 Markdown 回答
   │
   ▼
输出 Markdown 到 stdout，图表 PNG 保存到 output/
```

### 9.4.3 安全机制

- SQL 执行器 `WithOutputStoreSqlExecutor` 分三阶段校验：
  1. `valid()`：清理 Markdown 代码块标记和 SQL 前缀；
  2. `secure()`：正则拦截 DDL/DML 关键字；
  3. `execute()`：使用 PyMySQL + pandas 执行只读查询。
- 任何非 `SELECT` 语句都会返回 `security_rejected` 错误。

### 9.4.4 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `BORDER_DEFENSE_DB_HOST` | `127.0.0.1` | MySQL 主机 |
| `BORDER_DEFENSE_DB_PORT` | `3306` | MySQL 端口 |
| `BORDER_DEFENSE_DB_USER` | — | MySQL 用户 |
| `BORDER_DEFENSE_DB_PASSWORD` | — | MySQL 密码 |
| `BORDER_DEFENSE_DB_NAME` | — | MySQL 数据库 |
| `MODEL` | `qwen3.5-27b` | LLM 模型 |
| `API_KEY` | — | LLM API Key |
| `MODEL_SERVER` | `https://dashscope.aliyuncs.com/compatible-mode/v1` | 模型服务地址 |

### 9.4.5 依赖包

脚本依赖以下 Python 包（与 `skills_ysq` 一致）：

- `agentscope==1.0.16`（⚠️ 必须使用 1.x 版本，2.x API 不兼容）
- `pymysql`
- `pandas`
- `matplotlib`
- `numpy`

## 9.5 排除范围

本版本明确排除以下内容：

- 可选的明细查询/时空数据流程（`data_detail_agent`）
- Redis 会话记忆
- 日报/自定义报告接口
- 流式输出（仅保留同步调用）

## 9.6 验证状态

| 检查项 | 状态 |
|--------|------|
| 目录结构创建 | ✅ 完成 |
| `SKILL.md` 编写 | ✅ 完成 |
| 主脚本编写 | ✅ 完成 |
| 提示词提取 | ✅ 完成 |
| 语法检查（`py_compile`） | ✅ 通过 |
| 运行时功能测试 | ⏸️ 未执行（当前环境缺少 `agentscope` 等依赖） |

## 9.7 使用示例

### 直接运行

```bash
export BORDER_DEFENSE_DB_USER=root
export BORDER_DEFENSE_DB_PASSWORD=root
export BORDER_DEFENSE_DB_NAME=xjzhdd_bj
export API_KEY=your_api_key

python skills/border-defense-qa/scripts/border-defense-qa.py "统计本月各级预警数量"
```

### Agent Loop 调用

```json
{"skill": "border-defense-qa", "args": "统计本月各级预警数量"}
```

## 9.8 已知问题与后续优化

1. **依赖环境**：脚本运行需要安装 `agentscope` 等 Python 包，当前开发环境未安装，需在实际运行环境中验证。
2. **Bash 依赖**：脚本通过 Bash 调用，受 Agent Loop Bash 工具的策略和超时限制。
3. **SQL 安全**：当前使用正则黑名单，未来可升级为 AST 解析。
4. **Schema 维护**：数据库表结构硬编码在 `prompts.py` 中，表结构变更时需同步更新。
5. **图表路径**：图表保存到 Skill 的 `output/` 目录，Markdown 中引用相对路径，需确认 Agent Loop 展示时能正确解析。
6. **升级路径**：如后续需要更好的工具化，可按方案 B 将 SQL 执行和图表生成提升为独立域工具。
