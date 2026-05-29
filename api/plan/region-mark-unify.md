# 实时 vs 回放视觉对齐 —— region-mark 路径统一

> 父背景：`scenario-oil-spill-tracing.md` 整体里 region-mark 的 GIS 渲染目前有两条不一致的路径
> 范围：**只 scope 到 region-mark**。其他 capability（satellite / fire / oil-drift 等）暂不动 operations，等本方案验证 OK 后再批量迁移。

---

## Context

| 触发场景 | 数据来源 | 渲染入口 | 样式 |
|---|---|---|---|
| A. 后端实时跑 | SSE `step_update.operations` | `CesiumMap.executeOperation` (line 1214-1310) → `viewer.entities.add({ polyline, ... })` | **蓝 4px polyline 不填充 + label**（由 capability `operations[].style` 决定）|
| B. 用户点事件回放 | DB `events.gisData` | `eventGisDataList` → `syncRegions` (line 867-910) → `ds.region.entities.add({ polygon })` | **橙 2px 边框 + 橙 20% 半透明填充，无 label**（前端按 `region.type === "monitor"` 硬编码）|

附带 bug：A 路径写到 `opLayersRef` 的实体跟 `eventGisDataList` 不联动，event close 时**清不掉**，越点越脏。

**目标**：让 region.style 与 region.label 跟 region.coordinates 同一份 source of truth，路径 A/B 都走 `syncRegions` 渲染。

---

## 关键文件

| 操作 | 文件 |
|---|---|
| 修改 | `S:\Projects\projects_new\packages\shared\src\types\maritime.ts`（Region 加 optional `style` + `label`）|
| 修改 | `S:\Projects\projects_new\api\src\modules\actions\capabilities\region-mark.ts`（style/label 写入 gisData.regions[0]；删除 operations 数组）|
| 修改 | `S:\Projects\projects_new\src\components\cesium\CesiumMap.tsx` syncRegions (line 882-909)（读 region.style 优先；region.label 渲 LabelGraphics）|
| 不动 | `api/src/modules/executor/service.ts` `case "region-mark"` —— 已经 `gisData: gisData ? gisData : undefined` 透传 |
| 不动 | 其他 capability（保留 operations 路径不破坏 satellite / fire 等）|

---

## Ordered Phases

### Phase A — shared schema 加可选字段

`packages/shared/src/types/maritime.ts`：

```diff
 export const Region = z.object({
   id: z.string(),
   name: z.string(),
   type: RegionType,
   coordinates: z.array(z.tuple([z.number(), z.number()])),
   rules: z.string().optional(),
+  style: z.object({
+    fill: z.boolean().optional(),                 // 是否填充，默认按 type 给默认
+    fillColor: z.string().optional(),             // css 颜色字符串
+    outlineColor: z.string().optional(),
+    outlineWidth: z.number().optional(),
+  }).optional(),
+  label: z.object({
+    text: z.string(),
+    position: z.tuple([z.number(), z.number()]).optional(),  // 不传则用 region 中心点
+  }).optional(),
 });
```

**验证**：`pnpm --filter @datasourceintelligence/shared build` 无报错；下游 zod 推导类型可见 `region.style / region.label`。

---

### Phase B — region-mark capability 重写输出

`api/src/modules/actions/capabilities/region-mark.ts`：

把现在 `operations: [{ type:"flyTo", ... }, { type:"renderLayer", ... }]` 删掉，把 style / label 挪进 `gisData.regions[0]`：

```diff
 const data = {
   regionName: sea.name,
   bounds: sea.bounds,
   boundaryDescription: "...",
   coordinateSystem: "WGS84",
   gisData: {
     type: "region" as const,
     regions: [
       {
         id: "region-east-china-sea",
         name: sea.name,
         type: "monitor" as const,
         coordinates: sea.outline,
+        style: {
+          fill: false,
+          outlineColor: "#0064FF",
+          outlineWidth: 4,
+        },
+        label: {
+          text: `中国东海\n东经 ${sea.bounds.west}°–${sea.bounds.east}° / 北纬 ${sea.bounds.south}°–${sea.bounds.north}°`,
+          position: [(sea.bounds.west + sea.bounds.east) / 2, (sea.bounds.south + sea.bounds.north) / 2],
+        },
       },
     ],
   },
-  operations: [
-    { type: "flyTo" as const, bounds: sea.bounds, altitude: 2000000, duration: 1.5 },
-    { type: "renderLayer" as const, ... },
-  ],
 };
```

> 镜头 flyTo 不再由 capability 显式输出 —— 前端 `CesiumMap.tsx:920-951` 的"eventGisDataList 新增时 auto-flyTo"逻辑已经能根据 region.coordinates 算 bounds 自动飞镜头，足够覆盖回放和实时两条场景。

**验证**：`tsc --noEmit` 0 新错；POST 油污 query 后 `task_steps` 第 1 条 `result.data.operations` 不存在、`result.data.gisData.regions[0].style` 存在。

---

### Phase C — CesiumMap.syncRegions 读 region.style + label

`src/components/cesium/CesiumMap.tsx:867-910`：

```diff
 allRegions.forEach((region: Region) => {
   const hierarchy = region.coordinates.map(([lng, lat]) =>
     Cesium.Cartesian3.fromDegrees(lng, lat, 0)
   );
-  const color = region.type === 'control' ? 'rgba(255,68,68,0.2)' : ...;
-  const outlineColor = region.type === 'control' ? '#FF4444' : ...;
+  // 优先用 region.style；缺则按 type 默认
+  const typeDefaults = region.type === 'control'
+    ? { fillColor: 'rgba(255,68,68,0.2)', outlineColor: '#FF4444', outlineWidth: 2, fill: true }
+    : region.type === 'monitor'
+      ? { fillColor: 'rgba(255,170,0,0.2)', outlineColor: '#FFAA00', outlineWidth: 2, fill: true }
+      : { fillColor: 'rgba(0,224,255,0.2)', outlineColor: '#00E0FF', outlineWidth: 2, fill: true };
+  const s = region.style ?? {};
+  const fill = s.fill ?? typeDefaults.fill;
+  const fillColor = s.fillColor ?? typeDefaults.fillColor;
+  const outlineColor = s.outlineColor ?? typeDefaults.outlineColor;
+  const outlineWidth = s.outlineWidth ?? typeDefaults.outlineWidth;

   ds.region.entities.add({
+    // 用 polyline 画边框（同 executeOperation 的做法，width 比 polygon outline 更可靠）
+    polyline: {
+      positions: [...hierarchy, hierarchy[0]],
+      width: outlineWidth,
+      material: Cesium.Color.fromCssColorString(outlineColor),
+      clampToGround: true,
+    },
+    ...(fill ? {
       polygon: {
         hierarchy: new Cesium.PolygonHierarchy(hierarchy),
-        material: Cesium.Color.fromCssColorString(color),
-        outline: true,
-        outlineColor: Cesium.Color.fromCssColorString(outlineColor),
-        outlineWidth: 2,
+        material: Cesium.Color.fromCssColorString(fillColor),
+        outline: false,
         heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
       },
+    } : {}),
   });
+
+  // 可选 label
+  if (region.label?.text) {
+    const labelPos = region.label.position ?? [
+      region.coordinates.reduce((s, [lng]) => s + lng, 0) / region.coordinates.length,
+      region.coordinates.reduce((s, [, lat]) => s + lat, 0) / region.coordinates.length,
+    ];
+    ds.region.entities.add({
+      position: Cesium.Cartesian3.fromDegrees(labelPos[0], labelPos[1], 0),
+      label: {
+        text: region.label.text,
+        font: 'bold 16px "Microsoft YaHei", sans-serif',
+        fillColor: Cesium.Color.fromCssColorString(outlineColor),
+        outlineColor: Cesium.Color.BLACK,
+        outlineWidth: 3,
+        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
+        verticalOrigin: Cesium.VerticalOrigin.CENTER,
+      },
+    });
+  }
 });
```

**验证**：
- 实时跑 region-mark：地图出现**蓝色 4px polyline + "中国东海..." label**，不再有橙色填充。
- 用户后续点事件回放：地图视觉**完全一致**（同一份 region.style 渲染）。
- 用户点关闭事件 → syncRegions 重跑 → polyline 和 label 一起消失（不留脏图层）。

---

### Phase D — 端到端冒烟

| 检查 | 通过条件 |
|---|---|
| POST 油污 query | 任务记录里 `task_steps[0].result.data.operations` 不存在；`.gisData.regions[0].style.outlineColor === "#0064FF"` |
| 实时执行可视 | subtask-1 完成那一瞬地图出现蓝色 4px 框 + label |
| 用户点事件回放 | 视觉跟实时**一致**（蓝色 4px + 同一个 label）|
| 关闭事件 | 蓝框 + label 一起消失，opLayersRef 不再有残留（**对照旧实现的 bug 修复**）|
| 其他 capability 不受影响 | satellite 油膜识别仍出现黄色油膜区域，证明 `executeOperation` 路径没动 |

---

## Risks

1. **`opLayersRef` 残留**：本方案 region-mark 不再走 executeOperation，所以 region-mark 不会再写 opLayersRef；但其他 capability 如果有 region 风格的 renderLayer，仍会污染。本期不解决，留后续清理。
2. **auto-flyTo 时机**：`CesiumMap.tsx:920-951` 只在 `eventGisDataList.length` **新增**时触发；实时执行链 region-mark 完成 → useTaskChat 调 onGisDataRequest → activeGisDataList push 一项，触发新增，自动 flyTo OK。回放点击事件也是 push 触发。两条路径都 cover。
3. **bounds 精度**：用 region.coordinates 算的 bounds 跟原 capability 输出的 `sea.bounds` 几乎一致（多边形顶点的 min/max），镜头位置不会偏。
4. **shared 包重新构建**：改 maritime.ts 后必须 `pnpm --filter @datasourceintelligence/shared build`，否则 API/前端拿到的还是旧类型。
5. **未来扩展**：其他 capability（satellite 油膜区域、fire-detector 火点轮廓）想沿用此模式时，照 Phase B 抽 style/label 进 gisData 即可，前端 syncRegions 已经准备好。

---

## 执行顺序

| Phase | 文件 | 阻塞下一步？ |
|---|---|---|
| A | shared schema | 是（必须 build） |
| B | region-mark capability | 是（依赖 A 的类型）|
| C | CesiumMap syncRegions | 否（独立改前端可以并行）|
| D | 冒烟 + 回放对比 | — |

每步完成你确认我再开下一步，跟 weather-fetch 是同样节奏。
