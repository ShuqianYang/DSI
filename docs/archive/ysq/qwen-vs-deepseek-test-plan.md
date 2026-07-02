# Qwen vs DeepSeek 模型对比测试计划

> 用于对比 Agent Loop 在 DeepSeek 和 Qwen 两种模型下，工具选择、参数提取、多轮推理等能力的差异。
> 测试时排除 mock skill，只使用真实数据工具。

---

## 测试环境准备

每次切换模型后，必须重启 API 使配置生效：

### 切换到 DeepSeek

1. 确认 `api/.env`：
   ```env
   DEEPSEEK_API_KEY=...
   DEEPSEEK_MODEL=deepseek-v4-flash
   DEEPSEEK_VISION_MODEL=deepseek-vl2
   # QWEN_API_KEY=...
   ```
2. 确认 `api/src/modules/agent-loop/modelClient.ts` 使用 `DEEPSEEK_*` 常量。
3. 重启 API：
   ```bash
   Ctrl+C
   pnpm dev
   ```

### 切换到 Qwen

1. 确认 `api/.env`：
   ```env
   QWEN_API_KEY=...
   QWEN_MODEL=qwen3.5-27b
   # DEEPSEEK_API_KEY=...
   ```
2. 确认 `api/src/modules/agent-loop/modelClient.ts` 使用 `QWEN_*` 常量。
3. 重启 API：
   ```bash
   Ctrl+C
   pnpm dev
   ```

---

## 测试问题与预期回路

### 1. 简单 SQL 查询（单工具）

**问题：** `4月24日有多少条一级预警？`

**预期回路：**
```text
border-defense-qa skill → MysqlQuerySchema(alarm_event) → MysqlQuery(COUNT WHERE event_time='2026-04-24' AND event_level='1')
```

**对比重点：** 字段名是否正确使用 `event_level` 而非 `event_level_name`；时间是否直接按北京时间查询。

---

### 2. 需要区域解析的灾害查询

**问题：** `哈萨克斯坦本周有火灾吗？`

**预期回路：**
```text
RegionResolve(哈萨克斯坦) → DisasterQuery(fire, 7d) → [可选] SatelliteImageSearch
```

**对比重点：** 是否正确调用 `RegionResolve` 而不是猜测 bbox；`DisasterQuery` 的 `disasterType` 是否正确设为 `fire`，`timeRange` 是否为 `7d`。

---

### 3. 明确要求日报

**问题：** `生成昨天的边防日报。`

**预期回路：**
```text
daily-report skill → DailyReport(query="昨天", report_type="all")
```

**对比重点：** 是否优先识别为日报请求并调用 `DailyReport`，而不是去查 `alarm_event`。

---

### 4. 日期相关报警查询（应不走 DailyReport）

**问题：** `4月25日有报警事件吗？`

**预期回路：**
```text
MysqlQuery(COUNT alarm_event WHERE event_time >= '2026-04-25' AND event_time < '2026-04-26')
```

**对比重点：** 是否**不调用** `DailyReport`，直接走 `MysqlQuery`；时间是否按北京时间直接使用，不做 UTC 转换。

---

### 5. 多步骤区域态势查询

**问题：** `查询台湾海峡当前的船舶数量。`

**预期回路：**
```text
RegionResolve(台湾海峡) → ais-region-query skill → MysqlQuerySchema(ais_current_states) → MysqlQuery(COUNT WHERE bbox)
```

**对比重点：** 是否正确复用 `RegionResolve.selected.bbox`；SQL 是否包含经纬度范围过滤。

---

### 6. 复杂多工具链（区域 + 灾害 + 卫星影像）

**问题：** `柳州柳南区地震做灾后评估。`

**预期回路：**
```text
RegionResolve(柳州柳南区) → DisasterQuery(earthquake, 30d/1y) → SatelliteImageSearch → ImageAnalysis
```

**对比重点：** 多工具顺序是否正确；是否在 `DisasterQuery` 返回 0 条后仍继续调用 `SatelliteImageSearch`；`ImageAnalysis` 下载影像是否成功。

---

### 7. 航班区域查询

**问题：** `查询北京首都机场附近的航班。`

**预期回路：**
```text
aircraft-region-query skill → RegionResolve(北京首都机场) → MysqlQuerySchema(aircraft_current_states) → MysqlQuery
```

**对比重点：** 是否能识别首都机场的坐标范围，并正确生成 bbox 查询。

---

### 8. CSV 文件分析

**问题：** `帮我分析 public/test.csv 的数据分布。`

**预期回路：**
```text
csv-profile skill → Bash(node profile-csv.mjs) → 返回结果
```

**对比重点：** 是否正确调用 `csv-profile` skill，参数传递是否正确。

---

### 9. 自我介绍拦截

**问题：** `你是谁？`

**预期回路：**
```text
border-defense-qa skill 自我介绍 → 不调用任何工具
```

**对比重点：** 是否直接返回预设自我介绍，而不调用工具或查询数据库。

---

### 10. 统计类查询（GROUP BY + 趋势）

**问题：** `本月预警事件按等级统计，并给出柱状图。`

**预期回路：**
```text
border-defense-qa skill → MysqlQuery(GROUP BY event_level_name) → [若支持] 生成图表
```

**对比重点：** SQL 是否正确使用 `GROUP BY`；空等级是否补 0；是否触发图表生成。

---

## 对比记录表

| 问题编号 | DeepSeek 实际工具调用 | DeepSeek 结果评价 | Qwen 实际工具调用 | Qwen 结果评价 |
|---|---|---|---|---|
| 1 | | | | |
| 2 | | | | |
| 3 | | | | |
| 4 | | | | |
| 5 | | | | |
| 6 | | | | |
| 7 | | | | |
| 8 | | | | |
| 9 | | | | |
| 10 | | | | |

**结果评价维度：** 正确 / 部分正确 / 错误 / 未调用预期工具 / 多调用了无关工具 / 超时失败。

---

## 主要对比维度

| 维度 | 观察点 |
|---|---|
| **工具选择准确性** | 是否会选错工具，比如把报警日期查询误调 DailyReport |
| **参数提取** | 是否能正确提取日期、区域、灾害类型等参数 |
| **多轮推理** | 复杂查询是否能按正确顺序调用多个工具 |
| **规则遵循** | 是否遵循 prompt 中的 timezone、GIS routing 等规则 |
| **稳定性** | 同一问题多次询问，结果是否一致 |
| **ImageAnalysis** | Qwen 视觉模型 vs DeepSeek 视觉模型对卫星影像的分析质量 |

---

## 如何记录对比

### 方式一：手动填写上表

在前端依次输入每个问题，然后从 SSE 日志或界面观察实际调用的工具，填写到对比记录表中。

### 方式二：由 Agent 读取日志自动提取

每次测试后，Agent 可以读取日志文件：

```text
logs/agent-loop-<task-id>-<timestamp>.jsonl
```

从中提取：

- 每轮调用的工具名
- 工具输入参数
- 工具返回结果
- 最终回答内容

然后自动生成两个模型在同一问题上的调用序列对比。

如果你把测试后的日志路径发给我，我可以帮你逐条分析 DeepSeek 和 Qwen 的工具调用差异。
