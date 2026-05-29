# Cesium 本地瓦片数据接入计划

## 背景

当前 Cesium 底图完全依赖外网公共服务（ArcGIS、CARTO、NASA）。`S:\Data` 目录下已有本地瓦片数据，本计划将其接入为 Cesium 底图选项，替代或补充外网服务。

所有代码放在独立文件中，**不与数据目录混放**，避免日后冲突。

---

## 可用数据清单

### 影像瓦片（本次接入）

| 数据源 | 路径 | 格式 | 层级 | 地理范围 |
|--------|------|------|------|----------|
| 全球7级影像 | `S:\Data\瓦片数据\全球7级_影像` | `{z}/{x}/{y}.jpg` | 2~7 | 全球 |
| 北京地球站影像 | `S:\Data\瓦片数据\北京地球站_影像` | `{z}/{x}/{y}.jpg` | 2~16 | 116.04~116.51°E, 39.82~40.29°N |
| 怀来地球站影像 | `S:\Data\瓦片数据\怀来地球站影像_影像` | `{z}/{x}/{y}.jpg` | 2~16 | 115.35~115.83°E, 40.15~40.44°N |
| 新疆区域影像 | `S:\Data\瓦片数据\新疆区域_影像` | `{z}/{x}/{y}.jpg` | 2~13 | 79.5~82.0°E, 41.5~46.0°N |

### 高程/地形数据（后续迭代）

| 数据源 | 路径 | 格式 | 说明 |
|--------|------|------|------|
| 全球DEM | `S:\Data\瓦片数据\全球DEM_6级` | `{z}/{x}/{y}.tif` | 需格式转换 |
| 北京高程 | `S:\Data\瓦片数据\北京地球站_高程` | `{z}/{x}/{y}.tif` | 需格式转换 |
| 怀来高程 | `S:\Data\瓦片数据\怀来地球站影像_高程` | `{z}/{x}/{y}.tif` | 需格式转换 |
| 新疆DEM | `S:\Data\新疆三维高程DEM数据\新疆_12.5mDEM.tif` | GeoTIFF | 需切片或Ion处理 |

### 原始卫星影像（后续迭代）

| 数据源 | 路径 | 格式 | 说明 |
|--------|------|------|------|
| 10米分辨率底图 | `S:\Data\卫星地图影像\10米分辨率底图` | tar.gz (CB04) | 需解压+切片 |

---

## 已知问题

### 瓦片坐标系不确定

北京地球站 z=10 的目录结构为 `10/397/842.jpg`，但标准 Web Mercator 下北京（116.4°E, 40°N）z=10 的坐标约为 x=842, y=387。两者不一致，说明这些瓦片可能：
- 使用了 ArcGIS LOD 切片方案
- 坐标轴交换
- 使用了 WGS84/EPSG:4326 投影

**对策**：配置中预留 `tilingScheme` 切换选项，接入后通过测试确定正确配置。

---

## 实施步骤

### Step 1：静态资源 symlink

在 `public/` 下创建指向 `S:\Data\瓦片数据` 的符号链接：

```bash
ln -s "S:/Data/瓦片数据" "public/local-tiles"
```

验证：`http://localhost:5000/local-tiles/全球7级_影像/2/1/0.jpg` 应能直接访问。

同时 `.gitignore` 中补充 `public/local-tiles`。

---

### Step 2：新建 `LocalTileProvider.ts`

**路径**：`src/components/cesium/LocalTileProvider.ts`

**职责**：
- 定义所有本地影像数据源的配置
- 提供 `createLocalImageryProvider()` 创建 Cesium ImageryProvider
- 提供 `getLocalGlobeStyles()` 返回与现有 `GlobeStyle` 兼容的样式数组
- 支持坐标系切换（WebMercator / Geographic / TMS-flip）

**坐标系配置**：
```typescript
type TileScheme = 'webmercator' | 'geographic' | 'tms-flip';
```

---

### Step 3：修改 `ImageryManager.ts`

将本地瓦片样式合并到 `GLOBE_STYLES`，保留在线样式作为 fallback。

```typescript
import { getLocalGlobeStyles } from './LocalTileProvider';

export const GLOBE_STYLES: GlobeStyle[] = [
  ...getLocalGlobeStyles(),  // 本地瓦片
  ...ONLINE_GLOBE_STYLES,    // 原有在线样式
];
```

---

### Step 4：验证调参

1. 启动 `pnpm dev`
2. 浏览器打开地图，切换"本地全球影像"，观察全球范围瓦片
3. 如瓦片错位，修改 `LocalTileProvider.ts` 中对应数据源的 `tileScheme`
4. 缩放至北京/怀来/新疆区域，验证对应区域瓦片

---

## 文件清单

| 操作 | 路径 |
|------|------|
| 新建 | `src/components/cesium/LocalTileProvider.ts` |
| 修改 | `src/components/cesium/ImageryManager.ts` |
| 修改 | `.gitignore` |
| 创建 symlink | `public/local-tiles` → `S:/Data/瓦片数据` |

---

## 回退策略

- 本地瓦片与在线底图并存，样式切换随时回退
- `LocalTileProvider.ts` 独立存在，不影响现有代码
- 接入失败时可单独禁用本地样式

---

## 验证检查点

| # | 检查项 | 通过标准 |
|---|--------|----------|
| 1 | symlink 生效 | `curl http://localhost:5000/local-tiles/全球7级_影像/2/1/0.jpg` 返回 200 |
| 2 | 启动无报错 | `pnpm dev` 正常启动 |
| 3 | 全球影像可见 | 切换"本地全球影像"，全球范围能看到瓦片 |
| 4 | 区域影像可见 | 缩放至对应区域，切换后能看到高分辨率瓦片 |
| 5 | 坐标系正确 | 瓦片与地理坐标对齐，无明显偏移或翻转 |
