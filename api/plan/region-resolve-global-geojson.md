# RegionResolve PostGIS 数据源改造计划

> 背景：当前 `RegionResolve` 仍从本地 GeoJSON 文件加载少量区域，只返回 `bbox`。实际前端 smoke 已暴露问题：`台湾海峡` 解析失败后，模型会自行猜 bbox，并导致 `RegionMark` 与下游 SQL 使用的范围不一致。
>
> 新条件：项目已新增 PostGIS 数据库 `show_room`，连接变量为 `GEO_DATABASE_URL`，空间表位于 `region_geom` schema。应以该 PostGIS 库作为 RegionResolve 的主要事实源，而不是再新建一套 JSONB `region_catalog` 表。

---

## 验收结论

### 已确认的 PostGIS 现状

Docker 服务：

- container: `ds_postgis`
- database: `show_room`
- app env: `GEO_DATABASE_URL=postgresql://postgres:postgres@localhost:5433/show_room`
- schema: `region_geom`

空间表：

| 表 | 行数 | geometry 类型 | SRID | 第一版用途判断 |
|---|---:|---|---:|---|
| `china_province` | 34 | GEOMETRY | 0 | 中国省级行政区，纳入 v1 |
| `china_city` | 370 | GEOMETRY | 0 | 中国市级行政区，纳入 v1 |
| `china_town` | 2917 | GEOMETRY | 0 | 区县/乡镇级，纳入 v1，但结果排序要低于省市 |
| `taiwan` | 42 | GEOMETRY | 0 | 台湾细分行政区，纳入 v1 |
| `custom_region` | 34 | GEOMETRY | 0/4326 | 海域、战略区、流域、国家公园等，纳入 v1 |
| `sea_geom` | 2 | GEOMETRY | 0 | 中国/中国沿海，纳入 v1 |
| `international` | 251 | GEOMETRY | 4326 | 国家/地区，纳入 v1 |
| `chinabasin` | 11 | MULTIPOLYGON | 4326 | 流域，可纳入 v1 或由 `custom_region` 覆盖 |
| `custom_region_copy1` | 4 | GEOMETRY | 0 | 语义不清，暂不作为主源 |
| `international_copt` | 251 | GEOMETRY | 0 | 疑似副本，暂不作为主源 |
| `rivers` | 2 | MULTILINESTRING | 4326 | 线要素，RegionMark v1 不支持，暂不纳入区域解析 |
| `amazon` | 1 | MULTIPOLYGON | 4326 | `custom_region` 已含亚马逊，暂不作为主源 |
| `hexicorridor` | 1 | MULTIPOLYGON | 4326 | `custom_region` 已含河西走廊，暂不作为主源 |
| `china_board` | 2 | GEOMETRY | 0 | 边界数据，暂不作为普通地名解析主源 |

### 当前计划需要改掉的点

| 原计划 | 验收意见 | 新决策 |
|---|---|---|
| 新建业务库 `region_catalog` 表 | 已有 PostGIS 真库，重复建 catalog 会制造双事实源 | 不新建业务库表，改为 PostGIS `region_geom.region_resolve_catalog` 统一视图/物化视图 |
| geometry 存 JSONB | 已有 PostGIS geometry 列，JSONB 会丢空间索引能力 | 使用 PostGIS geometry，RegionResolve 只返回瘦身后的 `geometryRef` |
| 从 `public/geo/中华人民共和国.geojson` 导入 | 数据已落库，导入脚本不是第一优先级 | 第一阶段改为验收/规范现有表，必要时补充缺失区域 |
| 海域维持本地文件 | PostGIS 已有 `custom_region` / `sea_geom` | 海域优先从 PostGIS 查 |
| RegionResolve 返回 bbox 即可 | 会导致模型猜 bbox、下游 bbox 不一致 | 返回 `bbox + center + geometryRef + sourceTable`，下游必须复用 |

---

## 关键原则

1. **PostGIS 是事实源**  
   `region_geom` 里的空间数据是 RegionResolve 的主数据源。本地 GeoJSON 只作为测试 fixture 或 fallback，不再作为主路径。

2. **RegionResolve 不把完整 geometry 暴露给模型**  
   observation 里只返回：
   - `selected.id`
   - `selected.name`
   - `selected.level`
   - `selected.sourceTable`
   - `selected.geometryRef`
   - `selected.bbox`
   - `selected.center`

3. **RegionMark 通过 geometryRef 取真实轮廓**  
   模型不需要、也不应该搬运全量坐标。`RegionMark` 接收 `geometryRef` 后由工具内部查询 PostGIS，并输出前端需要的 GIS coordinates。

4. **resolved=false 时绝不猜 bbox**  
   如果 `RegionResolve` 没命中，模型必须停下并要求用户提供 bbox/polygon，或提示区域库缺失。工具链测试必须覆盖这条规则。

5. **下游工具必须复用同一个 bbox**  
   WeatherFetch、aircraft SQL、AIS SQL 都必须使用 `RegionResolve.selected.bbox`。不得出现 `RegionMark` 用 119-122.5、SQL 用 117-122.5 这种漂移。

---

## 推荐架构

```mermaid
flowchart LR
  Q["用户自然语言区域问题"] --> RR["RegionResolve"]
  RR --> C["region_geom.region_resolve_catalog"]
  C --> PG["PostGIS source tables"]
  RR -->|"selected: bbox + geometryRef"| RM["RegionMark"]
  RR -->|"same bbox"| DS["Weather / Aircraft / AIS"]
  RM -->|"query geometry by geometryRef"| PG
  RM --> GIS["gisData region"]
  DS --> OUT["data + optional gisData"]
```

---

## Phase 0：PostGIS 数据验收与缺口补齐

### Phase 0 执行记录（2026-06-11）

已新增脚本：

- `api/scripts/geo/ensure-taiwan-strait-region.ts`
- `api/scripts/geo/check-region-geom-db.ts`

已在 `region_geom.custom_region` 补齐：

| id | region_cn | region_en | level | geometry | bbox |
|---:|---|---|---|---|---|
| 92 | 台湾海峡 | Taiwan Strait | strait | Polygon, SRID 4326 | west=117, east=122.5, south=22, north=26.5 |

说明：当前 geometry 是 `curated_bbox_polygon` 近似边界，用于先消除模型运行时猜 bbox；后续如果拿到更权威海峡边界，可直接更新该记录的 `geom` 和 `note`。

验收结果：

- `custom_region` 从 34 条变为 35 条。
- `custom_region.id` 无重复。
- v1 主源 geometry 均可规范化为 SRID 4326。
- v1 主源无 null geom、无 invalid geometry。

### 0.1 固化验收 SQL

新增脚本：

- `api/scripts/geo/check-region-geom-db.ts`

检查内容：

- `GEO_DATABASE_URL` 可连接。
- `region_geom` schema 存在。
- 14 张表存在。
- 主表行数符合预期：
  - `china_province >= 34`
  - `china_city >= 370`
  - `china_town >= 2900`
  - `taiwan >= 42`
  - `custom_region >= 34`
  - `international >= 250`
- `geom` 列存在且非空。
- 所有 v1 主源 geometry 可被规范化为 4326。

### 0.2 处理 SRID=0

验收发现多个主表 `ST_SRID(geom)=0`。第一版不要直接改源表，统一在 catalog 视图里规范化：

```sql
CASE
  WHEN ST_SRID(geom) = 0 THEN ST_SetSRID(geom, 4326)
  ELSE ST_Transform(geom, 4326)
END
```

### 0.3 补齐台湾海峡

当前库里有：

- `china_province`: 台湾省
- `taiwan`: 台中市、台南市、台东县等台湾行政区
- `custom_region`: 台湾演习区

但没有确认存在严格意义的 `台湾海峡`。这正是前端 smoke 失败根因之一。

第一版必须补一个权威条目，建议放入：

- `region_geom.custom_region`
- `region_cn = '台湾海峡'`
- `region_en = 'Taiwan Strait'`
- `level = 'sea'` 或 `level = 'strait'`
- `geom = Polygon/MultiPolygon, SRID 4326`

如果暂时没有精确边界，允许先使用明确标注为 `curated_bbox_polygon` 的人工边界，但必须写入数据源说明，不能让模型运行时猜。

验收：

- `RegionResolve("台湾海峡") -> resolved=true`
- `selected.matchType = exact_name`
- `selected.sourceTable = custom_region`
- `selected.bbox` 后续被 RegionMark/WeatherFetch/SQL 原样复用

---

## Phase 1：建立统一解析 catalog

### Phase 1 执行记录（2026-06-11）

已新增脚本：

- `api/scripts/geo/create-region-resolve-catalog.ts`

已创建派生对象：

- `region_geom.region_resolve_catalog`

已创建索引：

- `region_resolve_catalog_geom_gix`：GIST(`geom`)
- `region_resolve_catalog_name_idx`：BTREE(`name`)
- `region_resolve_catalog_level_idx`：BTREE(`level`)
- `region_resolve_catalog_aliases_gin`：GIN(`aliases`)
- `region_resolve_catalog_source_idx`：BTREE(`source_table`, `source_id`, `stable_id`)

验收结果：

| 指标 | 结果 |
|---|---:|
| catalog 总行数 | 3651 |
| null geometry | 0 |
| invalid geometry | 0 |
| SRID 4326 行数 | 3651 |
| 关键字段空值（source_id/stable_id/name/level/geom） | 0 |

来源分布：

| source_table | 行数 |
|---|---:|
| `china_province` | 34 |
| `china_city` | 370 |
| `china_town` | 2917 |
| `taiwan` | 42 |
| `custom_region` | 35 |
| `sea_geom` | 2 |
| `international` | 251 |

关键样本：

- `台湾海峡` -> `custom_region`, `source_id=92`, `level=strait`, bbox `117,22,122.5,26.5`
- `福建省` -> `china_province`, `stable_id=350000`, aliases `{福建省, 福建}`
- `福州市` -> `china_city`, `stable_id=350100`, aliases `{福州市, 福州}`
- `台中市` 同时存在于 `taiwan` 与 `china_town`，后续 RegionResolve 需通过 source/level priority 选择 `taiwan`
- `菲律宾` -> `international`, level 已归一为 `country`

### 1.1 新增 PostGIS 物化视图

优先使用物化视图，而不是业务库 Drizzle 表：

```sql
CREATE MATERIALIZED VIEW IF NOT EXISTS region_geom.region_resolve_catalog AS
SELECT
  'china_province' AS source_table,
  gid::text AS source_id,
  adcode::text AS stable_id,
  name,
  NULL::text AS name_en,
  COALESCE(level, 'province') AS level,
  parent::text AS parent_id,
  ARRAY_REMOVE(ARRAY[name, regexp_replace(name, '(省|市|自治区|特别行政区)$', '')], NULL) AS aliases,
  CASE WHEN ST_SRID(geom) = 0 THEN ST_SetSRID(geom, 4326) ELSE ST_Transform(geom, 4326) END AS geom
FROM region_geom.china_province
UNION ALL
SELECT
  'china_city',
  gid::text,
  adcode::text,
  name,
  NULL::text,
  COALESCE(level, 'city'),
  parent::text,
  ARRAY_REMOVE(ARRAY[name, regexp_replace(name, '(市|地区|自治州|盟)$', '')], NULL),
  CASE WHEN ST_SRID(geom) = 0 THEN ST_SetSRID(geom, 4326) ELSE ST_Transform(geom, 4326) END
FROM region_geom.china_city
UNION ALL
SELECT
  'china_town',
  gid::text,
  adcode::text,
  name,
  NULL::text,
  COALESCE(level, 'district'),
  parent::text,
  ARRAY_REMOVE(ARRAY[name, regexp_replace(name, '(区|县|市|旗)$', '')], NULL),
  CASE WHEN ST_SRID(geom) = 0 THEN ST_SetSRID(geom, 4326) ELSE ST_Transform(geom, 4326) END
FROM region_geom.china_town
UNION ALL
SELECT
  'taiwan',
  gid::text,
  gid::text,
  name,
  NULL::text,
  'taiwan_admin',
  NULL::text,
  ARRAY[name],
  CASE WHEN ST_SRID(geom) = 0 THEN ST_SetSRID(geom, 4326) ELSE ST_Transform(geom, 4326) END
FROM region_geom.taiwan
UNION ALL
SELECT
  'custom_region',
  id::text,
  id::text,
  region_cn,
  region_en,
  COALESCE(level, 'custom'),
  NULL::text,
  ARRAY_REMOVE(ARRAY[region_cn, region_en, note], NULL),
  CASE WHEN ST_SRID(geom) = 0 THEN ST_SetSRID(geom, 4326) ELSE ST_Transform(geom, 4326) END
FROM region_geom.custom_region
UNION ALL
SELECT
  'sea_geom',
  id::text,
  id::text,
  country_cn,
  country_en,
  'sea',
  NULL::text,
  ARRAY_REMOVE(ARRAY[country_cn, country_en], NULL),
  CASE WHEN ST_SRID(geom) = 0 THEN ST_SetSRID(geom, 4326) ELSE ST_Transform(geom, 4326) END
FROM region_geom.sea_geom
UNION ALL
SELECT
  'international',
  id::text,
  id::text,
  country_cn,
  country_en,
  COALESCE(level, 'country'),
  NULL::text,
  ARRAY_REMOVE(ARRAY[country_cn, country_en, region_cn, region_en, continent_cn, continent_en, capital_cn, capital_en], NULL),
  CASE WHEN ST_SRID(geom) = 0 THEN ST_SetSRID(geom, 4326) ELSE ST_Transform(geom, 4326) END
FROM region_geom.international;
```

### 1.2 新增派生列或查询表达式

RegionResolve 查询时派生：

```sql
ST_XMin(ST_Envelope(geom)) AS bbox_west,
ST_XMax(ST_Envelope(geom)) AS bbox_east,
ST_YMin(ST_Envelope(geom)) AS bbox_south,
ST_YMax(ST_Envelope(geom)) AS bbox_north,
ST_X(ST_PointOnSurface(geom)) AS center_lon,
ST_Y(ST_PointOnSurface(geom)) AS center_lat,
GeometryType(geom) AS geometry_type
```

### 1.3 索引

```sql
CREATE INDEX IF NOT EXISTS region_resolve_catalog_geom_gix
  ON region_geom.region_resolve_catalog USING GIST (geom);

CREATE INDEX IF NOT EXISTS region_resolve_catalog_name_idx
  ON region_geom.region_resolve_catalog (name);

CREATE INDEX IF NOT EXISTS region_resolve_catalog_level_idx
  ON region_geom.region_resolve_catalog (level);

CREATE INDEX IF NOT EXISTS region_resolve_catalog_aliases_gin
  ON region_geom.region_resolve_catalog USING GIN (aliases);
```

可选二期：

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS region_resolve_catalog_name_trgm
  ON region_geom.region_resolve_catalog USING GIN (name gin_trgm_ops);
```

---

## Phase 2：RegionResolve 接入 PostGIS

### Phase 2 执行记录（2026-06-11）

已新增：

- `api/src/config/geoDatabase.ts`

已修改：

- `api/src/modules/agent-loop/tools/domain/gis/regionResolve.ts`
- `api/tests/gis/test-region-resolve-tool.mjs`
- `api/tests/gis/test-region-resolve-error-handling.mjs`

实现结果：

- `RegionResolve` 默认从 `GEO_DATABASE_URL` 指向的 PostGIS `region_geom.region_resolve_catalog` 读取区域 catalog。
- 本地 GeoJSON 仍作为 fallback，用于保留 `中国东海/东海` 这类尚未进入 PostGIS catalog 的海域能力。
- 返回给模型的 observation 包含 `bbox + center + geometryRef`，不包含完整 geometry coordinates。
- `REGION_RESOLVE_SOURCE=geojson` 可强制走旧 GeoJSON 路径，用于错误处理测试和降级验证。
- 匹配策略仍为 `exact_name -> exact_alias -> query_contains_name -> query_contains_alias -> partial`。
- 单字符 alias 被过滤，避免 `东` 命中大量 `东区/东海县` 一类候选。
- 排序已支持 level/source priority，`台中市` 在 `taiwan` 与 `china_town` 同名时优先返回 `taiwan`。

已验证：

- `台湾海峡` -> `resolved=true`, `source=postgis`, `sourceTable=custom_region`, `level=strait`, `geometryRef.sourceId=92`
- `福建省` -> `china_province`, `stableId=350000`
- `福州市` -> `china_city`, `stableId=350100`
- `台中市` -> `taiwan`, `level=taiwan_admin`
- `菲律宾` -> `international`, `level=country`
- `东海` -> 保留 fallback 命中 `中国东海`
- `不存在/单字泛匹配` 不会误解析

验证命令：

```powershell
.\node_modules\.bin\tsx.CMD tests\gis\test-region-resolve-tool.mjs
.\node_modules\.bin\tsx.CMD tests\gis\test-region-resolve-error-handling.mjs
.\node_modules\.bin\tsc.CMD -p tsconfig.json --noEmit --pretty false
```

### 2.1 新增 geo DB client

新增：

- `api/src/config/geoDatabase.ts`

要求：

- 读取 `GEO_DATABASE_URL`
- 使用 `pg` Pool 或 Client
- 只服务 RegionResolve/RegionMark 的空间读取
- 不和业务库 `DATABASE_URL` 混用

### 2.2 RegionResolve 输入保持稳定

保留：

```ts
{
  regionName?: string;
  query?: string;
  maxCandidates?: number;
  minConfidence?: number;
}
```

新增内部配置：

- `REGION_RESOLVE_SOURCE=postgis`
- `REGION_RESOLVE_SCHEMA=region_geom`
- `REGION_RESOLVE_CATALOG=region_resolve_catalog`

### 2.3 RegionCandidate 扩展

```ts
interface RegionCandidate {
  id: string;
  name: string;
  aliases: string[];
  level: string;
  source: "postgis";
  sourceTable: string;
  sourceId: string;
  geometryRef: {
    schema: "region_geom";
    catalog: "region_resolve_catalog";
    sourceTable: string;
    sourceId: string;
    stableId: string;
  };
  geometryType: "POLYGON" | "MULTIPOLYGON" | "GEOMETRY" | string;
  confidence: number;
  matchType:
    | "exact_name"
    | "exact_alias"
    | "query_contains_name"
    | "query_contains_alias"
    | "partial"
    | "trigram";
  bbox: {
    west: number;
    east: number;
    south: number;
    north: number;
  };
  center?: [number, number];
}
```

Observation 仍然禁止携带完整 coordinates。

### 2.4 匹配策略

第一版顺序：

1. `exact_name`，confidence 1.0
2. `exact_alias`，confidence 1.0
3. `query_contains_name`，confidence 0.92
4. `query_contains_alias`，confidence 0.90
5. `partial`，confidence 0.60，仅当 searchText 长度 >= 2
6. `trigram`，二期启用

排序 tie-breaker：

1. confidence desc
2. level priority desc
3. source priority desc
4. name length asc

建议 level priority：

| level | priority |
|---|---:|
| `sea` / `strait` / `custom` / `strategy` | 95 |
| `country` | 90 |
| `province` | 80 |
| `city` | 70 |
| `district` / `town` | 60 |
| `taiwan_admin` | 60 |

source priority：

1. `custom_region`
2. `sea_geom`
3. `china_province`
4. `china_city`
5. `taiwan`
6. `china_town`
7. `international`

原因：自定义海域/战略区比行政区更贴近“台湾海峡、第一岛链、南中国海附近海域”这类用户语义。

---

## Phase 3：RegionMark 支持 geometryRef

### Phase 3 执行记录（2026-06-11）

已修改：

- `api/src/modules/agent-loop/tools/domain/gis/regionMark.ts`
- `api/tests/gis/test-region-mark-tool.mjs`

实现结果：

- `RegionMark` input schema 新增 `geometryRef`，绘制优先级为 `geometryRef -> polygon -> bbox`。
- `geometryRef` 固定指向 `region_geom.region_resolve_catalog`，通过 `sourceTable/sourceId/stableId` 查询真实 PostGIS geometry。
- `RegionMark` 使用 `ST_AsGeoJSON(geom)` 读取 geometry，并用同一 geometry 计算 bbox、center/cameraView。
- 第一版支持 `Polygon` 和 `MultiPolygon`；`MultiPolygon` 输出最大外环，保持前端现有 `regions[].coordinates` 单 ring 结构不变。
- 对 `MULTILINESTRING` 等线要素直接拒绝，留到后续 line layer。
- 旧的 bbox/polygon 输入保持兼容。

已验证：

- `RegionResolve("台湾海峡") -> RegionMark(selected.geometryRef)` 返回 `dataSource=postgis`。
- `RegionMark` 输出台湾海峡 ring 坐标来自 PostGIS geometry，而不是模型临场生成。
- `cameraView.bbox` 与 `RegionResolve.selected.bbox` 一致。
- 无 geometryRef/bbox/polygon 时仍拒绝，不猜 named region。

验证命令：

```powershell
.\node_modules\.bin\tsx.CMD tests\gis\test-region-mark-tool.mjs
.\node_modules\.bin\tsx.CMD tests\gis\test-region-resolve-tool.mjs
.\node_modules\.bin\tsx.CMD tests\gis\test-region-resolve-error-handling.mjs
.\node_modules\.bin\tsx.CMD tests\gis\test-weather-fetch-tool.mjs
.\node_modules\.bin\tsc.CMD -p tsconfig.json --noEmit --pretty false
```

### 3.1 扩展输入

```ts
const GeometryRefSchema = z.strictObject({
  schema: z.literal("region_geom"),
  catalog: z.literal("region_resolve_catalog"),
  sourceTable: z.string().trim().min(1),
  sourceId: z.string().trim().min(1),
  stableId: z.string().trim().min(1),
});

const RegionMarkInputSchema = z.strictObject({
  name: z.string().trim().min(1),
  geometryRef: GeometryRefSchema.optional(),
  bbox: BboxSchema.optional(),
  polygon: z.array(CoordinatePairSchema).min(3).max(MAX_POLYGON_POINTS).optional(),
  regionType: z.enum(["monitor", "control", "service"]).default("monitor"),
  label: z.string().trim().min(1).optional(),
  style: RegionStyleSchema.optional(),
}).refine(
  (input) => Boolean(input.geometryRef || input.bbox || input.polygon),
  "RegionMark requires geometryRef, bbox, or polygon."
);
```

### 3.2 绘制优先级

```text
geometryRef -> polygon -> bbox
```

当传入 `geometryRef`：

1. RegionMark 从 `region_geom.region_resolve_catalog` 读取 geometry。
2. 使用 `ST_AsGeoJSON(geom)` 输出前端可用轮廓。
3. 使用同一 geometry 计算 bbox 和 cameraView。
4. 如果 geometry 类型是 `MULTILINESTRING`，v1 直接拒绝并提示该要素需要 line layer 支持。

### 3.3 输出约束

前端当前 `GisData.regions[].coordinates` 主要吃 polygon ring。第一版只支持：

- Polygon
- MultiPolygon

如果 MultiPolygon 坐标过大：

- 优先 `ST_SimplifyPreserveTopology(geom, tolerance)` 降采样。
- 仍保留 `bbox` 和 `geometryRef`。
- 不把超大原始 geometry 塞进 LLM observation。

---

## Phase 4：Agent Loop 规则收紧

### Phase 4 执行记录（2026-06-11）

已修改：

- `api/src/modules/agent-loop/promptManager.ts`
- `api/src/modules/agent-loop/tools/domain/weather.ts`
- `api/scripts/agent-loop/agent-loop-smoke-gis.ts`
- `api/tests/agent-loop/test-prompt-manager-gis-routing.mjs`
- `api/tests/agent-loop/test-agent-loop-smoke-gis-helpers.mjs`
- `api/src/instructions/database-description.md`
- `skills/aircraft-region-query/SKILL.md`
- `skills/ais-region-query/SKILL.md`
- `api/tests/data/test-aircraft-skill-doc.mjs`
- `api/tests/data/test-ais-skill-doc.mjs`

实现结果：

- System prompt 中 GIS routing 已收紧为 `RegionResolve -> RegionMark(selected.geometryRef) -> downstream tools`。
- `RegionMark` 只在 `selected.geometryRef` 缺失时才 fallback 到 `selected.bbox`。
- WeatherFetch 工具描述要求命名区域链路复用 `RegionResolve.selected.bbox`。
- `aircraft-region-query` 与 `ais-region-query` 移除硬编码区域 bbox 表，改为只接受 `RegionResolve.selected.bbox` 或用户显式 bbox。
- 数据库说明补充统一 GIS bbox rule，要求 aircraft/AIS SQL 按 `selected.bbox.south/north/west/east` 原样过滤。
- GIS fake smoke 默认场景改为 `台湾海峡`，覆盖 PostGIS `geometryRef` 主路径。
- smoke validator 增加 bbox drift 检查：`RegionMark.bbox`、`cameraView.bbox`、`WeatherFetch.bbox/windField.bbox` 必须与 `RegionResolve.selected.bbox` 一致。
- helper 测试覆盖 `resolved=false` 时直接 final answer，不继续调用 RegionMark。

已验证：

```powershell
.\node_modules\.bin\tsx.CMD tests\agent-loop\test-prompt-manager-gis-routing.mjs
.\node_modules\.bin\tsx.CMD tests\agent-loop\test-agent-loop-smoke-gis-helpers.mjs
.\node_modules\.bin\tsx.CMD tests\data\test-aircraft-skill-doc.mjs
.\node_modules\.bin\tsx.CMD tests\data\test-ais-skill-doc.mjs
.\node_modules\.bin\tsx.CMD scripts\agent-loop\agent-loop-smoke.ts --scenario gis-toolchain --max-turns 6
```

更新 `api/src/modules/agent-loop/promptManager.ts` 中 GIS routing：

```markdown
# GIS Tool Routing Rules
When the user asks to mark, focus, circle, display, or analyze a named geographic region:
1. Call RegionResolve first.
2. If resolved=true, call RegionMark with selected.geometryRef. Pass selected.bbox as fallback only.
3. If downstream weather, aircraft, maritime, or disaster data is requested, reuse selected.bbox exactly.
4. If resolved=false, do not guess. Ask for bbox/polygon or say the region is not available.
5. Never invent a bbox for a named region after RegionResolve fails.
```

同时更新：

- `aircraft-region-query` skill
- `ais-region-query` skill
- WeatherFetch 工具描述

要求：所有下游 SQL/天气查询都必须引用 `selected.bbox`，不能自行扩大或改写范围。

---

## Phase 5：测试与 smoke

### 5.1 单元/集成测试

新增或更新：

- `api/tests/gis/test-region-resolve-postgis-tool.mjs`
- `api/tests/gis/test-region-mark-geometry-ref.mjs`
- `api/tests/agent-loop/test-prompt-manager-gis-routing.mjs`
- `api/scripts/agent-loop/agent-loop-smoke-gis.ts`

### 5.2 必测用例

| 提问/输入 | 期望 |
|---|---|
| `台湾海峡` | `resolved=true`, `sourceTable=custom_region`, level 为 `sea/strait/custom` |
| `台湾省` | 命中行政区，不误命中台湾演习区 |
| `台中市` | 命中 `taiwan` 表 |
| `福建省` | 命中 `china_province` |
| `福州市` | 命中 `china_city` |
| `南中国海附近海域` | 命中 `custom_region` |
| `中国沿海` | 命中 `sea_geom` |
| `第一岛链` | 命中 `custom_region` |
| `菲律宾` | 命中 `international` |
| `不存在的幻想区域` | `resolved=false`，不得调用 RegionMark |

### 5.3 端到端 smoke

复用 `api/scripts/agent-loop/agent-loop-smoke-gis.ts` 和前端真实提问：

1. `圈选台湾海峡，并显示该区域天气。`
   - 必须走 `RegionResolve -> RegionMark -> WeatherFetch`
   - `RegionResolve.resolved=true`
   - `RegionMark` 使用 `geometryRef`
   - `WeatherFetch` 使用同一 bbox

2. `查询台湾海峡附近当前有哪些飞机，并在地图上标记。`
   - 必须走 `RegionResolve -> RegionMark -> aircraft SQL`
   - `RegionMark` bbox 与 aircraft SQL bbox 完全一致
   - 如果 SQL 第一页已返回完整结果，不允许无意义 OFFSET 再查重复子集
   - final answer 必须报告 OpenSky 数据快照时间，如果数据超过 2 小时，要明确说“数据不是当前实时”

---

## 实施顺序

### Step 1：只做数据层适配

1. 新增 geo DB client。
2. 新增 `region_geom.region_resolve_catalog` 物化视图 SQL。
3. 新增 `check-region-geom-db.ts`。
4. 补 `台湾海峡` 数据。

验收后再动 Agent Loop 工具。

### Step 2：改 RegionResolve

1. 从 PostGIS catalog 查询候选。
2. 返回 `geometryRef + bbox + center`。
3. 保留本地 GeoJSON fallback，但只用于测试或 `REGION_RESOLVE_SOURCE=geojson`。

### Step 3：改 RegionMark

1. 支持 `geometryRef`。
2. Polygon/MultiPolygon 输出真实轮廓。
3. bbox 只作为 fallback。

### Step 4：改 prompt / skills / smoke

1. 收紧 `resolved=false` 不猜 bbox。
2. 收紧下游复用 bbox。
3. 跑 fake + 真实前端 smoke。

---

## 风险与边界

| 风险 | 处理 |
|---|---|
| 多表字段不统一 | 用 `region_resolve_catalog` 统一投影，工具只查 catalog |
| SRID=0 | catalog 中统一 `ST_SetSRID(geom,4326)` |
| `international` 和 `international_copt` 重复 | v1 只用 `international` |
| `custom_region_copy1` 语义不清 | v1 不作为主源 |
| `rivers` 是线要素 | RegionMark v1 不支持，后续做 line layer |
| 大 geometry 造成前端或 LLM 输出过大 | observation 不出 coordinates，RegionMark 输出前做 simplify |
| 台湾海峡缺少严格边界 | 必须先补 curated geometry，不能让模型猜 |
| 通用 SqlQuery 暴露 geo schema | 不建议把 `region_geom` 加进 agent SQL allowlist；RegionResolve/RegionMark 自己读 geo DB |

---

## 最终验收清单

- [x] `GEO_DATABASE_URL` 可连接 `show_room`
- [x] `region_geom.region_resolve_catalog` 存在
- [x] catalog 行数 >= 3600
- [x] catalog 中所有 geometry 查询输出 SRID 4326
- [x] `台湾海峡` 已补入 `custom_region`，且不是 `台湾演习区`
- [x] RegionResolve observation 不包含完整 coordinates
- [x] RegionResolve 返回 `geometryRef`
- [x] RegionMark 使用 `geometryRef` 绘制真实轮廓
- [x] 下游 WeatherFetch/aircraft/AIS 复用同一 bbox
- [x] `resolved=false` 时 agent 不调用 RegionMark
- [ ] 两个真实前端提问生成的日志无 bbox 漂移、无重复分页 GIS output
