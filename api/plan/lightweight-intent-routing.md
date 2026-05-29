# 轻量化意图路由 — Planner + Router 直接调 qwen

## 方案概述

Planner 和 Router 不再走 Dify，改为直接调用 qwen API。代码完全可控，零后台操作。

```
用户提问
  ↓
Planner（直接调 qwen）— 意图分类 ~500ms
  { intent, params, missingParams }
  ↓
├─ news ───────────────→ 直接调用 news capability，task completed
├─ earthquake/fire/oil_spill
│   ├─ 参数完整 ─────────→ 代码写死组装 action chain，跳过 Router
│   └─ 缺参数 ───────────→ 创建 requirement（"缺少 xxx 参数"）
└─ unknown ──────────────→ Router（直接调 qwen）生成 requirement 内容 ~500ms
                              ↓
                         同步提交外部接口（失败 fallback 本地记录）
```

## 延迟

| 路径 | 延迟 |
|---|---|
| news | qwen ~500ms + 执行 |
| 场景（完整参数） | qwen ~500ms + 执行 |
| 场景（缺参数） | qwen ~500ms + 本地入库 |
| unknown | qwen ~500ms + qwen ~500ms + 提交接口 | 最长 ~2s |

## 环境变量

```env
QWEN_API_KEY=your_key
QWEN_API_URL=https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation
QWEN_MODEL=qwen-turbo

GATEWAY_BASE_URL=http://192.168.0.136
GATEWAY_ACCESS_KEY=xxx
GATEWAY_SECRET_KEY=xxx
```

## 文件改动

### 新增

| 文件 | 职责 |
|---|---|
| `api/src/lib/qwen.ts` | qwen API 封装（fetch、超时、JSON 解析容错） |
| `api/src/modules/intent/types.ts` | 意图分类类型定义 |
| `api/src/modules/requirements/externalSubmit.ts` | 外部需求接口提交（鉴权签名、fetch、错误处理） |

### 修改

| 文件 | 改动 |
|---|---|
| `api/src/modules/planner/service.ts` | 新增 `classifyIntent(query)` — 调 qwen 返回极简 JSON |
| `api/src/modules/router/service.ts` | 新增 `generateRequirement(query)` — 调 qwen 生成需求内容 |
| `api/src/modules/tasks/pipeline.ts` | **重构入口**：先 intent 分类，再分路径处理 |
| `api/src/modules/actions/capabilities/requirement.ts` | 兼容外部提交后的数据结构 |

## qwen 调用封装（`api/src/lib/qwen.ts`）

```typescript
interface QwenConfig {
  apiKey: string;
  apiUrl: string;
  model: string;
}

export async function callQwen(options: {
  prompt: string;
  temperature?: number;
  timeoutMs?: number;
}): Promise<{ answer: string }> {
  // fetch qwen API
  // 8s 超时
  // 返回 { answer: 模型原始输出 }
}
```

## Planner 意图分类

```typescript
// planner/service.ts
const INTENT_PROMPT = `
你是意图分类器。分析用户提问，判断意图并提取参数。

可用意图：news, earthquake, fire, oil_spill, unknown

必需参数：
- earthquake/fire/oil_spill: region（区域）
- news: 无

严格返回 JSON：
{
  "intent": "news|earthquake|fire|oil_spill|unknown",
  "params": { "region": "", "query": "原始提问" },
  "missingParams": [],
  "confidence": 0.0-1.0
}

用户提问："{query}"
`;

export async function classifyIntent(query: string): Promise<IntentClassification> {
  const result = await callQwen({ prompt: INTENT_PROMPT.replace('{query}', query) });
  return parseIntentJson(result.answer);
}
```

## Router 需求生成（unknown 路径）

```typescript
// router/service.ts
const REQUIREMENT_PROMPT = `
你是需求分析师。用户提出了当前系统无法处理的需求，请整理为标准化描述。

用户提问："{query}"

严格返回 JSON：
{
  "name": "简短需求名称（20字内）",
  "description": "详细需求描述",
  "applicationScenario": "应用场景（海上监测/边境安全/灾害评估/舆情分析等）"
}
`;

export async function generateRequirement(query: string): Promise<RequirementData> {
  const result = await callQwen({ prompt: REQUIREMENT_PROMPT.replace('{query}', query) });
  return parseRequirementJson(result.answer);
}
```

## pipeline.ts 入口重构

```typescript
export async function runAgentPipeline(taskId: string, body: CreateTaskRequest) {
  // 1. qwen 意图分类
  const classification = await classifyIntent(body.query);

  switch (classification.intent) {
    case "news":
      return runNewsFlow(taskId, body, classification.params);

    case "earthquake":
    case "fire":
    case "oil_spill":
      if (classification.missingParams.length > 0) {
        return runRequirementFlow(taskId, body, {
          reason: `缺少必需参数：${classification.missingParams.join(", ")}`,
        });
      }
      return runScenarioFlow(taskId, body, classification.intent, classification.params);

    case "unknown":
    default:
      return runUnknownFlow(taskId, body);
  }
}

// 各路径实现
async function runNewsFlow(taskId, body, params) {
  // 直接调用 news capability
  const result = await actionsService.execute({
    type: "news", params: { query: body.query, ...params }
  });
  await taskService.updateTaskStatus(taskId, "completed");
  notifyTaskUpdate(taskId, { type: "completed", taskId, status: "completed" });
}

async function runScenarioFlow(taskId, body, intent, params) {
  // 写死组装 action chain
  const actions = buildScenarioActions(intent, params);
  await taskService.updateTaskActions(taskId, actions);
  // 走 executor（和现有流程一致）
  // ...
}

async function runUnknownFlow(taskId, body) {
  // qwen 生成 requirement 内容
  const reqData = await generateRequirement(body.query);
  // 本地入库
  const requirement = await createRequirement({ ...reqData, userId: body.userId });
  // 同步提交外部接口（失败不影响）
  const externalResult = await submitToExternalSystem(reqData).catch(() => ({ success: false }));
  // 返回提示
  notifyTaskUpdate(taskId, {
    type: "completed",
    taskId,
    status: "completed",
    message: externalResult.success
      ? "需求已提交至需求管理平台"
      : "需求已记录，后续将同步至需求平台",
  });
}
```

## 外部需求提交（`requirements/externalSubmit.ts`）

```typescript
import crypto from "crypto";

const GATEWAY_BASE_URL = process.env.GATEWAY_BASE_URL || "";
const ACCESS_KEY = process.env.GATEWAY_ACCESS_KEY || "";
const SECRET_KEY = process.env.GATEWAY_SECRET_KEY || "";

function generateSignature(secretKey: string, timestamp: number): string {
  return crypto.createHash("md5").update(secretKey + timestamp).digest("hex");
}

export async function submitToExternalSystem(data: RequirementData) {
  const timestamp = Date.now();
  const signature = generateSignature(SECRET_KEY, timestamp);
  const url = `${GATEWAY_BASE_URL}/sys-service-web/sysBackend/gt/requirement/issue`;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        accessKey: ACCESS_KEY,
        timestamp: String(timestamp),
        signature,
      },
      body: JSON.stringify({
        applicant: "数智融合智能体应用平台",
        applicationScenario: data.applicationScenario,
        description: data.description,
        name: data.name,
        source: "智能体平台",
        status: 0,
        type: "1",
      }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    return { success: resp.ok, status: resp.status };
  } catch (err) {
    clearTimeout(t);
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
```

## 存量场景 action chain（写死复用）

| 场景 | 调用 |
|---|---|
| earthquake | `buildEarthquakeActions(params)` |
| fire | `buildFireInvestigationActions(params)` |
| oil_spill | `buildOilSpillTracingActions()` |

## 实施顺序

1. **qwen 封装**（`lib/qwen.ts`）— 验证 qwen 可用
2. **Planner classifyIntent** — 跑通意图分类准确率
3. **Router generateRequirement** — 验证生成质量
4. **外部需求提交** — 验证网关接口
5. **pipeline 重构** — 接入 intent 路由
6. **端到端测试** — 5 条路径

## 风险与 fallback

| 风险 | fallback |
|---|---|
| qwen 返回非 JSON | `parseIntentJson` 容错 + 回退关键词匹配 |
| qwen API 不可用 | 完全回退到现有关键词匹配逻辑 |
| 外部需求接口失败 | 本地记录 requirement，返回"已记录" |
| 外部接口超时 | 8s AbortController，不阻断流程 |

## 与 Dify 方案对比

| 维度 | qwen 直接调用 | Dify 改提示词 |
|---|---|---|
| 后台操作 | 零 | 需登录 Dify 改 Prompt |
| 延迟 | 0.5-2s | 2-10s |
| 可控性 | 完全可控 | Dify 黑盒 |
| 部署 | 配 env 即可 | 需同步 Dify 配置 |
| 新增依赖 | qwen API | 无 |
