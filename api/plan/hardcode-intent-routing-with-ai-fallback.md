# 硬编码意图路由 + AI 降级方案

## 目标

将用户提问处理改为"精确匹配优先，AI 降级兜底"的两级路由，**彻底移除关键词匹配**：

1. **精确命中** → 直接走预设 action 序列，自动补全 params，跳过 AI planner/router
2. **未命中** → 直接走 AI classifyIntent（Dify/DeepSeek）→ planner → router → executor
3. **case 缺失/阻断** → AI 分析原因，自动提报 `requirement` 定制需求

## 背景

当前 `classifyIntent()` 是关键词匹配，准确率不高。用户通过前端快捷按钮触发的 4 个核心场景（火情、漏油、地震、洪涝）提问文本固定，适合精确匹配。

## 精确匹配表

| 场景 | 匹配文本 | 预设 Action 序列 |
|------|---------|-----------------|
| 火情 | `火情研判·新疆-哈萨克斯坦接壤段` | region-mark → satellite(fire) → fire → weather-fetch → news → maritime |
| 漏油 | `查询中国东海区域近72小时海面疑似油污痕迹，调用天基信息服务系统获取相关影像及油膜信息，结合气象数据反推排污时间，匹配AIS轨迹筛选疑似肇事船舶并完成排序研判。` | region-mark → satellite(oil) → oil-drift → ais-fetch → ais-match-suspects → ais-suspect-ranking → maritime → weather-fetch → news |
| 地震 | `对柳州柳南区 5.2 级地震做灾后评估，先查询中国地震台网中心、广西地震局官网获取地震基础信息，先获取震前最新历史影像，再提交天基信息服务需求获取震后最新影像，自动对比识别损毁情况并完成灾后评估。` | region-mark → satellite(earthquake,pre) → news → satellite(earthquake,post) → earthquake-evaluation |
| 洪涝 | `对湖南石门县暴雨洪涝做灾后评估，先查询国家气象信息中心、湖南省气象局、水利部水文信息官网获取暴雨权威信息，先获取暴雨前最新历史影像，再提交天基信息服务需求获取暴雨后最新影像，自动对比识别淹没情况并完成洪涝灾后评估。` | region-mark → satellite(flood,pre) → news → satellite(flood,post) → flood-evaluation |

> 匹配方式：精确字符串相等（`query.trim() === HARDCODE_PROMPT`）

## 改动清单

### 1. planner/service.ts — 重写 classifyIntent

- **删除**现有关键词匹配逻辑，不再保留
- 新增 `HARDCODE_INTENTS` 常量表（4 个 prompt → 场景标识）
- 入口 `classifyIntent(query)` 逻辑：
  1. 先查硬编码表，命中 → 返回 `{ intent: 'fire'|'oil_spill'|'earthquake'|'flood', hardcoded: true, params: {...} }`
  2. 未命中 → **直接**走 Dify AI classify（不再经过关键词匹配）
- 硬编码命中时，直接附带上预提取的 params：
  - `regionName`, `region`, `phase`, `bbox`, `fireScenario`, `earthquakeScenario`, `floodScenario`

### 2. router/service.ts — 重写 decideActions

- 新增 `HARDCODE_PLANS` 常量（4 个场景的完整 action 序列）
- `decideActions(intent, query, context)` 逻辑：
  1. 若 `context.hardcoded === true` → 直接返回对应的硬编码 plan（跳过 Dify）
  2. 否则 → 走 Dify AI 决策（不再有关键词启发式）
- 每个硬编码 plan 包含：
  - `actions[]`: 完整的 action 序列（含 type、name、params、dependsOn）
  - 所有 params 已预填充（如 `regionName: '柳州'`、`phase: 'pre'`）

### 3. executor/service.ts — 阻断检测 + 降级

在 action 执行前（`actionsService.execute()` 之前）增加**参数校验层** `validateActionCase(action, context)`。

#### 校验规则（按 capability 类型）

| Capability | 校验规则 | 失败示例 |
|-----------|---------|---------|
| **region-mark** | `region` 必须在预设列表（东海/柳州/柳南区/石门/石门县/湖南石门县/广西柳州市柳南区） | `region: "太平洋"` → 失败 |
| **satellite** | `fireScenario`/`earthquakeScenario`/`floodScenario`/`detectOilSpill` 至少一个为 `true` | 无场景 flag → 失败 |
| **fire** | `region` 为 `"Kensai"` 或 `fromScenario` 为 `true` | `region: "北京"` → 失败 |
| **oil-drift** | context 中必须存在 satellite 返回的 `oilFilmGeom` | 无上游油膜数据 → 失败 |
| **ais-fetch** | `region` 必须在已知海域列表（东海/南海/黄海等 24 个） | `region: "大西洋"` → 失败 |
| **ais-match-suspects** | context 中必须存在 oil-drift 返回的 `originPoint` + `timeWindow` | 无上游漂移结果 → 失败 |
| **ais-suspect-ranking** | context 中必须存在 ais-match-suspects 返回的 `matchedShips` | 无上游匹配结果 → 失败 |
| **maritime** | `region` 必须在 24 个已知海域列表中 | `region: "地中海"` → 失败 |
| **weather-fetch** | `region` 必须在已知区域标签中（东海油膜片区/石门县/柳州等） | `region: "南极"` → 失败 |
| **earthquake-evaluation** | `region` 必须为 `"柳州"` 或 `"广西柳州市柳南区"`，且 context 中有 satellite pre/post 影像 | `region: "四川"` → 失败 |
| **flood-evaluation** | `region` 必须为 `"石门县"` 或 `"湖南石门县"`，且 context 中有 satellite pre/post 影像 | `region: "湖北"` → 失败 |
| **news** | `fireScenario`/`earthquakeScenario`/`floodScenario` 至少一个为 `true` | 无场景 flag → 失败 |

#### 阻断流程

1. `validateActionCase(action, context)` 校验失败 → 抛 `CaseValidationError(action, reason)`
2. executor catch 到 `CaseValidationError` → 不走失败流程，触发**阻断降级**：
   1. 调用 `analyzeBlockReason(query, failedAction, context)`（Dify API）
   2. 生成 `requirement` payload（描述阻断原因 + 用户原始需求）
   3. 调用 `actionsService.execute(requirementAction)` 提报定制
   4. 向用户返回："当前场景暂不支持，已为您转报定制需求"
3. 已执行的步骤保留结果，未执行的步骤全部跳过

### 4. tasks/pipeline.ts — 路由入口调整

- 现有 pipeline 逻辑：
  - news → 直接执行（保留）
  - 完整场景 → `runLegacyAgentPipeline` → planner → router → executor
  - 缺参数 → `runMissingParamsFlow`
  - unknown → `runUnknownFlow`
- 调整后：
  - `classifyIntent()` 返回 `hardcoded: true` → 直接 `runLegacyAgentPipeline`（但 router 会返回硬编码 plan，无需 Dify）
  - 其余逻辑不变

### 5. 新增模块 — AI 阻断分析

文件：`api/src/modules/blockage-analyzer/service.ts`

```typescript
export async function analyzeBlockReason(
  query: string,
  failedAction: Action,
  context: Record<string, unknown>
): Promise<{
  reason: string;      // 阻断原因描述
  suggestedCapability: string;  // 建议新增的能力
  requirementPayload: Record<string, unknown>;  // requirement 提报参数
}> {
  // 1. 调用 Dify API 分析阻断原因
  // 2. 简单归类：工具缺失 / 参数缺失 / 场景未覆盖
  // 3. 生成 requirement 所需字段
}
```

- Dify prompt 模板：告知模型当前系统有哪些 capability，用户的提问是什么，哪个 action 执行失败，请分析原因并建议解决方案
- 返回结果用于填充 `requirement` action 的 params

## 关键设计决策

### 为什么删掉关键词匹配？

关键词匹配准确率不高，且维护成本高。所有非精确命中的提问统一走 AI classify，由模型判断意图。AI 处理不了的最终会通过 requirement 提报。

### 硬编码 plan 的 params 从哪来？

直接写死在 router 的 `HARDCODE_PLANS` 中。4 个场景的 params 当前已固定（regionName、phase、bbox 等）。

### AI 分析阻断用哪个模型？

先用 Dify API（复用现有 `callDifyChat`）。未来统一替换为 DeepSeek API。

### 阻断后 requirement 提报给谁？

复用现有 `requirement` capability，提报到外部系统 `192.168.0.129:5000`。

## 验证清单

- [ ] 4 个精确 prompt 命中后，不走 Dify planner/router
- [ ] 硬编码 plan 的 action 序列与现有执行结果一致
- [ ] 非匹配提问正常走 AI planner/router
- [ ] case 缺失时，executor 正确阻断并触发 AI 分析
- [ ] AI 分析结果正确生成 requirement 提报
- [ ] 用户收到清晰的阻断提示消息

## 风险

| 风险 | 缓解措施 |
|------|---------|
| 硬编码 plan 与真实 capability 参数不同步 | 每次修改 capability 时同步更新 HARDCODE_PLANS |
| Dify API 不可用时阻断分析失败 | requirement 提报使用兜底文案（"用户定制需求"+原始提问） |
| 用户修改 prompt 文本导致匹配失败 | 精确匹配，前端按钮文本变更时必须同步更新 |

## 相关文件

- `api/src/modules/planner/service.ts`
- `api/src/modules/router/service.ts`
- `api/src/modules/executor/service.ts`
- `api/src/modules/tasks/pipeline.ts`
- `api/src/modules/blockage-analyzer/service.ts`（新增）
- `src/components/chat/ChatMessageList.tsx`（确认 prompt 文本）
