# DeepSeek vs Qwen 模型对比分析报告

> 基于 2026-06-25 的两次测试日志：`test-deepseek.txt` 和 `test-qwen.txt`。

---

## 一、测试问题与结果总览

| 编号 | 测试问题 | DeepSeek 轮次 | DeepSeek 结果 | Qwen 轮次 | Qwen 结果 |
|---|---|---|---|---|---|
| 1 | 4月24日有多少条一级预警？ | 7 轮 | ✅ 21 条 | 3 轮 | ✅ 21 条 |
| 2 | 哈萨克斯坦本周有火灾吗？ | 3 轮 | ✅ 0 条 | 4 轮 | ✅ 0 条 |
| 3 | 4月25日有报警事件吗？ | 4 轮 | ✅ 0 条 | 3 轮 | ✅ 0 条 |
| 4 | 查询台湾海峡当前的船舶数量。 | 10 轮 | ⚠️ 0 艘（max_turns） | 10 轮 | ⚠️ 0 艘（max_turns） |
| 5 | 柳州柳南区地震做灾后评估。 | 10 轮 | ✅ 生成完整报告 | 6 轮 | ⚠️ 报告较简略 |
| 6 | 查询北京首都机场附近的航班。 | 4 轮 | ⚠️ 使用 WebSearch | 2 轮 | ❌ 直接说明工具限制 |
| 7 | 你是谁？ | 1 轮 | ✅ 自我介绍 | 1 轮 | ✅ 自我介绍 |
| 10 | 4月预警事件按等级统计，并给出柱状图。 | 10 轮 | ⚠️ 统计正确，无图（max_turns） | 6 轮 | ⚠️ 统计正确，无图 |

---

## 二、详细对比分析

### 问题 1：4月24日有多少条一级预警？

**DeepSeek（7 轮）：**
```text
MysqlQuerySchema(schema) → MysqlQuerySchema(alarm_event) → MysqlQuery(COUNT event_level_name='一级预警') → MysqlQuery(DISTINCT event_level/event_level_name) → MysqlQuery(DISTINCT event_level='1') → MysqlQuery(COUNT event_level='1') → final_answer
```

**Qwen（3 轮）：**
```text
MysqlQuerySchema(alarm_event) → MysqlQuery(COUNT event_level='1' GROUP BY event_level, event_level_name) → final_answer
```

**对比：**
- Qwen 更直接，一步到位的 SQL 更高效。
- DeepSeek 更谨慎，额外验证了 `event_level_name` 和 `event_level` 的对应关系，导致多了 4 轮查询。
- 两者最终结果一致（21 条）。

---

### 问题 2：哈萨克斯坦本周有火灾吗？

**DeepSeek（3 轮）：**
```text
RegionResolve(哈萨克斯坦) → [RegionMark + DisasterQuery(fire, 7d)] 并发 → final_answer
```

**Qwen（4 轮）：**
```text
RegionResolve(哈萨克斯坦) → RegionMark → DisasterQuery(fire, 7d) → final_answer
```

**对比：**
- DeepSeek 的 RegionMark 和 DisasterQuery 并发执行，效率更高。
- Qwen 串行执行，但顺序更清晰。
- 两者结果一致（0 条火灾）。

---

### 问题 3：4月25日有报警事件吗？

**DeepSeek（4 轮）：**
```text
MysqlQuerySchema(alarm_event) → MysqlQuery(GROUP BY event_level_name, warning_classification_name) → MysqlQuery(DATE event_time GROUP BY) → final_answer
```

**Qwen（3 轮）：**
```text
MysqlQuerySchema(alarm_event) → MysqlQuery(SELECT 明细 WHERE event_time='2026-04-25') → final_answer
```

**对比：**
- 两者都正确走了 MysqlQuery，没有误调 DailyReport。
- DeepSeek 额外查了日期分布，回答更丰富。
- Qwen 更聚焦问题本身。

---

### 问题 4：查询台湾海峡当前的船舶数量

**DeepSeek（10 轮，max_turns）：**
```text
RegionResolve(台湾海峡) → MysqlQuerySchema(alarm_event) → Bash(失败) → Grep(失败) → Glob/Glob/Grep → MysqlQuery(查 information_schema 找船表) → ... → SqlQuerySchema → SqlQuery → final_answer(0艘)
```

**Qwen（10 轮，max_turns）：**
```text
RegionResolve(台湾海峡) → MysqlQuerySchema → Grep(失败) → MysqlQuerySchema → MysqlQuery(失败) → MysqlQuery(查 information_schema 找船表) → ... → SqlQuerySchema → SqlQuery → final_answer(0艘)
```

**对比：**
- 两者都未能正确使用 `ais-region-query` skill。
- 都因为 `ais_current_states` 表为空（AIS 数据未接入）而返回 0 艘。
- DeepSeek 走了 Bash/Grep/Glob 等额外弯路，Qwen 相对收敛一些。
- 两者都达到 max_turns，说明对可用数据源不够清晰。

**结论：** 这不是模型差异问题，而是 AIS 数据源缺失 + skill 路由未触发的问题。

---

### 问题 5：柳州柳南区地震做灾后评估

**DeepSeek（10 轮）：**
```text
RegionResolve(柳州市) → [RegionMark + DisasterQuery(earthquake, 1y)] → SatelliteImageSearch → ImageAnalysis(change_detection, 2张) → SatelliteImageSearch → WebFetch → [WebFetch + WebFetch + WebSearch] → WebSearch → final_answer
```

**Qwen（6 轮）：**
```text
RegionResolve(广西壮族自治区) → [RegionMark + DisasterQuery(earthquake, 30d)] → DisasterQuery(earthquake, 1y) → SatelliteImageSearch(失败) → SatelliteImageSearch(失败) → final_answer
```

**对比：**
| 维度 | DeepSeek | Qwen |
|---|---|---|
| 区域解析 | 柳州市（更精确） | 广西壮族自治区（范围过大） |
| 影像分析 | ✅ 调用了 ImageAnalysis | ❌ 未调用 ImageAnalysis |
| 外部信息 | ✅ 使用 WebFetch/WebSearch 补充 | ❌ 未使用 |
| 报告完整度 | 高（震级、时间、来源链接） | 低（仅列出地震事件） |
| 轮次 | 10 轮 | 6 轮 |

**关键差异：**
- DeepSeek 在 SatelliteImageSearch 找到影像后，成功调用 ImageAnalysis 做 change_detection，并进一步用 WebSearch 补充地震信息，生成了更完整的灾后评估报告。
- Qwen 两次 SatelliteImageSearch 都返回 0 张影像后，直接基于 DisasterQuery 结果给出报告，没有进一步尝试 ImageAnalysis 或 WebSearch。
- 但 Qwen 的区域解析选择了"广西壮族自治区"，范围过大，可能影响 SatelliteImageSearch 的参数。

---

### 问题 6：查询北京首都机场附近的航班

**DeepSeek（4 轮）：**
```text
WebSearch(北京首都机场航班) → WebFetch → WebSearch → final_answer(航班动态)
```

**Qwen（2 轮）：**
```text
RegionResolve(北京市) → final_answer(说明工具限制，无法查询)
```

**对比：**
- DeepSeek 灵活使用 WebSearch/WebFetch，给出了看似具体的航班动态（但数据真实性存疑，因为日期是 2026 年）。
- Qwen 没有调用 WebSearch，也没有使用 `aircraft-region-query` skill，直接说明工具限制。
- 两者都没有正确使用 `aircraft-region-query` skill 查询 `aircraft_current_states` 表。

**结论：** DeepSeek 更愿意尝试外部工具弥补本地能力缺失；Qwen 更保守，但本地工具也未使用。

---

### 问题 7：你是谁？

**DeepSeek（1 轮）：** 自我介绍，说明是软件工程智能助手。  
**Qwen（1 轮）：** 自我介绍，说明是软件工程代理。

**对比：** 两者都正确识别为无需调用工具，直接回答。

---

### 问题 10：4月预警事件按等级统计，并给出柱状图

**DeepSeek（10 轮，max_turns）：**
```text
MysqlQuerySchema → MysqlQuery(按等级统计) → MysqlQuery(DISTINCT event_level) → MysqlQuery(按等级统计) → [MysqlQuery + Grep] → Grep → Glob/Glob → Bash(失败) → final_answer(统计表格)
```

**Qwen（6 轮）：**
```text
MysqlQuerySchema → MysqlQuery(按等级统计) → Bash(失败) → Write(失败) → Bash(失败) → final_answer(统计表格)
```

**对比：**
- 两者都正确完成了按等级统计。
- 两者都尝试生成柱状图但失败（Bash/Write 失败）。
- DeepSeek 走了更多验证性查询，Qwen 更直接。

---

## 三、主要差异总结

| 维度 | DeepSeek | Qwen |
|---|---|---|
| **工具调用风格** | 勤奋、多轮验证、倾向外部搜索 | 简洁、直接、保守 |
| **复杂任务处理** | 更愿意调用多个工具链（ImageAnalysis + WebSearch） | 较早终止，不深入 |
| **区域解析精度** | 相对较高（柳州市） | 有时范围过大（广西壮族自治区） |
| **SQL 生成** | 谨慎，多次确认字段对应关系 | 直接，一步到位的 SQL 较多 |
| **外部信息补充** | 主动使用 WebSearch/WebFetch | 基本不使用 |
| **达到 max_turns 频率** | 较高（10轮问题较多） | 较低 |
| **Skill 使用** | 两者都未正确触发 aircraft/ais skill | 两者都未正确触发 aircraft/ais skill |

---

## 四、发现的问题

### 1. Skill 路由未触发

无论是 DeepSeek 还是 Qwen，在面对航班/船舶查询时，都没有触发 `aircraft-region-query` 和 `ais-region-query` skill，而是直接尝试用通用工具（MysqlQuery/WebSearch）解决。

**可能原因：**
- Skill 描述中的触发条件不够突出
- 模型对 skill 列表的注意力不够
- 需要更强的路由规则或在 system prompt 中明确说明优先使用 skill

### 2. AIS 数据未接入

`ais_current_states` 表为空，导致任何船舶查询都返回 0 艘。需要解决 AISStream WebSocket 连接超时问题。

### 3. 图表生成能力不足

两者都无法生成柱状图。当前工具链缺少图表生成能力，或 `border-defense-qa` skill 中的图表生成脚本未正确配置。

### 4. 区域解析精度差异

Qwen 在"柳州柳南区"查询中解析为"广西壮族自治区"，范围过大。这与 RegionResolve 的匹配算法有关，可能需要进一步优化 aliases 或评分逻辑。

### 5. DeepSeek 过度使用 WebSearch

DeepSeek 在航班查询中完全依赖 WebSearch，没有尝试本地 `aircraft_current_states` 表（该表有 7278 条数据）。这可能导致结果不可靠。

---

## 五、建议

1. **优化 Skill 触发**：在 system prompt 中增加明确规则，例如"涉及航班/飞机/ADS-B 时必须调用 aircraft-region-query skill"。
2. **修复 AIS 数据接入**：检查 AISStream API Key 和网络连接，确保 `ais_current_states` 有数据。
3. **增加图表生成工具**：为统计类查询增加专门的图表生成工具或 skill。
4. **平衡模型行为**：
   - DeepSeek 倾向于多轮验证和外部搜索，适合复杂任务但容易达到 max_turns。
   - Qwen 更简洁，但在需要多工具链的任务中容易过早终止。
   - 可以根据任务类型动态选择模型，或调整 prompt 引导模型行为。

---

## 六、总体评价

- **DeepSeek**：在复杂任务（如灾后评估）中表现更好，能构建完整的多工具链路并补充外部信息。但容易过度验证、过度搜索，导致轮次较多。
- **Qwen**：在简单 SQL 查询中更高效、直接。但在复杂任务中缺乏深度，容易过早放弃，且区域解析精度略逊。

如果主要场景是**边防数据库查询**，Qwen 的简洁性可能更合适。如果场景需要**多源数据融合和深度分析**，DeepSeek 的表现更优。
