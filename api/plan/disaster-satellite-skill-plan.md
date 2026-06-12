# 灾情卫星图查询 Skill —— 实现计划

> 目标：新增一个 Agent Loop Skill，支持用户提问后自动完成「联网灾情查询 → 搜索卫星图 → 解析评估」的完整链路。

---

## 当前缺口总览

| 能力 | 现状 | 缺口 |
|------|------|------|
| **灾情数据查询** | 旧 `fire`/`earthquake`/`flood` capability 已删除，无后端数据源 | 需接入实时/历史灾情 API |
| **卫星影像搜索** | 无卫星数据源接入；仅有独立 `tif-to-png.py` 脚本未集成 | 需接入 Sentinel/天地图/Google Earth 等 |
| **图像解析** | 无图像分析能力；无 Vision LLM 集成 | 需接入 vision model 或遥感分析服务 |
| **新闻搜索** | Tavily `WebSearch` 可用（支持 `topic: news`） | ✅ 可用，需加灾情关键词过滤 |
| **区域解析** | `RegionResolve` + PostGIS `region_resolve_catalog` | ✅ 可用 |

---

## 需要新增的工具

### 1. DisasterQuery（灾情查询工具）

接入公开灾情数据源，按区域/时间/类型查询：

| 数据源 | 覆盖 | API 类型 | 优先级 |
|--------|------|----------|--------|
| **USGS Earthquake API** | 全球地震 | REST JSON，免费 | P0 |
| **GDACS API** | 全球灾害（地震/洪水/台风/火山） | RSS/JSON，免费 | P0 |
| **Sentinel Hub OpenSearch** | 卫星影像元数据搜索 | REST JSON，免费 tier | P1 |
| **中国地震台网** | 中国及邻区地震 | 网页/非官方 API | P1 |
| **NOAA / NCEI** | 气象灾害、海啸 | REST/CSV | P2 |

工具 schema：
```typescript
{
  regionName?: string;       // "台湾海峡" — RegionResolve 先解析 bbox
  bbox?: Bbox;               // 或直接用 bbox
  disasterType: "earthquake" | "flood" | "typhoon" | "fire" | "all";
  timeRange?: "24h" | "7d" | "30d" | "1y";  // 默认 30d
  minMagnitude?: number;     // 地震专用，默认 4.0
}
```

输出：灾情事件列表（时间、位置、强度、影响范围、数据源链接）。

### 2. SatelliteImageSearch（卫星影像搜索工具）

搜索指定区域的卫星影像，返回影像元数据（下载链接、拍摄时间、云量、分辨率）。

| 数据源 | 分辨率 | 免费额度 | 优先级 |
|--------|--------|----------|--------|
| **Sentinel Hub (Copernicus)** | 10m (Sentinel-2) | 免费，需注册 | P0 |
| **NASA Earthdata (Landsat)** | 30m | 免费 | P1 |
| **Google Earth Engine** | 多源 | 免费，需申请 | P1 |
| **天地图** | 国产卫星 | 免费，需 key | P1（国内场景） |

工具 schema：
```typescript
{
  bbox: Bbox;                    // 必须
  beforeDate?: string;           // "2024-05-01" 灾前
  afterDate?: string;            // "2024-05-10" 灾后
  maxCloudCoverage?: number;     // 默认 20%
  source?: "sentinel-2" | "landsat-8" | "any";  // 默认 any
}
```

输出：影像列表（下载 URL、拍摄时间、云量、分辨率、传感器类型）。

### 3. ImageAnalysis（图像解析工具）

对获取的卫星图进行分析，输出灾情评估。

**方案对比**：

| 方案 | 实现难度 | 精度 | 成本 | 推荐 |
|------|---------|------|------|------|
| **A. Vision LLM（Claude/GPT-4V）** | 低 | 中（描述性） | API 费用 | **P0** |
| **B. 遥感指数算法（dNBR/NDVI）** | 中 | 高（定量化） | 计算资源 | P1 |
| **C. 专用遥感 AI 服务** | 高 | 高 | 高 | P2 |

**P0 推荐方案 A**：用 Vision LLM 做第一版。

工具 schema：
```typescript
{
  imageUrls: string[];           // 卫星图下载链接
  analysisType: "disaster_assessment" | "change_detection" | "overview";
  context?: string;              // "2024年5月台湾海峡地震后评估"
}
```

输出：灾情评估报告（受损区域描述、变化对比、置信度、建议）。

### 4. GeoTiffProcessor（可选，已有脚本集成）

已有 `api/scripts/tools/tif-to-png.py` 支持：
- Sentinel-2 RGB 合成（B4/B3/B2）
- dNBR 烧毁比伪彩色
- 灰度模式

可作为 `SatelliteImageSearch` 的后续步骤，下载 GeoTIFF 后转换为前端可渲染的 PNG。

---

## Skill 设计：`disaster-satellite-query`

### 触发条件

用户问题包含以下语义：
- "查询 XX 地区的灾情"
- "XX 地震/洪水/台风 最新情况"
- "XX 卫星图"
- "评估 XX 受灾情况"

### 执行链路

```
用户提问："查询台湾海峡最近一周地震情况，并找一下灾后的卫星图"
  ↓
1. RegionResolve("台湾海峡") → bbox + geometryRef
  ↓
2. DisasterQuery({
     bbox,
     disasterType: "earthquake",
     timeRange: "7d"
   }) → 地震事件列表
  ↓
3. SatelliteImageSearch({
     bbox,
     afterDate: 地震发生日期
   }) → 灾后卫星影像元数据
  ↓
4. ImageAnalysis({
     imageUrls: [影像下载链接],
     analysisType: "disaster_assessment",
     context: "台湾海峡地震后"
   }) → 灾情评估报告
  ↓
5. RegionMark(geometryRef) → 地图显示受灾区域
  ↓
输出：综合报告 + 地图标记 + 卫星图 + 评估结论
```

### Skill Prompt 片段

```markdown
## disaster-satellite-query

当用户询问某区域的灾情、自然灾害、地震、洪水、火灾，或要求查看卫星图时：

1. 先用 RegionResolve 解析区域，获取 bbox。
2. 用 DisasterQuery 查询该区域指定时间范围内的灾情事件。
3. 如果有灾情事件发生：
   a. 用 SatelliteImageSearch 搜索灾前和灾后的卫星影像。
   b. 用 ImageAnalysis 分析灾后卫星图，输出灾情评估。
4. 用 RegionMark 在地图上标记受灾区域。
5. 综合输出：灾情概述、事件列表、卫星图对比、评估结论。

注意：
- 如果 RegionResolve 失败，不要猜测 bbox，请用户明确区域。
- 如果该区域无灾情记录，如实告知，不要编造。
- 卫星图搜索失败时，只返回灾情数据，不强制要求卫星图。
```

---

## Ordered Phases

### Phase 1 — DisasterQuery 工具（P0）

**1.1 接入 USGS Earthquake API**

```typescript
// api/src/modules/agent-loop/tools/domain/disaster.ts
async function queryUsgsEarthquake(bbox: Bbox, timeRange: string, minMagnitude: number) {
  const url = `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&minlatitude=${bbox.south}&maxlatitude=${bbox.north}&minlongitude=${bbox.west}&maxlongitude=${bbox.east}&starttime=${startTime}&endtime=${endTime}&minmagnitude=${minMagnitude}`;
  // 返回标准化的事件列表
}
```

**1.2 接入 GDACS API**

RSS/JSON 格式，覆盖地震、洪水、台风、火山。

**1.3 统一输出格式**

```typescript
interface DisasterEvent {
  id: string;
  type: "earthquake" | "flood" | "typhoon" | "fire" | "volcano";
  title: string;
  time: string;
  location: { lat: number; lon: number };
  magnitude?: number;        // 地震
  severity?: string;         // 综合等级
  affectedArea?: Bbox;       // 影响范围
  sourceUrl: string;         // 原始链接
  source: "usgs" | "gdacs" | "noaa";
}
```

**Phase 1 执行记录**

已新增文件：
- `api/src/modules/agent-loop/tools/domain/disaster.ts` — DisasterQuery 工具
- `api/tests/gis/test-disaster-query-tool.mjs` — 测试

已注册：
- `api/src/modules/agent-loop/tools/domain/index.ts` — 加入 `buildDisasterQueryTool()`

实现内容：
- USGS Earthquake API（GeoJSON）接入，支持 bbox + timeRange + minMagnitude 过滤
- GDACS RSS 解析，支持地震/洪水/台风/火灾/火山分类过滤
- 统一 `DisasterEvent` 输出格式
- 按时间倒序排序 + 去重
- 中文 severity 分级（严重/重大/中等/轻微/微弱）
- 无结果时返回中文摘要"未在指定区域查询到..."

**测试结果**：
- 台湾海峡 30 天 M>=4 地震：4 events（最新 M4.4，花莲附近）
- 全球 24 小时 M>=5 地震：11 events
- 菲律宾 7 天全部灾害：78 events（mixed source）
- 小区域高震级（M>=8）：正确返回"未查询到"
- tsc --noEmit 通过

**验收**：
- [x] `"查询台湾海峡最近30天地震"` → 返回 USGS + GDACS 合并结果
- [x] `"查询全球最近24小时7级以上地震"` → 返回列表
- [x] 无结果时如实返回，不编造

---

### Phase 2 — SatelliteImageSearch 工具（P0）

### Phase 2 — SatelliteImageSearch 工具（P0）

**2.1 接入 Sentinel Hub OpenSearch**

```typescript
// 使用 Copernicus Data Space Ecosystem (CDSE) OpenSearch API
const url = `https://catalogue.dataspace.copernicus.eu/odata/v1/Products?${params}`;
```

搜索参数：
- `bbox` → Well-Known Text (WKT)
- `collection: SENTINEL-2`
- `cloudCover < 20%`
- `startDate / completionDate`

**2.2 接入 NASA Earthdata（Landsat）**

**2.3 输出影像元数据**

```typescript
interface SatelliteImage {
  id: string;
  source: "sentinel-2" | "landsat-8";
  acquisitionDate: string;
  cloudCoverage: number;
  resolution: number;        // 米
  downloadUrl: string;
  thumbnailUrl: string;
  bbox: Bbox;
}
```

**Phase 2 执行记录**

已新增文件：
- `api/src/modules/agent-loop/tools/domain/satellite.ts` — SatelliteImageSearch 工具
- `api/tests/gis/test-satellite-image-search-tool.mjs` — 测试

已注册：
- `api/src/modules/agent-loop/tools/domain/index.ts` — 加入 `buildSatelliteImageSearchTool()`

实现内容：
- Copernicus Data Space Ecosystem (CDSE) OData API 接入
- Sentinel-2 搜索：OData `$filter` + `OData.CSC.Intersects` + `ContentDate` 范围 + `Collection/Name eq 'SENTINEL-2'`
- Landsat-8 搜索：同上，Collection 为 `LANDSAT-8`
- bbox 转 WKT POLYGON
- 云量过滤（`cloudCover` attribute）
- 结果按采集时间倒序
- 返回 `browserUrl` 指向 CDSE 浏览器（下载/缩略图需认证，第一版返回浏览器链接）

**测试结果**：
- 台湾海峡 2024-01-01 至 2024-06-01 Sentinel-2：5 张影像
- 福建省 2024-03-01 至 2024-04-01 any source：10 张影像
- 严格云量过滤（<=5%）：10 张（部分产品无 cloudCover 属性，不过滤）
- 小区域近期：正确返回"未查询到"
- tsc --noEmit 通过

**验收**：
- [x] `"搜索台湾海峡 2024-01-01 到 2024-06-01 的卫星图"` → 返回 Sentinel-2 影像列表
- [x] 云量过滤生效（有 cloudCover 属性的产品）
- [x] 无结果时如实返回

### Phase 3 — ImageAnalysis 工具（P0）

**3.1 接入 Vision LLM**

选择：Anthropic Claude 3 Opus / Sonnet（已有 API 接入经验）或 OpenAI GPT-4V。

实现方式：
```typescript
async function analyzeSatelliteImage(imageUrl: string, context: string) {
  const response = await modelClient.call({
    messages: [{
      role: "user",
      content: [
        { type: "text", text: `分析以下卫星图。${context}。描述可见的灾情迹象、变化区域、受损程度。` },
        { type: "image_url", image_url: { url: imageUrl } },
      ],
    }],
  });
  return response.content;
}
```

**3.2 输出结构化评估**

```typescript
interface DisasterAssessment {
  summary: string;           // 总体评估
  affectedAreas: string[];   // 受灾区域描述
  severity: "low" | "medium" | "high" | "critical";
  confidence: number;        // 0-1
  changesDetected: string[]; // 发现的变化
  recommendations: string[]; // 建议
}
```

**验收**：
- 传入灾后卫星图 → 返回结构化灾情评估
- 传入灾前灾后两张图 → 返回变化对比分析

### Phase 4 — Skill 注册与 Prompt 规则

**4.1 创建 Skill 目录**

```
skills/disaster-satellite-query/
├── SKILL.md          # Skill 定义（触发条件、工具链、示例）
└── examples/
    └── example-1.md  # 示例对话
```

**4.2 更新 promptManager.ts**

在 GIS Tool Routing Rules 之后新增：
```markdown
# Disaster Satellite Query Rules
When the user asks about disasters, earthquakes, floods, typhoons, fires, or satellite imagery of a region:
1. Call RegionResolve first for bbox.
2. Call DisasterQuery with the bbox.
3. If events found, call SatelliteImageSearch for pre/post disaster images.
4. If images found, call ImageAnalysis for assessment.
5. Call RegionMark to display affected areas.
```

**4.3 端到端 smoke 测试**

```typescript
// api/tests/test-disaster-satellite-skill-smoke.mjs
// 模拟用户提问，验证工具调用链：
// RegionResolve → DisasterQuery → SatelliteImageSearch → ImageAnalysis → RegionMark
```

### Phase 5 — GeoTiff 处理集成（P1，可选）

将现有 `tif-to-png.py` 脚本集成到 `SatelliteImageSearch` 或独立为 `GeoTiffProcessor` 工具：
- 下载 Sentinel-2 GeoTIFF
- 自动转换为 RGB PNG（B4/B3/B2）
- 或生成 dNBR 伪彩色图（火灾评估用）

---

## 风险与边界

| 风险 | 缓解措施 |
|------|---------|
| USGS/GDACS API 在中国大陆访问不稳定 | 加国内镜像 fallback（中国地震台网） |
| Sentinel Hub 免费额度有限 | 使用 Copernicus Data Space Ecosystem（免费，需注册） |
| Vision LLM 成本高 | 先分析缩略图（低分辨率），必要时再分析全尺寸图 |
| 卫星图下载慢（数百 MB GeoTIFF） | 只下载缩略图给 LLM 分析；全尺寸图提供下载链接 |
| 多时相影像时间对齐困难 | 放宽时间窗口搜索，让用户确认最合适的影像对 |
| 旧 capability 代码已删除，无参考 | 从零实现，不依赖旧代码 |

---

## 验证清单

- [ ] `DisasterQuery("earthquake", bbox)` 返回 USGS 真实地震数据
- [ ] `DisasterQuery("flood", bbox)` 返回 GDACS 洪水数据
- [ ] `SatelliteImageSearch(bbox, dateRange)` 返回 Sentinel-2 影像列表
- [ ] `ImageAnalysis(imageUrl)` 返回结构化灾情评估
- [ ] 端到端 smoke："查询台湾海峡最近地震" → 工具链完整执行
- [ ] 无灾情时返回 `resolved: false`，不编造
- [ ] RegionResolve bbox 与 DisasterQuery bbox 完全一致

---

## 推荐下一步

**先实现 Phase 1（DisasterQuery）**，因为：
1. USGS API 完全免费，无需注册
2. 技术复杂度最低（纯 REST JSON）
3. 价值最直接——用户提问"XX 最近有地震吗"可以立即得到真实数据
4. 不依赖 Phase 2/3 也能独立工作

Phase 1 预计工作量：1 个 domain tool 文件 + 1 个测试文件，半天可完成。

---

## Phase 4 execution note - 2026-06-11

Implemented the first prompt/skill slice against the current codebase:

- Added `skills/disaster-satellite-query/SKILL.md`.
- Added disaster/satellite routing rules to `api/src/modules/agent-loop/promptManager.ts`.
- Added doc/prompt regression tests:
  - `api/tests/data/test-disaster-satellite-skill-doc.mjs`
  - `api/tests/agent-loop/test-prompt-manager-disaster-satellite-routing.mjs`
- Fixed directory-level imports in:
  - `api/src/modules/agent-loop/tools/domain/disaster/disaster.ts`
  - `api/src/modules/agent-loop/tools/domain/satellite/satellite.ts`
  - `api/src/modules/agent-loop/tools/domain/weather/weather.ts`

Plan adjustment:

- The current repository has `DisasterQuery` and `SatelliteImageSearch`.
- `ImageAnalysis` is not registered yet, so the skill and system prompt must not require it.
- First-version behavior is event facts plus satellite image metadata/browser links. Pixel-level or vision-based disaster assessment remains Phase 3.
