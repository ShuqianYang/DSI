# 火灾检测 Agent 联动规划

## Context

用户在前端左侧面板用中文询问火灾相关信息时（如"火灾"、"火情"、"着火"），后端 Agent 编排 Pipeline 应识别意图并调用 `fire-detector` 能力（当前 mock）。检测结果通过 SSE 推送到前端，前端依次执行：

1. 聊天面板显示 Agent 文本回复（如"检测到火灾，位于 Kensai 地区..."）
2. 地图自动导航到火灾区域（flyTo）
3. 叠加灾后影像 + 烧毁遮罩（mask PNG）

**约定**：
- 火灾遮罩 PNG：`s:\Projects\fireMarker\fire_mask_on_truecolor.png`
- 灾后影像 PNG（原始）：`s:\Projects\fireMarker\S2_post_Kensai_20250725.png`
- 灾后影像 PNG（前端引用）：`public/local-tiles/fire.png`
- 底图样式：保持当前，不切换

---

## 用户交互流程

```
用户: "帮我看看这片区域有没有火灾"
  → ChatPanel 发送消息到 /tasks
  → Planner 生成计划: [detectFire]
  → Router 识别中文火灾意图，路由到 fire-detector
  → Executor 执行 fire-detector (mock)
  → SSE 推送: ① 文本分析结果 ② GIS 数据
  → 前端聊天面板显示文本回复
  → 地图自动 flyTo 火灾区域 (76.998°E, 43.309°N, 30km)
  → 叠加灾后影像 + 烧毁遮罩
```

---

## 后端改动

### Step 1: 新建 `api/src/modules/actions/capabilities/fire.ts`

Mock 火灾检测能力，返回：
- 文本分析：火灾位置、面积、置信度
- GIS 数据：火灾区域实体（中心点 + 范围矩形）
- 元数据：遮罩 PNG 路径（供前端使用）

输出格式与现有 `maritime.ts` / `intelligence.ts` 一致，包含 `gisData` 字段。

### Step 2: 修改 `api/src/modules/actions/registry.ts`

注册 `fire-detector` action：
```typescript
fire: {
  name: 'fire-detector',
  handler: detectFire,
  description: '火灾检测与烧毁区域分析',
}
```

### Step 3: 修改 Router（`api/src/modules/router/`）

支持中文火灾意图识别。当用户查询包含以下关键词时路由到 `fire-detector`：
- "火灾"、"火情"、"着火"、"燃烧"、"烧毁"、"火灾检测"

### Step 4: 修改 Planner（`api/src/modules/planner/`）

火灾相关查询时生成调用 `fire-detector` 的计划步骤。

---

## 前端改动

### Step 5: 新建 `src/components/cesium/FireOverlay.ts`

火灾相关 overlay 管理（从 `LocalTileProvider.ts` 中拆分出来，保持独立）：
- `createFireOverlayProvider()` — 灾后影像 `SingleTileImageryProvider`
- `createFireMaskProvider()` — 烧毁遮罩 `SingleTileImageryProvider`
- `getFireRectangle()` — 返回火灾区域 `Cesium.Rectangle`

### Step 6: 修改 `CesiumMap.tsx`

- 导入 `createFireMaskProvider`
- 新增 `fireMaskRef` 跟踪遮罩图层
- 暴露 `showFireOverlay()` / `hideFireOverlay()` 方法（通过 `useImperativeHandle`）
- 收到火灾结果时自动 `flyToRegion(76.998, 43.309, 30000)`
- 叠加遮罩层（半透明红色覆盖烧毁区）

### Step 7: 修改 `GisViewer.tsx`

- 从 `useTaskChat` 或 SSE 接收火灾检测结果
- 调用 `cesiumMapRef.current?.flyToRegion(...)` 导航
- 调用 `cesiumMapRef.current?.showFireOverlay()` 显示遮罩

### Step 8: 修改 `ChatPanel.tsx`（或 `useTaskChat.ts`）

- 火灾检测结果先显示为文本消息（聊天气泡）
- 延迟 500ms 后触发地图导航（让用户先读完文字）

---

## 文件清单

| 操作 | 路径 | 说明 |
|------|------|------|
| 新建 | `api/src/modules/actions/capabilities/fire.ts` | 火灾检测 mock 能力 |
| 修改 | `api/src/modules/actions/registry.ts` | 注册 fire-detector |
| 修改 | `api/src/modules/router/` | 中文火灾意图路由 |
| 修改 | `api/src/modules/planner/` | 火灾检测计划生成 |
| 新建 | `src/components/cesium/FireOverlay.ts` | 火灾 overlay 管理（灾后影像+遮罩） |
| 修改 | `src/components/cesium/CesiumMap.tsx` | flyTo + 遮罩叠加 + 显隐控制 |
| 修改 | `src/components/cesium/LocalTileProvider.ts` | 灾后影像配置可迁移到 FireOverlay.ts |
| 修改 | `src/components/GisViewer.tsx` | 接收火灾结果 + 触发地图联动 |
| 修改 | `src/hooks/useTaskChat.ts` | 火灾结果解析 + 文本展示 + 延迟触发 |

---

## 验证步骤

1. 后端：`pnpm dev` 启动 API，POST `/tasks` 发送"火灾检测"，SSE 返回文本+GIS数据
2. 前端：聊天面板显示"检测到火灾，位于 Kensai 地区..."
3. 地图：自动飞到火灾区域（76.998°E, 43.309°N）
4. 图层：灾后影像 + 烧毁遮罩正确叠加（红色区域与灾后影像对齐）
5. 遮罩 PNG 不存在时：graceful fallback，只显示灾后影像和边界线
