# Agent Loop 迁移路线长期参考

> 目标：记录旧 Planner/Router/Executor/Capability 体系向 Agent Loop 迁移的当前进度、下一步顺序和长期收敛方向，方便后续继续推进时快速接上上下文。

## 当前结论

Agent Loop 已经可以作为主执行入口承接前端提问，并通过兼容层维持旧前端的任务、事件和 GIS 联动能力。当前不建议批量搬运旧 capability，而应继续按“真实/半真实数据优先、纯 mock/硬编码能力暂缓”的原则迁移。

当前最稳的新增纵切是：

```text
RegionResolve -> RegionMark -> WeatherFetch
```

这条链路覆盖了“命名区域解析、本地 GIS 区域联动、真实气象风场数据获取”三个关键点，比直接迁移旧 `region-mark` / `weather-fetch` 的 mock 版本更适合 Agent Loop。

## 已完成

### 1. 兼容路由

已补齐旧前端依赖的展示路由：

- `/jobs`
- `/events`
- `/events/:id`
- `/subscriptions`
- `/requirements`
- `/insights`
- `/ais/data`
- `/ads/data`

核心文件：

- `api/src/modules/dashboard/projection.ts`
- `api/src/modules/dashboard/service.ts`
- `api/src/modules/dashboard/controller.ts`
- `api/src/modules/dashboard/routes.ts`
- `api/src/index.ts`

说明：

- `/jobs` 动态投影 `tasks` / `task_steps`。
- `/events` 动态投影 completed / failed tool step。
- `/ads/data` 读取 `aircraft_current_states`。
- `/ais/data` 当前仍是空结构兼容。

### 2. Legacy SSE Adapter

已实现 Agent Loop 事件到旧前端 SSE 事件的适配。

核心文件：

- `api/src/modules/tasks/agentLoopEventAdapter.ts`
- `api/src/modules/tasks/pipeline.ts`
- `api/src/modules/agent-loop/runAgentLoop.ts`

已适配事件：

- `agent_turn -> planning_done`
- `assistant_message.toolCalls -> routing / routing_done`
- `tool_call / tool_progress -> step_update running`
- `tool_observation -> step_update completed / failed`

说明：

- 旧前端仍可通过 `step_update.gisData` 实时推地图。
- 后续前端原生支持 Agent Loop 事件后，该层可以删除。

### 3. task.result 兼容投影

已把 Agent Loop 的 observations 投影为旧前端可遍历的 action result 结构。

核心文件：

- `api/src/modules/tasks/agentLoopResultProjection.ts`
- `api/src/modules/tasks/pipeline.ts`

当前 `task.result` 同时保留：

```ts
{
  message,
  mode: "agent_loop",
  turns,
  stoppedBy,
  observations,
  [toolCallId]: {
    success,
    gisData,
    metadata
  }
}
```

作用：

- SSE 实时推送失败或前端刷新后，旧前端仍能从 `task.result[toolCallId].gisData` 兜底恢复地图数据。

### 4. OpenSky 真实数据链路

已完成 OpenSky 获取、落库、worker 和 smoke 测试链路的主要修复。

已修重点：

- OpenSky 空 `states` 不替换当前表。
- 无效 `icao24` / `last_contact` 计数。
- worker shutdown 加超时保护。
- `.env` 补齐 OpenSky / Agent Loop 相关变量。
- `agent:smoke -- --refresh-opensky --query ...` 可触发真实写入后测试。

### 5. 真实/半真实 GIS 工具纵切

已完成三个 Agent Loop domain tools：

#### WeatherFetch

核心文件：

- `api/src/modules/agent-loop/weatherTools.ts`
- `api/tests/test-weather-fetch-tool.mjs`

边界：

- 只接受明确 `center` / `bbox`。
- 只查 Open-Meteo。
- 不猜默认区域。
- 不返回 mock 风场。
- 输出 `gisData.windField`。

#### RegionMark

核心文件：

- `api/src/modules/agent-loop/regionTools.ts`
- `api/tests/test-region-mark-tool.mjs`

边界：

- 只接受明确 `bbox` / `polygon`。
- 不解析地名。
- 不内置 preset。
- 不 fallback 到东海。
- 输出 `gisData.region` 和 `cameraView: { type: "fit-bbox", bbox }`。

#### RegionResolve

核心文件：

- `api/src/modules/agent-loop/regionResolveTool.ts`
- `api/tests/test-region-resolve-tool.mjs`
- `api/tests/test-region-resolve-error-handling.mjs`

边界：

- 只读本地 GeoJSON 资产。
- 不联网。
- 不生成 bbox。
- 不写死台湾海峡。
- 当前支持 `public/geo/china.geojson` 和 `public/geo/eastern_china_sea.geojson`。

当前可解析：

- `东海` / `中国东海`
- 中国省级行政区，例如 `福建省`、`广西`

当前不可解析：

- `台湾海峡`，除非后续补真实 GeoJSON 或区域 catalog。

## 当前未完成

### 1. GIS 工具链端到端 smoke

下一步优先做。

目标链路：

```text
用户提问：圈选东海并查询风场
-> RegionResolve
-> RegionMark
-> WeatherFetch
-> SSE step_update 推 gisData
-> task.result 持久化 gisData
-> 前端地图可恢复区域和风场
```

建议新增：

- `api/tests/test-agent-loop-gis-toolchain-smoke.mjs`

测试重点：

- fake model 依次调用 `RegionResolve`、`RegionMark`、`WeatherFetch`。
- mock `fetch` 返回 Open-Meteo 数据。
- 检查 legacy SSE 中至少出现 region 和 wind-field 两类 `gisData`。
- 检查 `buildAgentLoopTaskResult` 可投影两个 toolCallId。

### 2. Agent Loop GIS 工具调用策略

需要在 prompt / skill / system instruction 中补规则。

建议策略：

```text
When the user asks to mark, focus, circle, display, or analyze a named geographic region:
1. Call RegionResolve first.
2. If resolved=true, call RegionMark with selected.bbox.
3. If downstream weather, aircraft, or maritime data is requested, reuse the same bbox.
4. If resolved=false, do not guess. Ask for bbox/polygon or say the region GeoJSON is missing.
```

目标：

- 让模型稳定形成 `RegionResolve -> RegionMark -> downstream tools` 的顺序。
- 避免把“台湾海峡”直接塞给 `RegionMark` 导致失败。

### 3. MaritimeSituation / FireAnalyze 迁移评估

当前还没有迁移。

原则：

- 只迁真实或半真实数据能力。
- 旧代码中纯 mock / 场景写死能力暂缓。
- 不把旧 Planner/Router 的任务顺序硬搬进 Agent Loop。

建议先评估：

#### MaritimeSituation

风险：

- 旧实现依赖的 AIS 数据源 / 内存存储在当前分支不完整。
- 如果没有真实 AIS / ShipDT 数据源，迁移价值有限。

建议：

- 先确认 AIS 数据源是否真实可用。
- 若可用，做 `MaritimeSituation` 为只读 domain tool。
- 若不可用，暂缓。

#### FireAnalyze

风险：

- 旧实现 mock 和固定场景较多。
- 如果没有真实火点/遥感/新闻数据源，容易回到硬编码 demo。

建议：

- 只在有真实火情数据输入时迁。
- 否则先不迁。

### 4. 批量迁移其他 capability

当前未开始。

迁移顺序建议：

1. 已有真实数据源的工具。
2. 有外部 API 且失败可明确返回 unavailable 的工具。
3. 能输出稳定 GIS 数据结构的工具。
4. 纯 mock / 场景写死工具最后处理，或直接删除。

暂缓迁移：

- `news`
- `satellite`
- `oil-drift`
- `ais-fetch`
- `ais-match-suspects`
- `ais-suspect-ranking`
- `fire`
- `earthquake-evaluation`
- `flood-evaluation`

这些旧能力中 mock、固定区域、固定剧情成分较高，应先判断产品是否仍需要 demo 场景。

### 5. 前端原生支持 Agent Loop 事件

当前未开始。

目标：

- 前端直接识别 Agent Loop 原生事件：
  - `agent_turn`
  - `assistant_message`
  - `tool_call`
  - `tool_progress`
  - `tool_observation`
  - `loop_stop`

完成后可以减少 legacy adapter 的语义损耗。

建议阶段：

1. 新增前端 Agent Loop event parser。
2. ChatPanel 支持原生 tool step 展示。
3. 地图继续从 `tool_observation.output.gisData` 提取。
4. RightPanel / InfoCenter 改读原生 task result。
5. 保留旧 adapter 一段时间做双轨验证。

### 6. 删除旧 pipeline / 旧事件兼容层

当前不能删。

删除前置条件：

- 前端原生支持 Agent Loop 事件。
- `/jobs` / `/events` 不再依赖旧结构投影，或投影被明确保留为展示 API。
- 所有保留 capability 都已经迁成 Agent Loop tools。
- smoke / e2e 覆盖聊天、GIS、OpenSky、订阅或需求生成核心路径。

可删除候选：

- legacy SSE adapter。
- task.result 旧 actionId 投影。
- 旧 planner/router/executor 残余测试脚本。
- 旧 mock capability 文件或 issue 中明确废弃的能力。

### 7. 长期能力：Memory / Transcript / Prompt Versioning

当前未开始。

建议顺序：

1. Transcript persistence
   - 保存每轮 messages、tool calls、observations。
   - 支持任务恢复和调试。

2. Prompt versioning
   - 给 system prompt / skill prompt / tool policy prompt 加版本号。
   - 每次 agent run 记录 prompt version。

3. Memory
   - 先做只读摘要记忆。
   - 再做跨任务偏好或区域上下文记忆。
   - 避免一开始引入不可控写入。

## 推荐下一步

优先级最高的是：

```text
补 GIS 工具链端到端 smoke
```

原因：

- `RegionResolve`、`RegionMark`、`WeatherFetch` 都已经单测通过。
- legacy SSE adapter 和 task.result 投影也已经存在。
- 但还缺一个完整的 agent-loop 级测试证明模型工具调用链、SSE、最终 result 可以协同工作。

建议下一步任务：

1. 新增 `api/tests/test-agent-loop-gis-toolchain-smoke.mjs`。
2. 用 fake model 明确模拟工具调用顺序。
3. mock Open-Meteo fetch。
4. 断言 SSE 中 region / wind-field 都出现。
5. 断言最终 result 里按 toolCallId 可读到两个 `gisData`。
6. 再补 prompt 策略，让真实模型更稳定地走同样顺序。

## 验证命令参考

当前相关测试：

```powershell
cd api
.\node_modules\.bin\tsx.CMD tests\test-region-resolve-tool.mjs
.\node_modules\.bin\tsx.CMD tests\test-region-resolve-error-handling.mjs
.\node_modules\.bin\tsx.CMD tests\test-region-mark-tool.mjs
.\node_modules\.bin\tsx.CMD tests\test-weather-fetch-tool.mjs
.\node_modules\.bin\tsx.CMD tests\test-agent-loop-result-projection.mjs
.\node_modules\.bin\tsx.CMD tests\test-legacy-sse-adapter.mjs
.\node_modules\.bin\tsc.CMD
```

真实 OpenSky smoke：

```powershell
cd api
pnpm agent:smoke -- --refresh-opensky --query "查询台湾海峡附近当前有哪些飞机，列出 callsign、国家、经纬度和高度。" --max-turns 10
```

GIS 工具可尝试提问：

```text
圈选东海并查询这个区域的风场。
```

明确几何提问：

```text
标记一个区域，名称台湾海峡测试区，west=119.5 east=122.5 south=22 north=25.5。
```

注意：当前 `台湾海峡` 作为纯地名不会被 `RegionResolve` 解析，除非补真实区域 GeoJSON。
