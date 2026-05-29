# 地震灾情区域 Hover Tooltip — 实施计划

## 一、概要

将 `earthquake-evaluation.ts` 返回的损毁区域（regions）从"地图上直接显示长文字 label"改为"地图上只显示红色边框 + 中文简称 label，鼠标悬浮时展示完整灾情描述"。

**问题**：当前 6 个损毁区域的 label 直接把 name + description 钉在地图上方，文字堆叠、遮挡影像、信息密度过高。
**目标**：hover 时通过 tooltip 展示详情，地图本身保持干净。

---

## 二、设计决策（Grill 结果）

| 决策 | 选择 | 理由 |
|------|------|------|
| Label 与 Hover | A. 彻底简化 | Label 只保留中文简称，全部详情进 hover |
| Tooltip 实现 | 复用现有 DOM | 改动最小，统一一个 tooltip 管理 |
| 拾取灵敏度 | A. 不可见拾取层 | 每个 region 加一个 `show: false` 的 polygon，鼠标在区域内即可 hover |
| 点击行为 | 不需要 | 纯 hover 展示即可 |
| Label 内容 | B. 中文简称 | "主塌"、"屋面"、"通道"、"屋损"、"路边"、"变化" |

**Tooltip 内容格式**：
```
[severity 颜色标签] 重度损毁 (severe_building_collapse)
────────────────────────
厂区西南侧主体坍塌区，灾前连续屋顶消失，
灾后出现大面积碎片堆积。
```

---

## 三、逐文件改动清单

### 1. 修改 `api/src/modules/actions/capabilities/earthquake-evaluation.ts`

**改动点**：`label.text` 从长文本改为中文简称。

**当前代码**（约第 213-214 行）：
```ts
label: {
  text: `${zone.name}\n${zone.description}`,
  ...
}
```

**改为**：
```ts
label: {
  text: getShortLabel(props.label), // "主塌"、"屋面" 等
  ...
}
```

**简称映射表**（从 geojson `properties.label` 提取）：
| geojson label | 中文简称 |
|---------------|----------|
| severe_building_collapse | 主塌 |
| roof_failure | 屋面 |
| access_obstruction | 通道 |
| partial_roof_damage | 屋损 |
| possible_roadside_debris | 路边 |
| changed_non_damage | 变化 |

**实现方式**：在 `loadDamageZones()` 中根据 `props.label` 生成 `shortLabel` 字段，传给 label。

---

### 2. 修改 `src/components/cesium/CesiumMap.tsx`

#### 2.1 `syncRegions` 中给 region entity 附加 properties

**位置**：约第 1949-1966 行（polyline entity 创建处）。

**当前**：
```ts
ds.region.entities.add({
  polyline: { ... },
  ...(fill ? { polygon: { ... } } : {}),
});
```

**改为**：
```ts
// 可见边框
ds.region.entities.add({
  polyline: { ... },
  ...(fill ? { polygon: { ... } } : {}),
});

// 不可见拾取层（用于 hover）
ds.region.entities.add({
  polygon: {
    hierarchy: new Cesium.PolygonHierarchy(hierarchy),
    material: Cesium.Color.TRANSPARENT,
    outline: false,
    heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
  },
  properties: {
    _region: region, // 供 scene.pick 读取
  },
});
```

> 注意：`Cesium.Color.TRANSPARENT` 创建的 polygon 完全透明但可拾取。`show: false` 也可以，但 `TRANSPARENT` 更可靠（某些 Cesium 版本中 `show: false` 的对象不可 pick）。

#### 2.2 `syncRegions` 中 label 的 text 改为读取 `region.label?.text`

**位置**：约第 1970-1991 行。

当前 label 逻辑已经读取 `region.label.text`，无需改动。只要后端把 `label.text` 改为简称即可。

#### 2.3 Hover handler 增加 `_region` 分支

**位置**：约第 1345-1392 行（`ScreenSpaceEventHandler.MOUSE_MOVE`）。

**当前逻辑**：
```ts
const picked = viewer.scene.pick(movement.endPosition);
if (Cesium.defined(picked) && picked.id?.properties) {
  const props = picked.id.properties as Cesium.PropertyBag;
  const itemProp = props._item as Cesium.Property | undefined;
  // ... 只处理 _item（entity 的 hover）
}
```

**增加 region 分支**：
```ts
const picked = viewer.scene.pick(movement.endPosition);
if (Cesium.defined(picked) && picked.id?.properties) {
  const props = picked.id.properties as Cesium.PropertyBag;

  // 原有 entity hover 逻辑
  const itemProp = props._item as Cesium.Property | undefined;
  if (itemProp) { /* ... 原有代码 ... */ }

  // 新增 region hover 逻辑
  const regionProp = props._region as Cesium.Property | undefined;
  if (regionProp) {
    const region = regionProp.getValue(viewer.clock.currentTime) as Region | undefined;
    if (region) {
      tooltip.style.display = 'block';
      tooltip.style.left = movement.endPosition.x + 15 + 'px';
      tooltip.style.top = movement.endPosition.y + 15 + 'px';
      tooltip.innerHTML = buildRegionTooltip(region); // 见下方
      document.body.style.cursor = 'pointer';
      return;
    }
  }
}
```

#### 2.4 Tooltip 样式调整

**位置**：约第 1000-1021 行（tooltip DOM 创建）。

**当前样式**：
```css
white-space: nowrap;
max-width: 240px;
```

**改为**：
```css
white-space: normal;
max-width: 280px;
line-height: 1.5;
```

#### 2.5 Tooltip 内容构建函数

新增辅助函数（放在组件内或文件顶部）：

```ts
function buildRegionTooltip(region: Region): string {
  const style = region.style || {};
  // severity 颜色映射
  const severityColor =
    style.outlineColor === '#DC2626' ? '#DC2626' :
    style.outlineColor === '#F59E0B' ? '#F59E0B' :
    style.outlineColor === '#FACC15' ? '#FACC15' : '#6B7280';

  const severityText =
    region.name.includes('重度') ? '重度损毁' :
    region.name.includes('中度') ? '中度损毁' :
    region.name.includes('轻度') ? '轻度损毁' : '无显著损毁';

  return `
    <div style="color: ${severityColor}; font-weight: 600; margin-bottom: 4px;">${severityText} (${region.name.split('(')[1]?.replace(')', '') || ''})</div>
    <div style="color: #EAEAEA; font-size: 12px; line-height: 1.5;">${region.description || ''}</div>
  `;
}
```

> 实际实现时可能需要更稳健的字段读取方式（因为 `Region` type 没有 `description` 字段，它可能通过扩展属性传递）。

---

## 四、实现顺序建议

1. **后端改 label 为简称**（`earthquake-evaluation.ts`）
   - 改动最小，可独立验证
   - 验证：地图上 label 从长文本变成 2 字简称

2. **前端添加不可见拾取层**（`CesiumMap.tsx` 的 `syncRegions`）
   - 给 region 加 `properties._region` + 透明 polygon
   - 验证：无视觉变化，但为 hover 打下基础

3. **前端改 tooltip 样式**（`CesiumMap.tsx` 的 tooltip DOM）
   - `white-space: normal`, `max-width: 280px`
   - 验证：所有 tooltip（包括 entity 的）都能折行

4. **前端增加 region hover 分支**（`CesiumMap.tsx` 的 MOUSE_MOVE handler）
   - 读取 `_region`，渲染灾情 tooltip
   - 验证：鼠标在红框内悬浮，出现灾情描述 tooltip

---

## 五、验证清单

| 步骤 | 验证点 | 通过标准 |
|------|--------|----------|
| 1 | Label 简化 | 地图上只显示"主塌"、"屋面"等 2 字简称，无长文本 |
| 2 | 不可见拾取层 | 无视觉变化，polyline 边框保持红色 2px |
| 3 | Tooltip 折行 | 鼠标移到船舶/火情等 entity 上，tooltip 正常折行显示 |
| 4 | Region hover | 鼠标移到红色框区域内，出现含 severity + name + description 的 tooltip |
| 5 | 边界情况 | 鼠标在多个 region 交界处，显示最上层 region 的 tooltip（Cesium pick 默认行为） |
| 6 | 移出消失 | 鼠标移出 region，tooltip 消失，cursor 恢复 default |

---

## 六、风险与注意事项

1. **`Region` type 没有 `description` 字段**：`Region` schema 定义在 `packages/shared/src/types/maritime.ts`，只有 `id/name/type/coordinates/rules/style/label`。但后端 `earthquake-evaluation.ts` 返回的 region 数据包含 `description`（通过类型断言或扩展传递）。前端 `buildRegionTooltip` 可能需要通过 `(region as any).description` 读取，或修改 `Region` schema。

2. **`scene.pick` 对透明 polygon 的拾取**：`Cesium.Color.TRANSPARENT` 的 polygon 默认可以被 pick。如果不行，可改用 `material: new Cesium.ColorMaterialProperty(Cesium.Color.fromAlpha(Cesium.Color.WHITE, 0.01))`（几乎完全透明但仍可拾取）。

3. **tooltip 与 entity tooltip 冲突**：如果 region 和 entity 在视觉上重叠，`_item` 和 `_region` 同时存在时，当前逻辑会先检查 `_item`。如果希望 region hover 优先，需要调整检查顺序。
