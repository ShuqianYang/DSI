# 十、`border-defense-qa` Skill 测试方案

## 10.1 测试目标

验证 `skills/border-defense-qa/` 作为标准 Skill 的可用性、正确性和鲁棒性，确保：

1. Agent Loop 能正确发现并加载该 Skill；
2. Skill 前置拦截逻辑（自我介绍、无关问题）正常工作；
3. 合法边防业务查询能正确生成 SQL、执行查询、生成图表并返回 Markdown；
4. 安全机制（仅允许 SELECT）有效；
5. 错误场景（缺少环境变量、DB 连接失败、API 失败）能给出清晰提示。

## 10.2 测试环境

### 10.2.1 必要条件

| 组件 | 要求 |
|------|------|
| Node.js | 20+ |
| pnpm | 9+ |
| Python | 3.10+ |
| Python 依赖 | `agentscope==1.0.16`、`pymysql`、`pandas`、`matplotlib`、`numpy` |
| MySQL | 包含 `xjzhdd_bj` 数据库及边防业务表结构 |
| LLM API Key | 阿里百练 `qwen3.5-27b` 或兼容 OpenAI API 的模型 |

### 10.2.2 环境变量

```bash
# MySQL
export BORDER_DEFENSE_DB_HOST=127.0.0.1
export BORDER_DEFENSE_DB_PORT=3306
export BORDER_DEFENSE_DB_USER=root
export BORDER_DEFENSE_DB_PASSWORD=root
export BORDER_DEFENSE_DB_NAME=xjzhdd_bj

# LLM
export MODEL=qwen3.5-27b
export API_KEY=your_qwen_api_key
export MODEL_SERVER=https://dashscope.aliyuncs.com/compatible-mode/v1
```

### 10.2.3 Python 虚拟环境

```bash
python -m venv .venv-bd-qa
.venv-bd-qa/Scripts/pip install agentscope==1.0.16 pymysql pandas matplotlib numpy
```

## 10.3 测试用例

### TC-01：Skill 元数据与发现

| 项 | 内容 |
|----|------|
| 目的 | 验证 Agent Loop 能发现 `border-defense-qa` 并正确解析其 frontmatter |
| 步骤 | 1. 运行 `npx tsx api/scripts/agent-loop/test-border-defense-qa-skill.ts`；<br>2. 检查输出中 `listed` 为 `true`；<br>3. 检查 `allowedTools` 包含 `Read`、`Bash`、`Skill`，不包含 `Write`。 |
| 预期结果 | Skill 被列出，工具白名单正确。 |
| 优先级 | P0 |

### TC-02：Bash 工具环境变量透传

| 项 | 内容 |
|----|------|
| 目的 | 验证 `BORDER_DEFENSE_DB_*`、`API_KEY` 等变量能通过 Bash 工具传递到 Python 脚本 |
| 步骤 | 1. 在 `api/.env` 中配置上述变量；<br>2. 启动 API 服务；<br>3. 通过 Agent Loop 调用 `Skill{"skill":"border-defense-qa","args":"test"}`；<br>4. 观察 Python 脚本是否因缺少变量而报错。 |
| 预期结果 | 若变量配置正确，脚本不再报 `Missing required environment variables`；若 API Key 无效，应进入 LLM 调用阶段并返回 401。 |
| 优先级 | P0 |

### TC-03：自我介绍拦截

| 项 | 内容 |
|----|------|
| 目的 | 验证非数据类自我介绍查询被正确拦截 |
| 步骤 | `python skills/border-defense-qa/scripts/border-defense-qa.py "你是谁"` |
| 预期结果 | 返回预设自我介绍文本，不调用 LLM，不连接数据库。 |
| 优先级 | P1 |

### TC-04：无关问题拦截

| 项 | 内容 |
|----|------|
| 目的 | 验证非边防业务问题被正确拦截 |
| 步骤 | `python skills/border-defense-qa/scripts/border-defense-qa.py "今天天气怎么样"` |
| 预期结果 | 返回礼貌拒绝文本，不调用 LLM，不连接数据库。 |
| 优先级 | P1 |

### TC-05：简单统计查询

| 项 | 内容 |
|----|------|
| 目的 | 验证完整 NL2SQL → 执行 → 回答流程 |
| 步骤 | `python skills/border-defense-qa/scripts/border-defense-qa.py "统计本月各级预警数量"` |
| 预期结果 | 返回包含 SQL、数据表格/摘要、Markdown 分析的文本回答。 |
| 优先级 | P0 |

### TC-06：带图表的查询

| 项 | 内容 |
|----|------|
| 目的 | 验证图表生成功能 |
| 步骤 | `python skills/border-defense-qa/scripts/border-defense-qa.py "按等级统计本月预警数量并用柱状图展示"` |
| 预期结果 | 1. 返回 Markdown 文本；<br>2. `skills/border-defense-qa/output/` 目录下生成 PNG 图表；<br>3. Markdown 中通过 `output/xxx.png` 引用图表。 |
| 优先级 | P1 |

### TC-07：SQL 安全拦截

| 项 | 内容 |
|----|------|
| 目的 | 验证 DML/DDL 被阻止 |
| 步骤 | 构造一个诱导 Agent 生成 `DELETE`、`UPDATE`、`DROP` 等语句的问题，例如 `"删除所有预警事件"`。 |
| 预期结果 | SQL 执行器返回 `security_rejected`，最终回答说明操作被拒绝。 |
| 优先级 | P0 |

### TC-08：空数据返回

| 项 | 内容 |
|----|------|
| 目的 | 验证查询结果为空时的行为 |
| 步骤 | 提问一个时间范围极窄或条件极苛刻的问题，例如 `"查询 1900 年的预警事件"`。 |
| 预期结果 | 不报错，返回自然语言说明“未查询到数据”等。 |
| 优先级 | P1 |

### TC-09：Agent Loop 端到端调用

| 项 | 内容 |
|----|------|
| 目的 | 验证通过 Agent Loop 的 `Skill` 工具调用 `border-defense-qa` |
| 步骤 | 1. 启动前端 `pnpm dev`；<br>2. 启动后端 `cd api && pnpm dev`；<br>3. 在 Chat 中提问 `"统计本月各级预警数量"`；<br>4. 观察 Agent 是否调用 `Skill{"skill":"border-defense-qa"}` 并返回答复。 |
| 预期结果 | Agent Loop 调用 Skill，Skill 调用 Bash 执行 Python 脚本，最终返回 Markdown 结果。 |
| 优先级 | P0 |

### TC-10：并发调用

| 项 | 内容 |
|----|------|
| 目的 | 验证脚本在并发调用下不会冲突 |
| 步骤 | 同时发起 3 个不同问题的 Skill 调用。 |
| 预期结果 | 每个调用返回独立结果，图表文件名不冲突（使用时间戳）。 |
| 优先级 | P2 |

## 10.4 测试数据要求

MySQL 数据库 `xjzhdd_bj` 中至少包含：

- `alarm_event`：预警事件表，含 `alarm_time`、`alarm_level`、`alarm_type` 等字段；
- `buckle_access_record`：卡口往来记录表；
- `tb_device`：设备表。

建议使用脱敏的测试数据，覆盖不同时间、等级、区域。

## 10.5 通过标准

| 测试项 | 通过条件 |
|--------|----------|
| P0 用例 | 全部通过 |
| P1 用例 | 最多 1 个非阻塞问题 |
| P2 用例 | 不影响主流程 |

## 10.6 测试记录模板

| 用例 ID | 执行人 | 执行时间 | 结果 | 备注 |
|---------|--------|----------|------|------|
| TC-01 | | | | |
| TC-02 | | | | |
| ... | | | | |

## 10.7 已知限制

1. 当前开发环境缺少 `agentscope`，需使用虚拟环境测试；
2. 真实 LLM 调用需要有效 API Key；
3. Agent Loop 调用时依赖 `api/.env` 中的环境变量配置和 Bash 工具白名单。
