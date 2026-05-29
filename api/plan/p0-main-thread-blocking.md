# P0 修复计划：主线程 JS 执行阻塞（200~400ms）

> 来源: `api/issues/frontend-performance-trace-20260522.md`
> 目标文件: `src/components/cesium/CesiumMap.tsx`
> 掉帧率: 46.8% → 目标 < 10%

---

## 根因

1. **CallbackProperty 每帧重算**：脉冲环（ring）和呼吸光圈（glowBillboard）使用 `CallbackProperty`，实体多时每帧触发 300+ 次 JS 回调
2. **sync 函数频繁全量同步**：`syncEntities`/`syncTrajectories`/`syncRegions` 的 `useCallback` 依赖宽泛，React render 即触发；内部遍历所有实体做 Cesium Entity 增删改，单次 50~200ms

---

## 步骤

### Step 1 — 简化呼吸光圈动画

**位置**: `CesiumMap.tsx` 内 `syncBillboardGlowEntities` 函数

**改动**:
- 删除 `billboard.scale` 的 `CallbackProperty`（每帧 sin 计算）
- 改为固定值 `scale: 0.82`

**预期**: 每帧减少 `glowRows.length` 次 JS 回调

---

### Step 2 — 简化脉冲环动画

**位置**: `CesiumMap.tsx` 内 `syncEntities` 中 `ringEntities.forEach` 循环

**改动**:
- 删除 `ellipse.semiMinorAxis`/`semiMajorAxis`/`material` 的 `CallbackProperty`
- 改为静态椭圆：`semiMinorAxis: maxR * 0.5`, `semiMajorAxis: maxR * 0.5`
- 材质改为固定透明度：`Cesium.Color.fromCssColorString(...).withAlpha(0.3)`

**预期**: 每帧减少 `ringEntities.length * 3` 次回调

---

### Step 3 — 深比较缓存（减少 sync 触发频率）

**位置**: `CesiumMap.tsx` 组件内，三个 `useEffect([syncXxx])` 之前

**改动**:
1. 新增辅助函数（组件内或提取到工具文件）：
   ```typescript
   function dataChanged<T>(ref: React.MutableRefObject<T>, next: T): boolean {
     const s = JSON.stringify(next);
     if (JSON.stringify(ref.current) === s) return false;
     ref.current = next;
     return true;
   }
   ```
2. 在 `syncEntities` 的 `useEffect` 中，用 ref 缓存 `entities`、`eventGisDataList`、`denseCells`、`activeLayers`
3. `syncEffect` 触发时先比较，数据未变化直接 `return`
4. 对 `syncTrajectories` 和 `syncRegions` 做同样处理

**预期**: 轮询返回相同数据时，完全跳过同步

---

### Step 4 — syncEntities 分帧执行

**位置**: `CesiumMap.tsx` 内 `syncEntities` 的 `useEffect`

**改动**:
- 把 `syncEntities()` 的单帧执行拆成多帧：
  - Phase 1（当前帧）：准备 `baseRows`/`eventRows`/`denseRows` 数据
  - Phase 2（下一 rAF）：执行 `syncPointLayerEntities`（base/event/dense 点位同步）
  - Phase 3（再下一 rAF）：执行脉冲环、火情地面效果、地震效果、呼吸光圈、油污扩散
- 用 `cancelled` flag 处理组件卸载/依赖变化时的清理

**代码结构**:
```typescript
useEffect(() => {
  const ds = dataSourcesRef.current;
  if (!ds) return;

  // Step 3: 深比较拦截
  if (!dataChanged(entitiesRef, entities)) return;
  // ... 同理其他依赖

  let cancelled = false;

  // Phase 1: 数据准备
  const baseRows = ...;
  const eventRows = ...;
  if (cancelled) return;

  // Phase 2: 点位同步
  requestAnimationFrame(() => {
    if (cancelled) return;
    syncPointLayerEntities(ds.base.entities, baseRows, ...);
    syncPointLayerEntities(ds.event.entities, eventRows, ...);

    // Phase 3: 效果同步
    requestAnimationFrame(() => {
      if (cancelled) return;
      // 脉冲环、地面效果、呼吸光圈等
    });
  });

  return () => { cancelled = true; };
}, [syncEntities]);
```

**预期**: 单次最长任务从 200~400ms 拆为 50~100ms x 多帧

---

### Step 5 — syncTrajectories 分帧执行

**位置**: `CesiumMap.tsx` 内 `syncTrajectories` 的 `useEffect`

**改动**:
- 同样做深比较拦截
- 把轨迹同步拆为：
  - Phase 1（当前帧）：准备 `baseRows`/`eventRows`
  - Phase 2（下一 rAF）：执行 `syncTrajectoryPolylineEntities` + 箭头同步

---

### Step 6 — syncRegions 分帧执行

**位置**: `CesiumMap.tsx` 内 `syncRegions` 的 `useEffect`

**改动**:
- 深比较拦截
- 区域同步拆为：
  - Phase 1（当前帧）：准备 `uniqueRegions`
  - Phase 2（下一 rAF）：执行 `ds.region.entities` 同步 + 光墙同步

---

### Step 7 — 验证

1. 重新录制 Performance Trace，确认：
   - 长任务数量减少
   - 单个长任务时长 < 100ms
   - 掉帧率下降
2. 功能验证：
   - 地图交互（拖拽/缩放）无卡顿
   - 实体/轨迹/区域正常显示
   - 数据更新后地图正确刷新

---

## 依赖关系

```
Step 1 ──┐
Step 2 ──┼──→ Step 3 ──→ Step 4 ──→ Step 7
         │              Step 5 ──┘
         │              Step 6 ──┘
```

Step 1/2 独立；Step 3 是 4/5/6 的前置；Step 4/5/6 可并行实施；Step 7 最后执行。
