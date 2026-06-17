# 八、`skills_ysq` Agent 实现逻辑分析

## 8.1 总体架构

`skills_ysq` 是一个**独立的 Python FastAPI Agent 服务**，专门面向“边防智能问答”业务。它不遵循项目根 `skills/` 目录的 `SKILL.md` 规范，也不被 Agent Loop 的 `skillManager` 自动加载。

核心文件：

| 文件 | 职责 |
|------|------|
| `app.py` | FastAPI 入口，提供 REST/SSE 接口、定时任务、CORS、文件服务 |
| `config.py` | 模型、MySQL、Redis、目录等配置中心 |
| `qa/agent_qa.py` | 多 Agent 编排核心：SQL 生成、执行、图表绘制、回答生成 |
| `qa/system_prompt_qa.py` | 多个系统提示词，注入数据库 schema 与业务规则 |
| `utils/openai_formatter_thinking.py` | 过滤 thinking block 的 OpenAI 消息格式化器 |

> 注：`agent_qa.py` 还依赖 `utils.stream_output`、`utils.md_to_docx`、`utils.streaming_hook_thinking_merge`、`utils.util` 等模块，这些文件不在 `skills_ysq/` 内，而是部署时通过 Python 路径引入。

---

## 8.2 `app.py` —— FastAPI 服务层

### 8.2.1 核心端点

| 端点 | 模式 | 用途 |
|------|------|------|
| `POST /customized-report` | 流式 SSE | 自定义报告生成 |
| `POST /daily-report` | 流式 SSE | 日报生成（支持 `report_type`: all/buckle/event） |
| `POST /daily-report-direct` | 同步 JSON | 日报生成，供 Dify 等外部系统调用 |
| `POST /intelligent-QA` | 流式 SSE | 智能问答 |
| `POST /intelligent-QA-direct` | 同步 JSON | 智能问答，供 Dify 调用 |
| `GET /figure/{filename}` | 文件下载 | 获取 Matplotlib 生成的图表 |
| `POST /md-to-docx` | 文件下载 | Markdown 转 Word |
| `GET /health` | JSON | 健康检查 |

### 8.2.2 流式输出机制

流式接口通过 `uuid.uuid4()` 生成 `stream_id`，创建队列，并启动后台 `asyncio.create_task(...)` 执行 Agent，最终返回 `StreamingResponse(..., media_type="text/event-stream")`。

### 8.2.3 定时清理任务

使用 `APScheduler` 每天 0 点清理 `FIGURE_DIR`、`OUTPUT_DIR`、`REPORT_DIR` 中超过 `RETAIN_DAYS`（默认 30 天）的文件。

### 8.2.4 CORS

当前配置为 `allow_origins=["*"]`，属于开发环境配置。

---

## 8.3 `config.py` —— 配置中心

### 8.3.1 模型配置

当前默认使用阿里百练的 `qwen3.5-27b`：

```python
MODEL = os.getenv("MODEL", "qwen3.5-27b")
API_KEY = os.getenv("API_KEY", "sk-ab87a04cd02e40108feb4117f4e9d2b0")
MODEL_SERVER = os.getenv("MODEL_SERVER", "https://dashscope.aliyuncs.com/compatible-mode/v1")
```

文件中残留大量被注释的模型配置（成务、开物、千问、ollama、智算服务器等），说明经过多轮环境切换。

### 8.3.2 数据库配置

连接本地 MySQL `xjzhdd_bj`：

```python
DB_CONFIG = {
    'user': os.getenv("DB_CONFIG_USER", 'root'),
    'password': os.getenv("DB_CONFIG_PWD", 'root'),
    'host': os.getenv("DB_CONFIG_HOST", '127.0.0.1'),
    'port': int(os.getenv("DB_CONFIG_PORT", 3306)),
    'database': os.getenv("DB_CONFIG_DATABASE", 'xjzhdd_bj'),
    'charset': os.getenv("DB_CONFIG_CHARSET", 'utf8mb4')
}
```

---

## 8.4 `qa/agent_qa.py` —— 多 Agent 核心实现

这是整个 `skills_ysq` 最复杂的文件（约 2250 行），基于 **AgentScope** 框架构建。

### 8.4.1 多 Agent 协作流程

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
可选：data_detail_agent（数据明细/时空查询智能体）
   │   ├─ 改写用户输入为明细查询
   │   ├─ 生成 SQL
   │   └─ 提取 data_detail_type/pk/longitude/latitude
   │
   ▼
合并问答数据与时空数据（如启用 QA_REPORT_DATA_DETAIL_STATUS）
   │
   ▼
figure_report_agent（画图与回答撰写智能体）
   │   ├─ 根据数据选择图表类型
   │   ├─ 调用 create_bar_chart / create_line_chart / create_pie_chart
   │   └─ 生成最终 Markdown 回答
   │
   ▼
返回给用户（流式 SSE 或同步 JSON）
```

### 8.4.2 Agent 创建函数

| 函数 | Agent 名称 | 工具 | 最大迭代 |
|------|-----------|------|---------|
| `create_data_agent` | 数据分析智能体 | `execute_sql_tool` | 3 |
| `create_data_detail_query_rewrite_agent` | 用户输入重写智能体 | 无（纯 LLM） | 5 |
| `create_data_detail_agent` | 数据明细查询智能体 | `execute_sql_tool` | 5 |
| `create_figure_report_agent` | 画图与回答撰写智能体 | `create_line_chart`, `create_bar_chart`, `create_pie_chart` | 2 |

所有 Agent 均使用：
- `OpenAIChatModel`（兼容 OpenAI API）
- `OpenAIChatFormatterWithThinking`
- `InMemoryMemory`
- `parallel_tool_calls=False`

### 8.4.3 SQL 执行器 `WithOutputStoreSqlExecutor`

这是数据安全与执行的核心封装：

```python
class WithOutputStoreSqlExecutor:
    def valid(self, sql):      # 清理 Markdown 代码块、SQL 前缀
    def secure(self, sql):     # 正则拦截 DDL/DML 关键字
    def execute(self, sql):    # PyMySQL 连接 + pandas.read_sql
    def execute_sql_tool(self, sql):  # valid → secure → execute
```

**安全规则**：
- 禁止 `DELETE`, `INSERT`, `UPDATE`, `DROP`, `ALTER`, `CREATE`, `REPLACE`, `TRUNCATE`, `GRANT`, `REVOKE` 等；
- 检测到危险操作时返回 `security_rejected`，并在输出中记录 `sql_info`；
- 执行成功后自动将结果写入 CSV 文件，并返回 JSON 列表。

### 8.4.4 图表生成工具

三个 Matplotlib 绘图函数：

| 函数 | 图表类型 | 输出 |
|------|---------|------|
| `create_bar_chart` | 柱状图 | 保存为 PNG，返回 `img_generation_url` |
| `create_line_chart` | 折线图 | 同上 |
| `create_pie_chart` | 饼状图 | 同上 |

特点：
- 使用 `WenQuanYi Zen Hei` 字体支持中文；
- 强制 Y 轴为整数刻度（柱状图）；
- 数据点标注数值（折线图）；
- 图表保存到 `FIGURE_DIR`。

### 8.4.5 前置拦截逻辑

#### 自我介绍拦截

```python
is_self_introduction_query(query)  # 关键词匹配
```

命中后返回预设的 `SELF_INTRODUCTION_TEXT`。

#### 无关问题拦截

```python
is_irrelevant_query(query)
```

- 若包含数据意图关键词（预警、设备、卡口、统计等），放行；
- 若不含数据意图关键词但含无关关键词（天气、新闻、代码、美食等），拦截；
- 两者都不含时，交给大模型判断（不拦截）。

### 8.4.6 当前时间注入

```python
def get_current_date_hint() -> str:
    return f"【重要时间参考】当前系统日期是 {now.strftime('%Y年%m月%d日')} ..."
```

所有 Agent 的系统提示词都会附加当前日期，避免模型默认查询 2024 年等错误年份。

### 8.4.7 流式与非流式两种模式

| 函数 | 用途 | 特点 |
|------|------|------|
| `generate_report(stream_id, user_query)` | 流式 SSE | 使用 `stream_printing_messages` + `_stream_hook` 推送事件 |
| `generate_report_sync(user_query)` | 同步调用 | 直接 `await agent(...)`，返回 Markdown 字符串 |
| `generate_report_data_detail(stream_id, user_query)` | 流式明细查询 | 用于时空数据补充 |
| `generate_report_data_detail_sync(user_query)` | 同步明细查询 | 供 `generate_report_sync` 调用 |

### 8.4.8 数据合并逻辑（`QA_REPORT_DATA_DETAIL_STATUS`）

当启用明细查询时：

1. `data_agent` 生成并执行主查询 SQL；
2. `data_detail_agent` 将用户问题改写为明细查询，生成并执行 SQL；
3. 使用 `WITH ... LEFT JOIN ... ON 1 = 0 UNION RIGHT JOIN ... ON 1 = 0` 合并两个结果集；
4. 解析合并结果，区分：
   - `report_data_all`：普通问答数据；
   - `report_data_detail_all`：含 `data_detail_type`、`data_detail_pk`、`data_detail_longitude`、`data_detail_latitude` 的时空数据；
5. 将两类数据一起交给 `figure_report_agent`。

### 8.4.9 调试入口

文件末尾提供 `if __name__ == "__main__"` 调试入口，默认执行 `debug_generate_report_sync()`，批量测试 `TEST_QUERIES` 中的问题。

---

## 8.5 `qa/system_prompt_qa.py` —— 提示词工程

该文件包含多个系统提示词字符串：

| 提示词变量 | 用途 |
|-----------|------|
| `sys_prompt_data_detail_query_rewrite` | 明细查询的用户输入改写 |
| `sys_prompt_data_detail_merge_sql_operation` | 明细查询的 SQL 生成与执行 |
| `sys_prompt_data_merge_sql_operation` | 主流程 SQL 生成与执行 |
| `sys_prompt_figure_report` | 图表绘制与最终回答撰写 |

### 8.5.1 Schema 硬编码

提示词中直接写入了大量 MySQL 表结构定义，包括：

- `alarm_event`（预警事件）
- `attendance_record`（考勤记录）
- `buckle_access_list`（卡口往来名单）
- `buckle_access_record`（卡口往来记录）
- `buckle_access_stay_time`（滞留时长设置）
- `buckle_info`（卡口信息）
- `sys_dept`（部门）
- `sys_role`（角色）
- `tb_device`（技防设备）
- `make_rounds_record`（巡逻记录）

### 8.5.2 Few-shot 示例

每个提示词都包含多个 SQL 生成示例，覆盖：

- 时空分布分析
- 预警分级统计
- 设备效能 Top N
- 多表联查
- 处理效率评估
- 卡口流量统计
- 滞留风险研判
- 黑名单预警

### 8.5.3 关键约束

- 只允许 `SELECT` 语句；
- 一次只能调用一个工具；
- 思考过程必须使用中文；
- 空结果时用自然语言说明，禁止输出 `{"status": "success", "result": []}`；
- 术语区分：“处置”对应 `dispose_xxx`，“处理”对应 `handle_xxx`。

---

## 8.6 `utils/openai_formatter_thinking.py` —— 消息格式化补丁

继承 AgentScope 的 `OpenAIChatFormatter`，在格式化消息前过滤掉 `type == "thinking"` 的 content block。原因是 OpenAI API 不支持输入消息携带 `reasoning_content`，原实现会打印 warning。

---

## 8.7 关键问题与改进建议

### 8.7.1 架构层面

- **与 Agent Loop 割裂**：`skills_ysq` 是独立服务，无法被项目主 Agent Loop 通过 `Skill` 工具调用。如需集成，应封装为 HTTP/MCP 工具。
- **代码高度集中**：`agent_qa.py` 长达 2250 行，职责过重，建议拆分为多个模块。

### 8.7.2 安全层面

- SQL 安全仅依赖关键字黑名单，存在一定绕过风险；
- `figure_report_agent` 的 `http_client` 设置了 `verify=False`，存在 SSL 校验风险；
- `app.py` 中 CORS 为 `allow_origins=["*"]`，生产环境需收紧。

### 8.7.3 维护层面

- 数据库 schema 硬编码在提示词中，表结构变更时需同步修改 `system_prompt_qa.py`；
- `config.py` 中残留大量被注释的配置，建议清理；
- `qa_report_data_detail` 的合并 SQL 使用 `LEFT JOIN ... ON 1 = 0 UNION RIGHT JOIN ... ON 1 = 0`，逻辑较 trick，可读性和可维护性较差。

### 8.7.4 工程层面

- 缺少单元测试和类型注解；
- 流式与非流式代码存在大量重复，建议抽象统一；
- 错误处理主要依赖 `try/except + print`，建议引入结构化日志。
