# RegionResolve 全球 GeoJSON 语义检索 —— 实现计划

> 背景：当前 RegionResolve 仅支持 35 条本地记录（34 省 + 东海），且只返回 `bbox`。RegionMark 用 bbox 画矩形框，无法渲染真实海域/国家轮廓。
> 目标：接入全球地理信息数据，支持用户语义查找，返回真实 GeoJSON `geometry`，让 RegionMark 绘制精确轮廓。

---

## Context

### 当前问题

| 问题 | 根因 | 影响 |
|------|------|------|
| 覆盖范围窄 | 本地只有 `china.geojson` + `eastern_china_sea.geojson` | 用户问"圈选日本"无法解析 |
| 画框不画轮廓 | RegionResolve 只返回 `bbox`，丢弃原始 `geometry` | RegionMark 只能渲染矩形 polygon |
| 无语义理解 | 纯字符串匹配（name/alias），不支持自然语言 | "中国海军演习那片海" 无法关联到"东海" |

### 当前匹配逻辑（`regionResolve.ts:234-267`）

```
exact_name (1.0) → exact_alias (1.0) → query_contains_name (0.92)
→ query_contains_alias (0.9) → partial (0.6)
```

仅支持精确/包含匹配，无 LLM 语义层。

---

## 方案总览

| 维度 | 决策 |
|------|------|
| 覆盖范围 | 全球 |
| 离线/在线 | **混合模式**：国家级别离线 + 海域手工维护 + 长尾走在线 API |
| 在线 API | 高德地理编码（中文增强）+ Nominatim（全球，内网 Docker 转发） |
| 语义层 | 内嵌在 RegionResolve 内部，本地 miss 后调 LLM 做语义标准化 |
| 输出改造 | 返回 `geometry`（原始 polygon）+ `bbox`，RegionMark 优先用 `geometry` |
| 缓存 | 在线 API 结果写 `public/geo/cache/`，30 天 TTL |
| 查询策略 | 串行 fallback：本地 → LLM 标准化 → 缓存 → 高德 → Nominatim |

---

## 关键文件

| 操作 | 文件 | 说明 |
|------|------|------|
| 修改 | `api/src/modules/agent-loop/tools/domain/gis/regionResolve.ts` | 核心改造：增加数据源层、LLM 语义层、geometry 输出 |
| 修改 | `api/src/modules/agent-loop/tools/domain/gis/regionMark.ts` | 支持 `geometry` 输入，优先用 geometry 绘制 |
| 新增 | `public/geo/natural-earth/` | Natural Earth 1:50m 国家边界 GeoJSON |
| 新增 | `public/geo/maritime-regions.geojson` | 手工维护：东海、南海、台湾海峡、马六甲海峡等 |
| 新增 | `public/geo/cache/` | 在线 API 结果缓存目录（gitignored） |
| 修改 | `api/src/modules/agent-loop/promptManager.ts` | GIS Tool Routing Rules 更新，指导模型利用新能力 |

---

## Ordered Phases

### Phase 1 — 离线数据准备

#### 1.1 下载 Natural Earth 1:50m 国家边界

```bash
# Natural Earth Admin 0 - Countries (1:50m, 约 5MB)
curl -L "https://naciscdn.org/naturalearth/50m/cultural/ne_50m_admin_0_countries.zip" -o /tmp/ne_50m.zip
unzip /tmp/ne_50m.zip -d public/geo/natural-earth/
```

转换为目标格式（每个国家一个 entry，含中文别名）：

```json
{
  "type": "FeatureCollection",
  "features": [{
    "type": "Feature",
    "properties": {
      "name": "Japan",
      "name_zh": "日本",
      "aliases": ["日本", "Japan", "Nippon"]
    },
    "geometry": { "type": "Polygon", "coordinates": [...] }
  }]
}
```

#### 1.2 创建 `public/geo/maritime-regions.geojson`

手工维护业务核心海域（先覆盖现有 `eastern_china_sea.geojson` 内容）：

| 区域 | 数据来源 |
|------|---------|
| 中国东海 | 迁移现有 `eastern_china_sea.geojson` |
| 南海 | 手工绘制/从公开数据源提取 |
| 台湾海峡 | 手工绘制 |
| 马六甲海峡 | 手工绘制 |
| 渤海 | 手工绘制 |
| 黄海 | 手工绘制 |

**验收**：`regionResolve.ts` 加载后 catalog 条目 ≥ 200（195 国家 + 海域）。

---

### Phase 2 — RegionResolve 输出改造（geometry 支持）

#### 2.1 扩展 `RegionCandidate` 类型

```typescript
interface RegionCandidate {
  id: string;
  name: string;
  aliases: string[];
  source: "geojson_asset" | "geojson_cache" | "gaode" | "nominatim";
  sourcePath: string;  // 本地路径或 API 标识
  confidence: number;
  matchType: string;
  bbox: Bbox;
  geometry?: {
    type: "Polygon" | "MultiPolygon";
    coordinates: number[][][][];  // GeoJSON 标准格式
  };
}
```

#### 2.2 扩展 `RegionResolveOutput`

```typescript
type RegionResolveOutput =
  | { resolved: true; selected: RegionCandidate; candidates: RegionCandidate[] }
  | { resolved: false; candidates: RegionCandidate[]; requirement: {...} };
```

#### 2.3 加载逻辑改造

`loadChinaProvinceEntries()` 和 `loadEastChinaSeaEntries()` 合并为统一加载器：

```typescript
async function loadRegionCatalog(): Promise<RegionCatalogEntry[]> {
  const [naturalEarth, maritime, chinaProvinces] = await Promise.all([
    loadNaturalEarthEntries(),      // Phase 1.1
    loadMaritimeEntries(),          // Phase 1.2
    loadChinaProvinceEntries(),     // 现有逻辑保留
  ]);
  return [...naturalEarth, ...maritime, ...chinaProvinces];
}
```

每个 loader 需要同时提取 `bbox`（用于快速过滤）和 `geometry`（用于精确渲染）。

**验收**：RegionResolve 返回的 `selected.geometry` 不为空，且 `type` 为 `"Polygon"` 或 `"MultiPolygon"`。

---

### Phase 3 — RegionMark 支持 geometry 输入

#### 3.1 扩展输入 schema

```typescript
const RegionMarkInputSchema = z.strictObject({
  name: z.string().trim().min(1),
  bbox: BboxSchema.optional(),
  polygon: z.array(CoordinatePairSchema).min(3).optional(),
  geometry: z.object({
    type: z.enum(["Polygon", "MultiPolygon"]),
    coordinates: z.array(z.any()),
  }).optional(),  // ← 新增
  regionType: z.enum(["monitor", "control", "service"]).default("monitor"),
  label: z.string().trim().min(1).optional(),
  style: RegionStyleSchema.optional(),
}).refine(
  (input) => Boolean(input.bbox || input.polygon || input.geometry),
  "RegionMark requires either bbox, polygon, or geometry."
);
```

#### 3.2 绘制逻辑优先用 geometry

```typescript
function executeRegionMark(input: RegionMarkInput, context: ToolExecutionContext) {
  // 优先用 geometry → 其次 polygon → 最后 bbox
  const coordinates = input.geometry
    ? flattenGeometry(input.geometry)
    : input.polygon
      ? normalizePolygon(input.polygon)
      : normalizePolygon(polygonFromBbox(input.bbox!));

  // ...
}
```

**验收**：传入 `geometry` 时，地图渲染的是 GeoJSON 原始轮廓（非矩形）。

---

### Phase 4 — LLM 语义层（内嵌）

#### 4.1 语义标准化 prompt

RegionResolve 内部，本地 miss 后调 LLM：

```typescript
async function semanticNormalize(query: string): Promise<string | null> {
  const prompt = `将用户的地理描述标准化为权威地名。只输出最匹配的一个地名，如果没有匹配输出"UNKNOWN"。

已知地名列表：${knownNames.join(", ")}

用户描述："${query}"
权威地名：`;

  const response = await modelClient.call({ prompt, maxTokens: 50 });
  const normalized = response.trim();
  return normalized === "UNKNOWN" ? null : normalized;
}
```

#### 4.2 集成到查询链路

```typescript
async function executeRegionResolve(input, context) {
  // 1. 本地匹配
  let candidates = matchLocalCatalog(input.regionName || input.query);

  // 2. 本地 miss → LLM 语义标准化 → 再查本地
  if (candidates.length === 0) {
    const normalized = await semanticNormalize(input.query || "");
    if (normalized) {
      candidates = matchLocalCatalog(normalized);
    }
  }

  // 3. 仍然 miss → 走在线 API
  if (candidates.length === 0) {
    candidates = await queryOnlineApis(input, normalized);
  }

  // ...
}
```

**验收**：输入 `"中国海军演习那片海"` 能解析出 `"中国东海"`，并返回 geometry。

---

### Phase 5 — 在线 API 接入 + 缓存

#### 5.1 高德地理编码接入

```typescript
async function queryGaode(regionName: string): Promise<RegionCandidate | null> {
  const url = `https://restapi.amap.com/v3/geocode/geo?address=${encodeURIComponent(regionName)}&key=${GAODE_KEY}`;
  // 返回 bbox 或 polygon（高德行政区划查询支持返回边界）
}
```

**注意**：高德免费额度有限，优先用于中文地名。

#### 5.2 Nominatim 接入（内网转发）

```typescript
async function queryNominatim(regionName: string): Promise<RegionCandidate | null> {
  const url = `${NOMINATIM_HOST}/search?q=${encodeURIComponent(regionName)}&format=geojson&polygon_geojson=1`;
  // 返回 GeoJSON FeatureCollection，提取第一个结果的 geometry
}
```

**Docker 部署**：

```bash
# 内网 Nominatim 转发（可选，解决翻墙问题）
docker run -d -p 8080:8080 \
  -e NOMINATIM_PASSWORD=secret \
  mediagis/nominatim:latest
```

#### 5.3 文件缓存

```typescript
async function saveToCache(name: string, candidate: RegionCandidate): Promise<void> {
  const fileName = `${safeFileName(name)}.geojson`;
  const filePath = path.join(CACHE_DIR, fileName);
  await writeFile(filePath, JSON.stringify({
    type: "Feature",
    properties: { name: candidate.name, aliases: candidate.aliases },
    geometry: candidate.geometry,
    bbox: candidate.bbox,
  }));
}
```

缓存 TTL：30 天。过期后重新查询在线 API。

**验收**：
- 查询 `"日本"` 本地 miss → 调 Nominatim → 返回 geometry → 写 `public/geo/cache/日本.geojson`
- 第二次查询 `"日本"` 直接命中缓存，零 API 调用。

---

### Phase 6 — Prompt 规则更新

更新 `promptManager.ts` 中 GIS Tool Routing Rules，指导模型利用 `geometry`：

```markdown
# GIS Tool Routing Rules
When the user asks to mark, focus, circle, display, or analyze a named geographic region:
1. Call RegionResolve first.
2. If resolved=true, call RegionMark with selected.geometry (or selected.bbox if geometry unavailable).
3. If downstream weather, aircraft, or maritime data is requested, reuse the same bbox.
4. If resolved=false, do not guess. Ask for bbox/polygon or say the region is not available.
```

---

## 风险与边界

| 风险 | 缓解措施 |
|------|---------|
| Natural Earth 1:50m 精度不足（国家边界简化） | 业务场景以海域为主，国家边界只做示意；如需精确国界，后期可升级 1:10m |
| LLM 语义标准化幻觉 | 限定输出必须在已知地名列表中；输出不在列表中时回退到原始 query 字符串匹配 |
| Nominatim 内网转发运维成本 | 初期可用公共 Nominatim（rate limit 1req/s），内网转发作为二期 |
| 高德 API 费用 | 仅用于中文地名；高频中文查询（中国省份、海域）已离线，极少触发高德 |
| geometry 坐标点过多（token 占用） | RegionResolve 返回的 observation 中 geometry 可简化（Douglas-Peucker，阈值 0.01°） |

---

## 验证清单

- [ ] `public/geo/natural-earth/` 包含 195+ 国家边界 GeoJSON
- [ ] `public/geo/maritime-regions.geojson` 包含 6+ 海域
- [ ] RegionResolve 返回 `"日本"` 时 `selected.geometry` 为 Polygon
- [ ] RegionMark 接收 `geometry` 后绘制的是国家轮廓（非矩形）
- [ ] `"中国海军演习那片海"` → LLM 标准化为 `"中国东海"` → 命中本地
- [ ] `"地中海"` → 本地 miss → Nominatim → 缓存 → 二次查询零 API 调用
