# AI Planner + Router 提示词设计

## 目标

让 AI 自由发挥调用 12 个 capability，不再依赖硬编码 plan/action。

---

## 一、工具清单（供 AI 参考）

```json
{
  "capabilities": [
    {
      "type": "region-mark",
      "name": "区域标记",
      "description": "在 Cesium 地图上框选目标范围，返回边界框、中心坐标、cameraView",
      "params": {
        "region": { "type": "string", "required": false, "default": "中国东海", "enum": ["中国东海","东海","柳州","柳州市","柳南区","广西柳州市柳南区","石门","石门县","湖南石门","湖南石门县"] }
      },
      "output": { "bbox": "[west,south,east,north]", "center": "[lng,lat]", "cameraView": "object" }
    },
    {
      "type": "satellite",
      "name": "天基遥感",
      "description": "获取卫星遥感影像。火灾=火情监测；漏油=SAR油膜检测；地震/洪涝=phase=pre/post获取灾前灾后影像",
      "params": {
        "query": { "type": "string", "required": false, "default": "未指定查询" },
        "fireScenario": { "type": "boolean", "required": false },
        "earthquakeScenario": { "type": "boolean", "required": false },
        "floodScenario": { "type": "boolean", "required": false },
        "detectOilSpill": { "type": "boolean", "required": false },
        "phase": { "type": "string", "required": false, "enum": ["pre","post"] },
        "region": { "type": "string", "required": false },
        "bbox": { "type": "array", "required": false }
      },
      "output": { "imageOverlays": "array", "entities": "array", "regions": "array" }
    },
    {
      "type": "fire-detector",
      "name": "火情识别",
      "description": "识别火灾中心点、烧毁区域多边形，生成火情 overlay、mask 图层",
      "params": {
        "region": { "type": "string", "required": false, "default": "Kensai" },
        "query": { "type": "string", "required": false },
        "bbox": { "type": "array", "required": false },
        "fromScenario": { "type": "boolean", "required": false }
      },
      "output": { "entities": "array", "regions": "array", "imageOverlays": "array" }
    },
    {
      "type": "oil-drift",
      "name": "油污漂移反推",
      "description": "结合油膜中心与气象参数，反推排污原点，生成漂移路径",
      "params": {},
      "contextDeps": ["satellite.oilFilmGeom", "weather-fetch.output"],
      "output": { "originPoint": "[lng,lat]", "timeWindow": "object", "driftPath": "array" }
    },
    {
      "type": "ais-fetch",
      "name": "AIS 轨迹获取",
      "description": "拉取近72小时船舶 AIS 轨迹",
      "params": {
        "region": { "type": "string", "required": false, "default": "中国东海" }
      },
      "output": { "entities": "array", "trajectories": "array" }
    },
    {
      "type": "ais-match-suspects",
      "name": "嫌疑船匹配",
      "description": "将嫌疑船名单与 AIS 轨迹进行时空双重匹配",
      "params": {},
      "contextDeps": ["oil-drift.originPoint", "oil-drift.timeWindow", "ais-fetch.output"],
      "output": { "matchedShips": "array" }
    },
    {
      "type": "ais-suspect-ranking",
      "name": "嫌疑船排序",
      "description": "按排污概率对候选船舶排序",
      "params": {},
      "contextDeps": ["ais-match-suspects.matchedShips"],
      "output": { "rankedList": "array" }
    },
    {
      "type": "maritime",
      "name": "海域态势分析",
      "description": "拉取 AIS 船舶 + ADS 飞机数据，识别异常航行、风险等级",
      "params": {
        "region": { "type": "string", "required": false, "default": "南海" },
        "query": { "type": "string", "required": false }
      },
      "output": { "entities": "array", "trajectories": "array" }
    },
    {
      "type": "weather-fetch",
      "name": "气象风场获取",
      "description": "获取 10×10 网格风场数据（u/v 分量），驱动前端粒子层",
      "params": {
        "region": { "type": "string", "required": false, "default": "东海油膜片区" }
      },
      "output": { "windField": "object" }
    },
    {
      "type": "earthquake-evaluation",
      "name": "地震灾后评估",
      "description": "加载 earthquake.geojson，震前震后影像对比，输出损毁多边形",
      "params": {
        "region": { "type": "string", "required": false, "default": "广西柳州市柳南区" },
        "query": { "type": "string", "required": false }
      },
      "contextDeps": ["satellite.pre_earthquake.imageOverlays", "satellite.post_earthquake.imageOverlays"],
      "output": { "entities": "array", "regions": "array", "imageOverlays": "array" }
    },
    {
      "type": "flood-evaluation",
      "name": "洪涝灾后评估",
      "description": "加载 flood.geojson，洪水前后影像对比，输出淹没区域",
      "params": {
        "region": { "type": "string", "required": false, "default": "湖南石门县" },
        "query": { "type": "string", "required": false }
      },
      "contextDeps": ["satellite.pre_flood.imageOverlays", "satellite.post_flood.imageOverlays"],
      "output": { "entities": "array", "regions": "array", "imageOverlays": "array" }
    },
    {
      "type": "news",
      "name": "新闻查询",
      "description": "获取权威通报或新闻摘要",
      "params": {
        "query": { "type": "string", "required": false, "default": "未指定查询" },
        "region": { "type": "string", "required": false },
        "timeRange": { "type": "string", "required": false, "default": "7d" },
        "fireScenario": { "type": "boolean", "required": false },
        "earthquakeScenario": { "type": "boolean", "required": false },
        "floodScenario": { "type": "boolean", "required": false }
      },
      "output": { "articles": "array" }
    }
  ]
}
```

---

## 二、Planner Prompt 模板

```
你是任务规划专家。请根据用户提问和可用工具，生成一个详细的执行计划。

## 可用工具

{CAPABILITY_LIST_JSON}

## 规划规则

1. 分析用户意图，提取关键实体（区域、时间、灾种等）
2. 按"先基准→后查询→再评估→最后展示"的顺序规划
3. 有前置依赖的步骤必须标记 dependsOn
4. 地震/洪涝场景必须分 pre/post 两阶段获取影像
5. 漏油场景必须包含：区域标记→卫星油膜→气象→漂移反推→AIS→匹配→排序
6. 火灾场景必须包含：区域标记→卫星影像→火情识别→气象→新闻

## 输出格式

必须返回 JSON，不要其他内容：

{
  "goal": "string",
  "steps": [
    {
      "id": "step-1",
      "description": "步骤简述",
      "purpose": "为什么要做这个步骤",
      "expectedOutput": "期望产出"
    }
  ],
  "reasoning": "规划思路说明",
  "scenario": {
    "name": "场景名称",
    "platform": "数智融合智能体应用平台",
    "involvedSystems": ["系统A", "系统B"],
    "userRoles": ["角色A", "角色B"],
    "coreFlow": "用户提问→...→完成",
    "coreLogic": "核心逻辑说明"
  },
  "thinkingChain": {
    "intentRecognition": "意图识别结果",
    "entityExtraction": "提取的实体",
    "taskPlanning": "任务拆解说明",
    "subtaskCount": 5,
    "executionScheduling": "执行调度说明"
  },
  "subtasks": [
    {
      "id": "subtask-1",
      "name": "步骤名称",
      "capability": "工具类型",
      "description": "详细描述",
      "executionDetail": "执行细节",
      "expectedResult": "期望结果",
      "gisInteraction": "GIS交互说明",
      "objectType": "对象类型",
      "dependsOn": []
    }
  ],
  "mainTask": {
    "name": "主任务名称",
    "id": "TASK-xxx",
    "status": "执行中",
    "progress": 0
  },
  "finalEvent": {
    "type": "事件类型",
    "riskLevelHint": "高危|中危|低危",
    "gisReplayObjectTypes": ["region", "imagery", "damage"]
  }
}

## 用户提问

{USER_QUERY}
```

---

## 三、Router Prompt 模板

```
你是工具路由专家。请根据 Planner 生成的计划，为每个子任务决策需要调用哪些具体工具。

## 可用工具

{CAPABILITY_LIST_JSON}

## 路由规则

1. 每个子任务对应一个 action
2. action.type 必须是可用工具类型之一
3. action.params 必须填写该工具所需的参数
4. dependsOn 引用前置 action 的 id
5. 参数值必须匹配工具的预设范围（如 region 必须在已知列表中）
6. 地震/洪涝的 satellite 必须带 phase="pre" 或 phase="post"
7. 火灾必须带 fireScenario=true
8. 漏油必须带 detectOilSpill=true

## Planner 输出

{PLANNER_OUTPUT_JSON}

## 输出格式

必须返回 JSON，不要其他内容：

{
  "actions": [
    {
      "id": "action-1",
      "type": "region-mark",
      "name": "步骤名称",
      "description": "步骤描述",
      "params": {
        "region": "柳州"
      },
      "dependsOn": []
    }
  ]
}
```

---

## 四、阻断分析 Prompt 模板

```
你是需求分析师。用户的请求在执行过程中被阻断，请分析原因并生成标准化需求描述。

## 系统可用工具

{CAPABILITY_LIST_JSON}

## 用户原始提问

{USER_QUERY}

## 失败的 Action

{FAILED_ACTION_JSON}

## 失败原因

{FAILURE_REASON}

## 输出格式

必须返回 JSON，不要其他内容：

{
  "reason": "阻断原因描述",
  "suggestedCapability": "建议新增的能力名称",
  "requirementPayload": {
    "name": "需求名称（20字内）",
    "description": "详细需求描述",
    "applicationScenario": "应用场景"
  }
}
```

---

## 五、数据结构定义

### Plan（Planner 输出）

```typescript
interface Plan {
  goal: string;
  steps: Array<{
    id: string;
    description: string;
    purpose: string;
    expectedOutput: string;
  }>;
  reasoning: string;
  scenario?: {
    name: string;
    platform: string;
    involvedSystems: string[];
    userRoles: string[];
    coreFlow: string;
    coreLogic: string;
  };
  thinkingChain?: {
    intentRecognition: string;
    entityExtraction: string;
    taskPlanning: string;
    subtaskCount: number;
    executionScheduling: string;
  };
  subtasks?: Array<{
    id: string;
    name: string;
    capability: string;
    description: string;
    executionDetail: string;
    expectedResult: string;
    gisInteraction: string;
    objectType: string;
    dependsOn: string[];
  }>;
  mainTask?: {
    name: string;
    id: string;
    status: string;
    progress: number;
  };
  finalEvent?: {
    type: string;
    riskLevelHint: string;
    gisReplayObjectTypes: string[];
  };
}
```

### Action（Router 输出）

```typescript
interface Action {
  id: string;
  type: ActionType; // region-mark | satellite | fire-detector | ...
  name: string;
  description: string;
  params: Record<string, unknown>;
  dependsOn?: string[];
}
```

### ActionType 枚举

```typescript
type ActionType =
  | "region-mark"
  | "satellite"
  | "fire-detector"
  | "oil-drift"
  | "ais-fetch"
  | "ais-match-suspects"
  | "ais-suspect-ranking"
  | "maritime"
  | "weather-fetch"
  | "earthquake-evaluation"
  | "flood-evaluation"
  | "news";
```

---

## 六、校验规则（Executor 使用）

| Capability | 参数校验 |
|-----------|---------|
| region-mark | `region` 在预设列表 |
| satellite | 至少一个场景 flag |
| fire-detector | `region` 为 Kensai 或 `fromScenario` |
| oil-drift | context 有油膜数据 |
| ais-fetch | `region` 在 24 海域列表 |
| ais-match-suspects | context 有漂移结果 |
| ais-suspect-ranking | context 有匹配结果 |
| maritime | `region` 在 24 海域列表 |
| weather-fetch | `region` 在已知标签 |
| earthquake-evaluation | `region` 为柳州 + context 有影像 |
| flood-evaluation | `region` 为石门县 + context 有影像 |
| news | 至少一个场景 flag |

校验失败 → `CaseValidationError` → 阻断 → AI 分析 → requirement 提报。
