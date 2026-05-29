# Maritime 海域态势分析重构计划

## 背景

当前 `maritime` 能力为纯 Mock 实现（`api/src/modules/actions/capabilities/maritime.ts`），返回固定的 3 艘船舶数据，无法反映前端实时展示的 320 艘船舶 + 320 架飞机的真实态势。

## 目标

将 `maritime` 能力重构为：**基于实时模拟数据（AIS 船舶 + ADS 飞机）+ 模型接口，生成动态、可信的海域态势分析结果。**

---

## 架构方案

```
用户查询 "分析东海近期态势"
        ↓
Router 返回 maritime action
        ↓
Executor 调用 maritimeCapability.execute()
        ↓
┌────────────────────────────────────┐
│  1. 从后端数据层获取当前海域实体              │
│     - 船舶: aisDataStore.getEntitiesInRegion(region)      │
│     - 飞机: adsDataStore.getEntitiesInRegion(region)      │
│  2. 构造提示词 / inputs                             │
│     - 原始查询 + 实体列表 + 轨迹数据                │
│  3. 调用模型接口（Dify Agent / LLM）                  │
│  4. 解析返回的结构化 JSON                             │
│     - vessels[] / aircraft[]                            │
│     - summary / riskAssessment                          │
└────────────────────────────────────┘
        ↓
返回 ActionResult（保持现有字段结构兼容 executor/writeDisplayData）
        ↓
落库 events + 触发综合洞察
```

---

## 一、数据层：移植 AIS + ADS 模拟数据到后端

### 问题
前端的 `src/data/aisMockData.ts` 和 `src/data/adsMockData.ts` 使用了 `@/types/prd`、`@/data/...` 等前端 alias，后端无法直接 import。

### 方案
在 `api/src/data/` 下重新实现数据生成逻辑，保持与前端协议一致：

| 文件 | 来源 | 说明 |
|-------|-------|------|
| `api/src/data/aisDataStore.ts` | 移植 `src/data/aisMockData.ts` | 船舶实体生成、位置更新、海域筛选 |
| `api/src/data/adsDataStore.ts` | 移植 `src/data/adsMockData.ts` | 飞机实体生成、位置更新、航向计算 |

### 关键接口

```typescript
// aisDataStore.ts
export function getAisEntitiesInRegion(
  region: string,   // "东海" / "南海" / "黄海" 等
  limit?: number
): Array<{ id, name, type, lat, lng, speed, heading, status, riskLevel }>;

// adsDataStore.ts
export function getAdsEntitiesInRegion(
  region: string,
  limit?: number
): Array<{ id, name, type, lat, lng, altitude, speed, heading, status, riskLevel }>;
```

### 数据共享策略（可选）
如果希望前后端数据完全一致，可将通用类型定义和生成逻辑抽象到 `packages/shared`，前后端共享。

---

## 二、模型接口：Dify 海域态势分析 Agent

### 新建 Dify Chat App
- 名称：`海域态势分析 Agent`
- 类型：Chat App (Agent 模式)

### 系统提示词草稿

```
#角色
你是海域情报分析专家，负责基于 AIS 船舶数据和 ADS-B 航空器数据，生成结构化的海域态势分析报告。

#任务
1. 分析指定海域内的船舶和飞机数据
2. 识别异常行为（非法进入、异常停泊、航线偏离、密集聚集等）
3. 评估风险等级
4. 返回结构化的分析结果

#输入变量
- region: 海域名称（如"东海"）
- query: 用户原始查询
- vessels: 船舶数据 JSON 数组
- aircrafts: 飞机数据 JSON 数组

#输出格式
必须返回纯 JSON，不要 markdown 代码块标记：
{
  "vessels": [
    {
      "id": "string",
      "name": "string",
      "type": "string",
      "lat": number,
      "lng": number,
      "speed": number,
      "heading": number,
      "status": "normal | warning | danger",
      "riskLevel": "low | medium | high",
      "reason": "风险判断原因"
    }
  ],
  "aircrafts": [
    {
      "id": "string",
      "name": "string",
      "type": "string",
      "lat": number,
      "lng": number,
      "altitude": number,
      "speed": number,
      "heading": number,
      "status": "normal | warning | danger",
      "riskLevel": "low | medium | high",
      "reason": "风险判断原因"
    }
  ],
  "summary": {
    "totalVessels": number,
    "totalAircrafts": number,
    "normalCount": number,
    "warningCount": number,
    "dangerCount": number,
    "riskAssessment": "string"
  },
  "gisLayers": {
    "heatmap": {
      "type": "heatmap",
      "data": [{ "lat": number, "lng": number, "intensity": number }]
    }
  }
}

#规则
1. 基于输入的真实数据生成分析，严禁编造不存在的数据
2. 风险评估应有明确的数据支撑
3. 如果数据不足以支撑分析，返回空的 vessels/aircrafts 和适当的 riskAssessment
```

### 配置
在 `api/.env` 中新增：
```bash
DIFY_MARITIME_API_KEY=app-xxx
DIFY_MARITIME_API_URL=https://api.dify.ai/v1
```

---

## 三、maritime capability 重构

### 文件: `api/src/modules/actions/capabilities/maritime.ts`

改动点：
1. 移除固定 mock 数据
2. 获取 region 参数
3. 调用 `aisDataStore.getEntitiesInRegion(region)` 和 `adsDataStore.getEntitiesInRegion(region)`
4. 调用 `callDifyChat` 传入数据
5. 解析返回的 JSON，生成 ActionResult

### 保持兼容的字段
- `vessels` 数组（兼容 `writeDisplayData` 的 `events` 写入）
- `summary.riskAssessment` 字符串
- `gisLayers` 可选

---

## 四、数据流与时序图

```
用户: "分析东海近期态势"
  → Planner 生成计划
  → Router 返回 [maritime]
  → Executor 创建 step "海域态势分析"
  → Worker 执行 maritime capability
      ┌─────────────────────────────────────────┐
      │ 1. 获取东海区域内的船舶 + 飞机数据        │
      │ 2. 调用 Dify 海域态势分析 Agent                    │
      │ 3. 解析返回的 vessels / aircrafts / summary          │
      │ 4. 返回 ActionResult                                    │
      └─────────────────────────────────────────┘
  → writeDisplayData 写入 events 表"海域态势分析完成"
  → 所有 steps 完成后，generateInsights 生成综合洞察
```

---

## 五、文件改动清单

| 文件 | 动作 | 说明 |
|-------|------|------|
| `api/src/data/aisDataStore.ts` | 新增 | 移植前端 aisMockData 生成逻辑 |
| `api/src/data/adsDataStore.ts` | 新增 | 移植前端 adsMockData 生成逻辑 |
| `api/src/modules/actions/capabilities/maritime.ts` | 重构 | 替换 mock 为 Dify + 实时数据 |
| `api/.env` / `.env.example` | 修改 | 新增 DIFY_MARITIME_API_KEY / URL |
| `api/docs/maritime-agent-prompt.md` | 新增 | Dify Agent 系统提示词文档 |
| `src/data/aisMockData.ts` | 可选 | 若抽象到 shared，前端引用新路径 |
| `src/data/adsMockData.ts` | 可选 | 若抽象到 shared，前端引用新路径 |

---

## 六、实施步骤

### Phase 1: 数据层（无依赖）
- [ ] 创建 `api/src/data/aisDataStore.ts`，实现船舶生成、更新、海域筛选
- [ ] 创建 `api/src/data/adsDataStore.ts`，实现飞机生成、更新、空域筛选
- [ ] 单元测试验证数据返回正确

### Phase 2: 模型接口（无依赖）
- [ ] 在 Dify 新建"海域态势分析 Agent"
- [ ] 粘贴系统提示词，调试输入输出
- [ ] 获取 API Key，填入 `api/.env`

### Phase 3: maritime capability 重构
- [ ] 修改 `maritime.ts`，集成 aisDataStore + adsDataStore + Dify 调用
- [ ] 保持返回字段结构与现有 `writeDisplayData` 兼容
- [ ] 本地测试：发起查询 → 验证事件/洞察正确生成

### Phase 4: 数据共享优化（可选）
- [ ] 若需要前后端数据完全一致，将通用逻辑抽象到 `packages/shared`
- [ ] 前端 `aisMockData.ts` / `adsMockData.ts` 改为从 shared import

---

## 七、风险与回滚

| 风险 | 应对 |
|-------|------|
| Dify 接口超时/失败 | 添加 fallback：返回简化的统计数据（只含总数和坐标） |
| 模型返回格式不标准 | 增强 `parseMaritimeResult` 解析器，支持部分字段缺失 |
| 数据层性能 | 每次调用都重新生成 640 个实体可能慢，可考虑缓存机制 |
| 前后端数据不一致 | Phase 4 抽象到 shared ，或后端通过 SSE/API 推送给前端 |

---

## 八、验收标准

"分析东海近期态势" 查询后：
- [ ] events 表写入一条"海域态势分析完成"事件
- [ ] 事件内容包含真实的风险评估（非固定模板）
- [ ] insights 表写入 2-5 条综合洞察（如果 Dify 洞察 Agent 配置好了）
- [ ] 右侧事件栏正确显示 GIS 联动数据（船舶/飞机位置）

 #6    │ 数据层增强：风险筛选   │ 在 ais/ads 中新增 getHighRiskEntities、getAnomalousEntities │ #1, #3     │
 #7    │ Dify 提示词文档 + 配置 │ 更新提示词（精简输入格式），配置 .env                       │ 无         │
  ├───────┼────────────────────────┼─────────────────────────────────────────────────────────────┼────────────┤
  │ #8    │ maritime.ts 重构       │ 四层架构：数据获取 → 本地筛选 → Dify 调用 → GIS 组装        │ #6, #7     │
  ├───────┼────────────────────────┼─────────────────────────────────────────────────────────────┼────────────┤
  │ #9    │ writeDisplayData 适配  │ 支持 aircrafts + trajectories 写入 events 表                │ #8         │