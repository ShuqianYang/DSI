# 火情订阅触发研判 Scenario — 实施计划

## Context

用户通过对话框提报"订阅火情智能研判服务"需求，平台自动生成订阅 → 订阅到点后自动发起一次新 Task，按"既定 Plan（火情研判）"完整走 Planner → Router → Executor 链路，过程在 chat 中以系统消息卡片实时展示，最终把研判结果标准化封装推送给"边防应用平台"作为下一个演示节点。

链路参照油污溯源（`buildOilSpillTracingPlan` + `buildOilSpillTracingActions`），只不过入口从"用户提问"换成"订阅到点"。

---

## 决策摘要

| 决策点 | 选择 | 说明 |
|---|---|---|
| Q1 完成态 | **C 混合** | 演示链路全跑通；订阅模型扩展 region 与 fire 研判触发链路按"真实可扩展"设计；其他写死 |
| Q2 query 文本 | **B 标准化** | `"[订阅触发] 火情研判·{regionName}"`；Planner 用 `isScheduledFireInvestigation()` 判定 |
| Q3 capability 颗粒度 | **复用 + 1 新增** | `news` / `satellite` / `fire-detector` 现有，各拓 fire 分支；新增 `border-push` |
| Q3 Planner/Router | **全部写死** | 不走 Dify，便于测试 |
| Q4 task 可见性 | **B chat 系统消息卡片** | scheduler 触发 → SSE 推 `subscription_triggered_task` → 前端 push 一条 assistant 卡片 → 接 SSE 实时跑 thinking chain |
| 范围排除 | 区域提取/手绘/语音 | 演示阶段暂不实现，region 直接写死 |

---

## 用户交互流程

```
[用户] 在 ChatPanel 输入：
       "订阅新疆边境与哈萨克斯坦接壤管段火情智能研判服务"
       ↓
[Planner] mockGeneratePlan / Dify
       识别 "订阅" + "火情" → 生成 2 步 plan：① 解析订阅需求 ② 配置定时研判
       ↓
[Router] parseActionsFromText
       hasSubscription=true → subscription action
       params.toolType = "fire-investigation-scenario"
       params.toolParams = { regionId: "xj-kz-border", regionName: "新疆-哈接壤段", bbox: [...] }
       ↓
[Executor] 执行 subscription capability
       写入 subscriptions 表：
         queryParams = { regionId, regionName, bbox, scenario: "fire-investigation" }
         toolType    = "fire-investigation-scenario"
         schedule    = "*/1 * * * *"  // demo 加快节奏，1 分钟触发一次
       ↓
[ChatPanel] 展示订阅创建成功
       事件流 / 右侧"订阅任务"标签出现新订阅

【~1 分钟后】

[Scheduler] cron 扫描到 due subscription
       识别 toolType === "fire-investigation-scenario"
       → 调 createScheduledFireTask({ regionName, bbox, regionId })
       → 创建新 agent task：
            query = "[订阅触发] 火情研judging·新疆-哈接壤段"
            inputs = { regionId, regionName, bbox, subscriptionId }
       → publish SSE: { type: "subscription_triggered_task", taskId, name }
       ↓
[前端 useTaskChat] 监听 subscription_triggered_task 事件
       → 在 chat 末尾 push 一条 assistant placeholder：
         "🔔 订阅「新疆-哈接壤段 火情研判」已自动触发，正在执行..."
       → startTaskSse(taskId)  // 复用现有 SSE 管线
       ↓
[Planner] 命中 isScheduledFireInvestigation(query)
       → 写死返回 buildFireInvestigationPlan(query, inputs)
       → 4 步 plan：
         ① 互联网火情线索核查
         ② 天基遥感影像获取与火情解译
         ③ 地图展示火情研判结果
         ④ 标准化封装推送边防平台
       ↓
[Router] 命中 isScheduledFireInvestigation(query)
       → 写死返回 buildFireInvestigationActions(inputs)
       → 4 个 actions：
         action-1: news        (params.fireScenario=true, region=regionName)
         action-2: satellite   (params.fireScenario=true, region=regionName, bbox)
         action-3: fire-detector (params.region=regionName, bbox, dependsOn=[action-2])
         action-4: border-push   (params.targetPlatform="border-defense", dependsOn=[action-3])
       ↓
[Executor] 串行执行 4 个 actions
       每个 step 完成 → SSE step_update → 前端 thinking chain 步骤亮起
       action-1 完成：news 返回 fire 分支硬编码新闻列表 → 事件卡片
       action-2 完成：satellite 返回 fire 分支硬编码影像数据（含 imageOverlays）→ 地图叠加
       action-3 完成：fire-detector 接收 region 参数返回 GIS 数据 → CesiumMap flyTo + 烧毁区 polygon
       action-4 完成：border-push 返回标准化封装 payload + push 成功状态 → 事件卡片
       ↓
[Executor] 综合洞察生成（Dify）→ events 表写入 insight
       ↓
[前端] chat 卡片显示研判完成 markdown + 地图保持 fire overlay
```

---

## 阶段拆分（每阶段可独立验证）

### 阶段 1：subscription 数据模型 + capability 扩展（半天）

**目标**：subscription 可接收并存储区域参数，scheduler 取出时能识别"火情研判 scenario"。

**改动**：
- `api/src/modules/actions/capabilities/subscription.ts`
  - `params.toolType === "fire-investigation-scenario"` 时，把 `regionId / regionName / bbox` 合并进 `toolParams`
  - 返回数据保持向后兼容
- `api/src/db/schema.ts` — **不改表**，复用现有 `queryParams JSONB` 字段
- （可选）在 `inferSubscribedToolType(goal)` 中加：含"边境" / "管段" / "火情" + "订阅" 关键字组合 → 返回 `"fire-investigation-scenario"`
- `inferSubscribedToolParams(goal, "fire-investigation-scenario")` 写死 region 字典：
  ```ts
  const REGION_PRESETS: Record<string, { regionId, regionName, bbox }> = {
    "新疆-哈萨克斯坦接壤段": { regionId: "xj-kz-border",
      regionName: "新疆-哈萨克斯坦接壤段",
      bbox: [79.5, 42.5, 88.0, 49.0] /* west, south, east, north */ },
    // 后续可加：中俄边境、中朝边境、台海...
  };
  ```

**验证**：在 chat 发"订阅新疆与哈萨克斯坦接壤段火情研判" → 看 `subscriptions` 表新行的 `queryParams` 是否包含 region 信息，`toolType === "fire-investigation-scenario"`。

---

### 阶段 2：scheduler 创建新 Task 分支（半天）

**目标**：scheduler 识别火情 scenario 订阅时不走单 capability，而是创建一个新 agent task。

**改动**：
- `api/src/modules/scheduler/service.ts`
  - 在 `executeSubscription` 顶部加分支：
    ```ts
    if (sub.toolType === "fire-investigation-scenario") {
      await createScheduledFireTask(sub);
      // 更新订阅 nextExecuteTime，return；不走 actionsService.execute
      return;
    }
    ```
  - 新增 `createScheduledFireTask(sub)`：
    ```ts
    // 调用 tasksController 同款入口 / 或抽 tasks/service.createAgentTask
    const regionName = (sub.queryParams as any)?.regionName || "未知区域";
    const inputs = sub.queryParams;
    const query = `[订阅触发] 火情研判·${regionName}`;
    const { taskId } = await tasksService.createAgentTask({
      userId: sub.userId,
      query,
      inputs,
      source: "subscription",
      sourceId: sub.id,
    });
    redisPublisher.publish(SSE_CHANNEL, JSON.stringify({
      type: "subscription_triggered_task",
      subscriptionId: sub.id,
      taskId,
      name: sub.name,
      query,
    }));
    ```
- `api/src/modules/tasks/service.ts`（如果还没有 `createAgentTask` 内部入口）
  - 抽出 controller 里的 createAgentTask 逻辑成 service 方法，供 controller 和 scheduler 复用

**验证**：把某条火情订阅的 `nextExecuteTime` 调到 1 分钟内，等 cron 触发 → 看：
1. `tasks` 表新增一行 query 形如 `[订阅触发] 火情研判·...`
2. Redis SSE 上有 `subscription_triggered_task` 事件
3. **此时前端还没接，所以新 task 暂时只在数据库里**

---

### 阶段 3：Planner / Router 写死 fire-investigation scenario（1 天）

**目标**：标准化 query 进 Planner/Router 后，输出固定 4 步 plan + 4 个 actions。

**改动**：
- `api/src/modules/planner/service.ts`
  - 新增 `isScheduledFireInvestigation(query) = query.startsWith("[订阅触发] 火情研判")`
  - 新增 `buildFireInvestigationPlan(query, inputs)` —— 参考 `buildOilSpillTracingPlan`，返回 scenario plan：
    ```ts
    return {
      goal: query,
      steps: [
        { id: "step-1", description: "互联网火情线索核查", purpose: "...", expectedOutput: "..." },
        { id: "step-2", description: "天基遥感影像获取与火情解译", ... },
        { id: "step-3", description: "地图展示火情研判结果", ... },
        { id: "step-4", description: "标准化封装推送边防平台", ... },
      ],
      reasoning: "订阅自动触发，按...",
      scenario: { name: "新疆-哈接壤段火情智能研判", ... },
      subtasks: [...],  // 与 steps 对应的详细 subtask
      mainTask: { name, id, status: "执行中", progress: 0 },
      thinkingChain: { intentRecognition, entityExtraction, taskPlanning, ... },
    };
    ```
  - 在 `generatePlan` 入口顶部加：
    ```ts
    if (isScheduledFireInvestigation(query)) {
      return buildFireInvestigationPlan(query, context);
    }
    ```
- `api/src/modules/router/service.ts`
  - 同步加 `isScheduledFireInvestigation`
  - 新增 `buildFireInvestigationActions(plan, inputs)` —— 返回 4 个 action：
    ```ts
    [
      { id: "action-1", type: "news",
        params: { query: `${regionName} 火情`, fireScenario: true, region: regionName, timeRange: "7d" },
        dependsOn: [] },
      { id: "action-2", type: "satellite",
        params: { query: `${regionName} 火情遥感影像`, fireScenario: true, region: regionName, bbox },
        dependsOn: ["action-1"] },
      { id: "action-3", type: "fire-detector",
        params: { region: regionName, bbox, fromScenario: true },
        dependsOn: ["action-2"] },
      { id: "action-4", type: "border-push",
        params: { targetPlatform: "border-defense", scenario: "fire-investigation", region: regionName },
        dependsOn: ["action-3"] },
    ]
    ```
  - `decideActions` 入口加分支：
    ```ts
    if (isScheduledFireInvestigation(queryText)) {
      return buildFireInvestigationActions(plan, inputs);
    }
    ```

**验证**：手动 POST `/tasks` 带 query `[订阅触发] 火情研判·新疆-哈接壤段` → 看 SSE：
1. `planning_done` 给出 4 步 plan
2. `routing_done` 给出 4 个 action（news / satellite / fire-detector / border-push）

---

### 阶段 4：现有 capability 扩展 fire 分支（半天）

**目标**：3 个现有 capability 在接收到 `fireScenario: true` 或 `fromScenario: true` 时返回写死的火情场景数据。

**改动**：
- `api/src/modules/actions/capabilities/news.ts`
  - 顶部加：
    ```ts
    if (params.fireScenario === true) {
      return {
        success: true,
        data: {
          summary: { overview: `检索到${params.region}近期火情相关报道 5 条...`, totalFound: 5, totalReturned: 5 },
          articles: [
            { title: "新疆边境某管段附近发现可疑烟柱", source: "...", publishedAt: "...", summary: "...", relevanceScore: 0.92 },
            // 5 条火情新闻 mock
          ],
          trends: [{ topic: "边境火情", sentiment: "negative", articleCount: 5 }],
        },
        metadata: { capability: "news", responseType: "fire-scenario", mock: true },
      };
    }
    // 否则走原逻辑
    ```
- `api/src/modules/actions/capabilities/satellite.ts`
  - 在 `oil-spill` 分支前 / 类似位置加：
    ```ts
    if (params.fireScenario === true) {
      // 返回火情场景的影像数据：含 imageOverlays（指向 /local-tiles/fire.png）
      return {
        success: true,
        data: {
          message: `已为您调度天基资源完成 **${params.region}** 区域火情成像...`,
          data: {
            type: "fire_imaging",
            responseType: "fire_imaging",
            imageCount: 1,
            resolution: "1m",
            satelliteType: "高分五号A星",
            gisData: {
              type: "region",
              regions: [],
              imageOverlays: [{
                id: "fire-imagery-1",
                url: "/local-tiles/fire.png",
                rectangle: FIRE_BBOX,  // 用 region preset 里的 bbox
                alpha: 0.9,
                tileWidth: 691,
                tileHeight: 502,
              }],
              cameraView: { type: "point", lng: 76.998, lat: 43.309, altitude: 30000 },
            },
          },
        },
        metadata: { capability: "satellite", responseType: "fire_imaging", mock: true },
      };
    }
    ```
- `api/src/modules/actions/capabilities/fire.ts`
  - 接收 `params.region` / `params.bbox`，若有则用之，否则保留现有 Kensai 兜底
  - 输出结构基本不变（含 gisData.entities + regions + overlayMeta）

**验证**：手动 POST `/tasks` 同阶段 3 的 query → 看 step_update 中 news/satellite/fire 各自返回的 fire 分支数据。

---

### 阶段 5：新增 border-push capability（半天）

**目标**：把研判结果（fire 输出 + satellite 输出 + news 输出）打包成标准化 payload，调用 mock webhook（或仅 console.log + 返回成功状态），让"下一个平台"演示节点可消费。

**改动**：
- 新建 `api/src/modules/actions/capabilities/border-push.ts`：
  ```ts
  export const borderPushCapability: Capability = {
    name: "border-push",
    description: "标准化封装火情研判事件并推送至边防应用平台",
    execute: async (action, context) => {
      const params = action.params as { targetPlatform: string; scenario: string; region: string };
      // 从 context 提取依赖结果
      const fireResult = Object.values(context || {}).find((v: any) => v?.gisData?.type === "fire");
      const satResult = Object.values(context || {}).find((v: any) => v?.data?.responseType === "fire_imaging");
      const newsResult = Object.values(context || {}).find((v: any) => v?.articles);

      const payload = {
        eventId: uuidv4(),
        eventType: "fire-investigation",
        timestamp: new Date().toISOString(),
        region: params.region,
        firePoint: fireResult?.summary?.centerCoordinates,
        burnedAreaHectares: fireResult?.summary?.burnedAreaHectares,
        riskLevel: fireResult?.summary?.confidence === "high" ? "高危" : "中危",
        affectedArea: fireResult?.gisData?.regions?.[0],
        satelliteImagery: { imageCount: satResult?.data?.imageCount, satelliteType: satResult?.data?.satelliteType },
        clueSources: (newsResult?.articles || []).map((a: any) => ({ title: a.title, source: a.source })),
        targetPlatform: params.targetPlatform,
        // 边防平台需要的标准化字段
      };

      // mock 推送：写日志 + 返回成功
      console.log("[BorderPush] Payload to border-defense platform:", JSON.stringify(payload, null, 2));

      return {
        success: true,
        data: {
          pushed: true,
          targetPlatform: params.targetPlatform,
          payload,
          summary: `已将火情研判事件标准化封装并推送至「边防应用平台」，事件 ID: ${payload.eventId}`,
        },
        metadata: { capability: "border-push", mock: true },
      };
    },
  };
  ```
- `api/src/modules/actions/registry.ts` — 注册：
  ```ts
  "border-push": borderPushCapability,
  ```
- `api/src/modules/executor/service.ts` — `writeDisplayData` 增加 case：
  ```ts
  case "border-push": {
    const d = data as { pushed?: boolean; targetPlatform?: string; payload?: any; summary?: string };
    await db.insert(events).values({
      taskId: jobTaskId,
      taskName: action.name,
      title: `火情研判事件已推送（${d.targetPlatform || "边防应用平台"}）`,
      content: d.summary + "\n\n```json\n" + JSON.stringify(d.payload, null, 2) + "\n```",
      status: "success",
      agentTaskId,
    });
    break;
  }
  ```
- `packages/shared` 的 `ActionType` 加 `"border-push"`

**验证**：手动 POST `/tasks` → 看 border-push 步骤完成 → events 表有"已推送"事件 → API 日志看到 payload JSON。

---

### 阶段 6：前端 chat 系统消息卡片（半天）

**目标**：scheduler 触发新 task 时，chat 末尾自动冒出一条 assistant 卡片，接 SSE 实时跑 thinking chain。

**改动**：
- `src/hooks/useTaskChat.ts`
  - 新增一个独立的"全局 SSE 订阅"或扩展现有连接，监听 `subscription_triggered_task` 事件：
    ```ts
    useEffect(() => {
      const globalEs = new EventSource(`http://localhost:3001/sse/global`);  // 或复用 /events 通道
      globalEs.addEventListener("subscription_triggered_task", (e) => {
        const data = JSON.parse(e.data);  // { taskId, name, query }
        const placeholderId = `ai-sub-${Date.now()}`;
        const placeholderMsg: ChatMessage = {
          id: placeholderId,
          role: "assistant",
          taskId: data.taskId,
          content: `🔔 订阅「${data.name}」已自动触发，正在执行火情研判...\n\n**任务编号**：${data.taskId}`,
          timestamp: Date.now(),
          thinking: `订阅自动触发：${data.query}`,
          thinkingSteps: [
            { id: "planner", name: "任务规划", status: "pending", detail: "等待开始..." },
            { id: "router", name: "工具决策", status: "pending", detail: "等待规划完成..." },
          ],
          isThinkingExpanded: true,
        };
        setMessages((prev) => [...prev, placeholderMsg]);
        startTaskSse(data.taskId);
      });
      return () => globalEs.close();
    }, []);
    ```
- `api/src/sse/sseManager.ts` 或新增 `/sse/global` 路由：暴露一个不绑定 taskId 的全局 SSE 通道，订阅 Redis `subscription_triggered_task` 频道
  - **简化做法**：复用 `/events` 通道并加事件类型筛选；或在 `/tasks/:id/stream` 之外加一个 `/tasks/stream-global` 接口

**验证**：完整跑通：
1. chat 输入"订阅新疆与哈萨克斯坦接壤段火情研判"
2. 看 chat 卡片显示订阅创建成功
3. 调整订阅 `nextExecuteTime` 到 1 分钟内，等触发
4. chat 末尾自动冒新卡片 → thinking chain 4 步逐个亮起 → 地图飞向边境区域、叠加 fire overlay
5. 卡片最终显示 border-push 完成、events 表有推送事件

---

### 阶段 7：联调 + demo 录制（半天）

**目标**：把全链路串起来，调整节奏（已有 demo 节奏 `setTimeout(10000)` in executor），打磨展示文案。

**改动**：
- 调整 region preset、影像 PNG 路径（视演示需要换图）
- `src/lib/taskResultFormatter.ts` — 给 border-push 加 markdown 渲染格式
- 测试两次完整流程：用户提问 → 订阅 → 触发 → 研判 → 推送

---

## 文件清单

| 操作 | 路径 | 说明 |
|---|---|---|
| 改 | `api/src/modules/actions/capabilities/subscription.ts` | 接收 `fire-investigation-scenario` toolType，存 region |
| 改 | `api/src/modules/router/service.ts` | `inferSubscribedToolType` 加火情 scenario；新增 `buildFireInvestigationActions` + `isScheduledFireInvestigation` 判定 |
| 改 | `api/src/modules/planner/service.ts` | 新增 `buildFireInvestigationPlan` + `isScheduledFireInvestigation` 判定 |
| 改 | `api/src/modules/scheduler/service.ts` | 识别火情 scenario → 调 `createScheduledFireTask` 走完整 task 链路 |
| 改 | `api/src/modules/tasks/service.ts`（可能） | 抽 controller 中 createAgentTask 成 service 方法 |
| 改 | `api/src/modules/actions/capabilities/news.ts` | `fireScenario` 分支返回火情新闻 mock |
| 改 | `api/src/modules/actions/capabilities/satellite.ts` | `fireScenario` 分支返回火情影像 mock（含 imageOverlays） |
| 改 | `api/src/modules/actions/capabilities/fire.ts` | 接收 `region` / `bbox` 参数，写动态 GIS 数据 |
| 新建 | `api/src/modules/actions/capabilities/border-push.ts` | 标准化封装 + mock 推送 |
| 改 | `api/src/modules/actions/registry.ts` | 注册 `border-push` |
| 改 | `api/src/modules/executor/service.ts` | `writeDisplayData` 加 `border-push` case |
| 改 | `packages/shared/src/types/...` | `ActionType` 加 `"border-push"` |
| 改 | `src/hooks/useTaskChat.ts` | 监听 `subscription_triggered_task` → push 系统消息卡片 |
| 改 | `api/src/sse/sseManager.ts`（可能） | 暴露全局 SSE 通道或复用 events 通道 |
| 改 | `src/lib/taskResultFormatter.ts` | border-push 输出格式化 |

---

## 风险与待定

- **scheduler 复用 createAgentTask 路径**：现有 controller 实现可能与 service 层耦合（请求上下文、auth），抽出来时需要保留这些信息。先快速读 `tasks/controller.ts` 确认抽取边界。
- **全局 SSE 通道**：当前 SSE 是 task-scoped（`/tasks/:id/stream`），需要新增一个"用户级"或"全局"通道供前端在没有 taskId 时也能监听。可在阶段 6 开始前快速决策："新通道"还是"复用 /events"。
- **demo 节奏**：scheduler 1 分钟扫描是最小颗粒度，已经够快；如要更快可临时改 cron 为 `*/10 * * * * *`（每 10 秒），但要注意 node-cron 默认不支持秒级，需要传 `{ scheduled: true }` 之外的配置。
- **演示中 region 字典**：当前只写新疆-哈萨克接壤段，其他常用边境（中俄/中朝/台海）可在阶段 1 时一次性加进字典。

---

## 验证清单（演示前）

- [ ] chat 输入"订阅新疆与哈萨克斯坦接壤段火情研判" → 订阅记录入库且 `queryParams` 含 region 信息
- [ ] 调整 nextExecuteTime → scheduler 触发后 `tasks` 表多一行 `[订阅触发]` 开头的 task
- [ ] chat 末尾自动冒卡片 → 4 步 thinking chain 完整动画 → 地图飞 + 叠图
- [ ] events 表有 4 条事件（news / satellite / fire / border-push）
- [ ] border-push 控制台日志可见完整 payload JSON
- [ ] 用户单独问"火灾检测"仍走原 isFireQuery 4 步固定 plan（不被新逻辑污染）
