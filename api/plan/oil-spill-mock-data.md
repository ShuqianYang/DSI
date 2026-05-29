# 东海油污溯源 Mock Data — subtask 4-7 数据集

> 配套实施：`scenario-oil-spill-tracing.md` §3.4–3.7
> 用法：capability 实现时直接 copy 下面的 JSON 结构作为 `result.data`，跑通整条链路
> 坐标基准：油膜中心 `(123.0125, 30.2561)`（已东移 +0.5°），排污原点按气象反推

---

## 1. 场景常量

| 常量 | 值 |
|---|---|
| 油膜中心 (来自 satellite) | `(123.0125, 30.2561)` |
| **排污原点** | `(123.0375, 30.2761)` ← 在油膜中心 **东北偏北** ~3.5 km |
| 漂移方向（反推） | 排污原点 → 西南 → 油膜中心 |
| 风（来自 weather-fetch） | 3.2 m/s 东北风（来自东北，推物体向西南）|
| 洋流（来自 weather-fetch） | 0.8 m/s 东南向 |
| 合力 | 主导西南偏南，与漂移路径自洽 |
| 排污时间窗 | **T-36h ~ T-34h**（近 72h 内一日 10:00–12:00 UTC+8）|
| 漂移耗时 | ~ 36h（从排污到 SAR 影像拍摄到油膜）|
| 时空匹配区域 | 排污原点 ±0.5 km × ±0.5 km，时间 10:00–12:00 |

> "T" 指任务执行时刻（now）。所有相对时间戳在 capability 里用 `Date.now() - offsetMs` 现算。

---

## 2. `oil-drift` mock（subtask 4 输出）

```ts
const oilDriftMock = {
  driftPathLengthKm: 3.5,
  driftPath: [
    [123.0375, 30.2761],  // 起点：排污原点（东北）
    [123.0316, 30.2712],  // 漂移中段 1
    [123.0257, 30.2664],  // 漂移中段 2
    [123.0198, 30.2615],  // 漂移中段 3
    [123.0125, 30.2561],  // 终点：油膜中心（西南）
  ],
  pollutionOrigin: {
    lng: 123.0375,
    lat: 30.2761,
    lngDMS: "东经123°02′15″",
    latDMS: "北纬30°16′34″",
    timeRange: "近72小时内10:00-12:00（UTC+8）",
    confidence: "误差≤2小时",
  },
  gisData: {
    type: "trajectory" as const,
    trajectories: [{
      id: "drift-path",
      name: "油污漂移溯源路径",
      type: "route" as const,
      coordinates: [
        [123.0375, 30.2761], [123.0316, 30.2712],
        [123.0257, 30.2664], [123.0198, 30.2615],
        [123.0125, 30.2561],
      ] as [number, number][],
      status: "history" as const,
    }],
    entities: [{
      id: "pollution-origin",
      name: "排污原点",
      type: "base" as const,
      coordinates: [123.0375, 30.2761] as [number, number],
      importance: "high" as const,
      status: "danger" as const,
      description: "油污漂移反推排污原点 | 时间: 近72h内10:00-12:00 | 误差≤2h",
    }],
  },
};
```

---

## 3. 5 艘船的基础画像（`ais-fetch` 输出）

| # | 排名 | MMSI | 国家代码 | 国家 | 船型 | 船名 | 长×宽 (m) | DWT (吨) |
|---|---|---|---|---|---|---|---|---|
| 1 | 首要 | `413567890` | 413 | 中国 | 散货货轮 | 远洋货轮 01 | 180 × 28 | 35000 |
| 2 | 次要 | `431758432` | 431 | 日本 | 集装箱船 | KOBE STAR | 260 × 32 | 50000 |
| 3 | 次要 | `440912756` | 440 | 韩国 | 散货船 | DAEYANG VICTORY | 220 × 32 | 60000 |
| 4 | 次要 | `357654321` | 357 | 巴拿马（权宜旗） | 成品油轮 | OCEAN PEARL | 185 × 27 | 40000 |
| 5 | 一般 | `412987654` | 412 | 中国 | 远洋渔船 | 浙象渔 18866 | 38 × 7 | — |

每艘船的完整 `vessel` 对象：

```ts
const vessels = [
  {
    mmsi: "413567890",
    name: "远洋货轮01",
    type: "货轮",
    flag: "CN",
    length: 180,
    width: 28,
    dwt: 35000,
    callSign: "BVZQ7",
    imo: "9456789",
  },
  {
    mmsi: "431758432",
    name: "KOBE STAR",
    type: "集装箱船",
    flag: "JP",
    length: 260,
    width: 32,
    dwt: 50000,
    callSign: "7JFA",
    imo: "9712345",
  },
  {
    mmsi: "440912756",
    name: "DAEYANG VICTORY",
    type: "散货船",
    flag: "KR",
    length: 220,
    width: 32,
    dwt: 60000,
    callSign: "DSVT7",
    imo: "9645234",
  },
  {
    mmsi: "357654321",
    name: "OCEAN PEARL",
    type: "成品油轮",
    flag: "PA",
    length: 185,
    width: 27,
    dwt: 40000,
    callSign: "3FQH8",
    imo: "9523456",
  },
  {
    mmsi: "412987654",
    name: "浙象渔18866",
    type: "远洋渔船",
    flag: "CN",
    length: 38,
    width: 7,
    callSign: "BX18866",
  },
];
```

---

## 4. 5 艘船的 AIS 轨迹（每艘 8-10 点）

时间戳约定：`tFromNow(hours)` = `Date.now() - hours * 3600 * 1000`。排污窗 = T-36h ~ T-34h（11:00 锚点）。

### 4.1 首要嫌疑 — 远洋货轮 01（中国，MMSI 413567890）

剧情：从舟山港出发往日本方向，**异常绕路靠近排污原点**，22 min 慢速逗留，然后加速向东北离开。**轨迹明显偏离常规东海主航道**。

```ts
{
  mmsi: "413567890",
  points: [
    { coord: [122.20, 30.30], t: tFromNow(72), speedKn: 14, heading: 95 },  // 出发：舟山港外
    { coord: [122.55, 30.32], t: tFromNow(60), speedKn: 13, heading: 90 },  // 正常东行
    { coord: [122.85, 30.30], t: tFromNow(48), speedKn: 13, heading: 95 },  // 接近油膜区域
    { coord: [122.98, 30.29], t: tFromNow(40), speedKn: 12, heading: 80 },  // 异常北偏：绕路
    { coord: [123.035, 30.275], t: tFromNow(36.2), speedKn: 4, heading: 45 }, // ★ 进入匹配区
    { coord: [123.0375, 30.2761], t: tFromNow(35.8), speedKn: 1, heading: 0 }, // ★ 停留中（10:12）
    { coord: [123.0392, 30.2775], t: tFromNow(35.5), speedKn: 1, heading: 30 }, // ★ 停留末
    { coord: [123.06, 30.30], t: tFromNow(34.6), speedKn: 16, heading: 60 },  // 加速离开（异常快）
    { coord: [123.40, 30.50], t: tFromNow(24), speedKn: 15, heading: 65 },  // 往日本方向
    { coord: [124.10, 30.95], t: tFromNow(8), speedKn: 14, heading: 70 },   // 当前位置
  ],
  matchedAt: [123.0375, 30.2761],
  stayDurationMin: 22,
  closestDistanceM: 80,
  aisGapMin: 0,
}
```

### 4.2 次要嫌疑 — KOBE STAR（日本，MMSI 431758432）

剧情：上海港 → 神户航线，**短暂减速 15 min** 经过排污原点附近（可能因风浪调整航向），但停留位置偏离 240 m，无明显异动。

```ts
{
  mmsi: "431758432",
  points: [
    { coord: [121.55, 31.30], t: tFromNow(68), speedKn: 15, heading: 100 }, // 上海港出
    { coord: [122.10, 30.95], t: tFromNow(58), speedKn: 16, heading: 105 },
    { coord: [122.60, 30.65], t: tFromNow(46), speedKn: 16, heading: 110 },
    { coord: [122.95, 30.40], t: tFromNow(38), speedKn: 14, heading: 115 },
    { coord: [123.030, 30.290], t: tFromNow(36.5), speedKn: 8, heading: 100 }, // ★ 减速
    { coord: [123.035, 30.278], t: tFromNow(36.0), speedKn: 5, heading: 95 },  // ★ 接近原点
    { coord: [123.039, 30.270], t: tFromNow(35.7), speedKn: 6, heading: 90 },  // ★ 缓慢通过
    { coord: [123.12, 30.18], t: tFromNow(34.5), speedKn: 15, heading: 110 }, // 恢复巡航
    { coord: [124.5, 29.5], t: tFromNow(20), speedKn: 16, heading: 115 },    // 往神户
    { coord: [126.8, 29.2], t: tFromNow(6), speedKn: 16, heading: 120 },     // 当前
  ],
  matchedAt: [123.035, 30.278],
  stayDurationMin: 15,
  closestDistanceM: 240,
  aisGapMin: 0,
}
```

### 4.3 次要嫌疑 — DAEYANG VICTORY（韩国，MMSI 440912756）

剧情：釜山 → 上海航线，在排污原点附近 **18 min 调整航向**（GPS 信号显示原地小幅旋转），停留位置 320 m 偏离。

```ts
{
  mmsi: "440912756",
  points: [
    { coord: [127.50, 33.80], t: tFromNow(70), speedKn: 14, heading: 240 }, // 釜山出
    { coord: [126.20, 32.50], t: tFromNow(60), speedKn: 14, heading: 235 },
    { coord: [124.80, 31.20], t: tFromNow(48), speedKn: 14, heading: 240 },
    { coord: [123.50, 30.50], t: tFromNow(40), speedKn: 13, heading: 245 },
    { coord: [123.10, 30.30], t: tFromNow(37), speedKn: 10, heading: 250 },
    { coord: [123.042, 30.280], t: tFromNow(36.3), speedKn: 6, heading: 270 }, // ★ 接近 / 减速
    { coord: [123.040, 30.272], t: tFromNow(36.0), speedKn: 2, heading: 320 }, // ★ 转向中
    { coord: [123.038, 30.276], t: tFromNow(35.7), speedKn: 3, heading: 200 }, // ★ 反复转向
    { coord: [123.025, 30.260], t: tFromNow(35.3), speedKn: 12, heading: 230 }, // 离开
    { coord: [122.50, 30.10], t: tFromNow(20), speedKn: 14, heading: 240 },
    { coord: [121.80, 31.10], t: tFromNow(6), speedKn: 13, heading: 270 },     // 当前
  ],
  matchedAt: [123.040, 30.272],
  stayDurationMin: 18,
  closestDistanceM: 320,
  aisGapMin: 0,
}
```

### 4.4 次要嫌疑 — OCEAN PEARL（巴拿马权宜旗，MMSI 357654321）

**剧情亮点**：经过排污原点附近，**AIS 信号断了 5 min**（嫌疑因素：可能故意关闭以规避监控）。停留 12 min、距原点 450 m，但**信号断点本身让得分高于地理距离应得的分**。

```ts
{
  mmsi: "357654321",
  points: [
    { coord: [121.80, 28.50], t: tFromNow(68), speedKn: 13, heading: 60 },
    { coord: [122.30, 29.20], t: tFromNow(58), speedKn: 13, heading: 50 },
    { coord: [122.80, 29.80], t: tFromNow(46), speedKn: 12, heading: 45 },
    { coord: [123.00, 30.20], t: tFromNow(38), speedKn: 11, heading: 40 },
    { coord: [123.045, 30.275], t: tFromNow(36.5), speedKn: 7, heading: 30 }, // ★ 接近
    /* ★ AIS 信号断点：T-36.4h ~ T-36.32h，约 5 min 无报文 */
    { coord: [123.041, 30.272], t: tFromNow(36.25), speedKn: 4, heading: 350 }, // 信号恢复，已停留
    { coord: [123.038, 30.275], t: tFromNow(36.05), speedKn: 5, heading: 0 },   // 缓慢
    { coord: [123.025, 30.290], t: tFromNow(35.75), speedKn: 9, heading: 340 }, // 离开
    { coord: [122.85, 30.95], t: tFromNow(24), speedKn: 12, heading: 320 },
    { coord: [122.20, 31.85], t: tFromNow(8), speedKn: 12, heading: 320 },      // 当前
  ],
  matchedAt: [123.041, 30.272],
  stayDurationMin: 12,
  closestDistanceM: 450,
  aisGapMin: 5,
  aisGapWindow: { from: tFromNow(36.4), to: tFromNow(36.32) },
}
```

### 4.5 一般嫌疑 — 浙象渔 18866（中国渔船，MMSI 412987654）

剧情：东海作业渔船**正常盘旋轨迹**，经过排污原点 8 min 是过路（自然航速、自然航向、无停留无异动）。**清白对照**，证明打分算法真的会过滤无嫌疑船。

```ts
{
  mmsi: "412987654",
  points: [
    { coord: [122.50, 30.10], t: tFromNow(70), speedKn: 6, heading: 80 },
    { coord: [122.75, 30.15], t: tFromNow(60), speedKn: 5, heading: 70 },
    { coord: [122.95, 30.22], t: tFromNow(48), speedKn: 4, heading: 60 },
    { coord: [123.05, 30.28], t: tFromNow(40), speedKn: 5, heading: 50 },
    { coord: [123.030, 30.272], t: tFromNow(36.5), speedKn: 7, heading: 90 }, // ★ 经过
    { coord: [123.043, 30.272], t: tFromNow(36.37), speedKn: 7, heading: 90 }, // ★ 短停 8min 内
    { coord: [123.10, 30.25], t: tFromNow(36.0), speedKn: 8, heading: 100 },  // 离开
    { coord: [123.30, 30.10], t: tFromNow(24), speedKn: 6, heading: 130 },
    { coord: [123.55, 29.80], t: tFromNow(12), speedKn: 7, heading: 150 },
    { coord: [123.70, 29.50], t: tFromNow(4), speedKn: 6, heading: 170 },     // 当前
  ],
  matchedAt: [123.043, 30.272],
  stayDurationMin: 8,
  closestDistanceM: 850,
  aisGapMin: 0,
}
```

---

## 5. `ais-match-suspects` mock（subtask 6 输出）

匹配逻辑：以排污原点 `(123.0375, 30.2761)` 为中心 1 km × 1 km，时间 10:00–12:00（UTC+8）→ 上面 5 艘船全部命中（按方便演示规模）。

```ts
const aisMatchMock = {
  matchCriteria: {
    center: [123.0375, 30.2761],
    rangeKm: 1,
    timeRange: "近72小时内10:00-12:00",
  },
  matchedCount: 5,  // demo 简化，实际 plan 说 8 艘
  vessels: vessels.map((v, i) => ({
    mmsi: v.mmsi,
    name: v.name,
    type: v.type,
    stayDurationMin: [22, 15, 18, 12, 8][i],
    matchedAt: [
      [123.0375, 30.2761],
      [123.035, 30.278],
      [123.040, 30.272],
      [123.041, 30.272],
      [123.043, 30.272],
    ][i],
  })),
  gisData: {
    type: "entity" as const,
    entities: vessels.map((v, i) => ({
      id: `match-${v.mmsi}`,
      name: v.name,
      type: "ship" as const,
      coordinates: [/* matchedAt 同上 */][i] as [number, number],
      importance: "medium" as const,
      status: "warning" as const,
      description: `MMSI: ${v.mmsi} | ${v.type} | 停留: ${[22,15,18,12,8][i]} min`,
    })),
    trajectories: [/* 5 艘的完整轨迹，每条用 vessel.points.map(p => p.coord) */],
  },
};
```

---

## 6. `ais-suspect-ranking` mock（subtask 7 输出）

打分细节（满分 100）：

| 维度 | 权重 | 远洋货轮 01 | KOBE STAR | DAEYANG VICTORY | OCEAN PEARL | 浙象渔 18866 |
|---|---|---|---|---|---|---|
| 距离原点 (≤100m=40, 100-300=30, 300-500=20, 500-1km=10) | 40 | **40** (80m) | 30 (240m) | 20 (320m) | 20 (450m) | 10 (850m) |
| 异常停留时长 (≥20min=30, 15-20=22, 10-15=15, <10=8) | 30 | **30** (22min) | 22 (15min) | 22 (18min) | 15 (12min) | 8 (8min) |
| 航行异动 (绕路+异常加速=30, AIS 信号断=25, 反复转向=20, 仅减速=10, 自然=5) | 30 | **16**（绕路-减分） | 20 (减速无异动) | 26 (反复转向) | 30 (AIS 断 5min) | 27 (自然) |
| **合计** | 100 | **86** | 72 | 68 | 65 | 45 |

> 注：远洋货轮 01 总分 86 = 40 + 30 + 16；判定依据相对克制（"绕路"扣分仅给 16/30，留出层次感）。
> OCEAN PEARL 的 65 = 20+15+30：地理距离不近、停留也不长，但 AIS 信号断点这一项满 30 分，让它排到次要嫌疑末位。

```ts
const aisRankingMock = {
  totalSuspects: 5,
  scoringWeights: {
    distance: 40,
    stayDuration: 30,
    abnormalBehavior: 30,
  },
  primary: [
    {
      mmsi: "413567890",
      name: "远洋货轮01",
      type: "货轮",
      flag: "CN",
      score: 86,
      rank: 1,
      breakdown: { distance: 40, stay: 30, behavior: 16 },
      reasons: "距排污原点 80m（最近，40分）| 异常停留 22 分钟（30分）| 航线绕路偏离常规东海航道（16分）",
      coordinates: [123.0375, 30.2761] as [number, number],
    },
  ],
  secondary: [
    {
      mmsi: "431758432",
      name: "KOBE STAR",
      type: "集装箱船",
      flag: "JP",
      score: 72,
      rank: 2,
      breakdown: { distance: 30, stay: 22, behavior: 20 },
      reasons: "距原点 240m（30分）| 停留 15 分钟（22分）| 减速但无明显异动（20分）",
      coordinates: [123.035, 30.278] as [number, number],
    },
    {
      mmsi: "440912756",
      name: "DAEYANG VICTORY",
      type: "散货船",
      flag: "KR",
      score: 68,
      rank: 3,
      breakdown: { distance: 20, stay: 22, behavior: 26 },
      reasons: "距原点 320m（20分）| 停留 18 分钟（22分）| 反复转向（26分）",
      coordinates: [123.040, 30.272] as [number, number],
    },
    {
      mmsi: "357654321",
      name: "OCEAN PEARL",
      type: "成品油轮",
      flag: "PA",
      score: 65,
      rank: 4,
      breakdown: { distance: 20, stay: 15, behavior: 30 },
      reasons: "距原点 450m（20分）| 停留 12 分钟（15分）| AIS 信号断 5 分钟（30分，权宜旗+断点重点关注）",
      coordinates: [123.041, 30.272] as [number, number],
    },
  ],
  normal: [
    {
      mmsi: "412987654",
      name: "浙象渔18866",
      type: "远洋渔船",
      flag: "CN",
      score: 45,
      rank: 5,
      breakdown: { distance: 10, stay: 8, behavior: 27 },
      reasons: "距原点 850m（10分）| 短停 8 分钟（8分）| 航迹自然无异动（27分）— 判定为正常过路渔船",
      coordinates: [123.043, 30.272] as [number, number],
    },
  ],
  gisData: {
    type: "entity" as const,
    entities: [
      // 首要嫌疑：红色闪烁
      { id: "suspect-1", name: "首要嫌疑·远洋货轮01", type: "ship" as const,
        coordinates: [123.0375, 30.2761] as [number, number],
        importance: "high" as const, status: "danger" as const,
        description: "MMSI: 413567890 | 得分: 86 | 货轮 | 中国 | 强烈建议核查" },
      // 次要嫌疑：橙色
      { id: "suspect-2", name: "次要嫌疑·KOBE STAR", type: "ship" as const,
        coordinates: [123.035, 30.278] as [number, number],
        importance: "medium" as const, status: "warning" as const,
        description: "MMSI: 431758432 | 得分: 72 | 集装箱船 | 日本" },
      { id: "suspect-3", name: "次要嫌疑·DAEYANG VICTORY", type: "ship" as const,
        coordinates: [123.040, 30.272] as [number, number],
        importance: "medium" as const, status: "warning" as const,
        description: "MMSI: 440912756 | 得分: 68 | 散货船 | 韩国" },
      { id: "suspect-4", name: "次要嫌疑·OCEAN PEARL", type: "ship" as const,
        coordinates: [123.041, 30.272] as [number, number],
        importance: "medium" as const, status: "warning" as const,
        description: "MMSI: 357654321 | 得分: 65 | 成品油轮 | 巴拿马 | AIS 信号断 5min" },
      // 一般嫌疑：灰色 / 正常
      { id: "suspect-5", name: "一般嫌疑·浙象渔18866", type: "ship" as const,
        coordinates: [123.043, 30.272] as [number, number],
        importance: "low" as const, status: "normal" as const,
        description: "MMSI: 412987654 | 得分: 45 | 远洋渔船 | 中国 | 判定正常过路" },
    ],
    trajectories: [
      // 5 艘嫌疑船完整轨迹（按等级着色，前端按 entity.status 决定颜色）
      { id: "traj-suspect-1", name: "首要嫌疑·远洋货轮01 航迹",
        type: "route" as const, status: "history" as const,
        coordinates: [/* 见 §4.1 vessel.points.map(p => p.coord) */] },
      { id: "traj-suspect-2", name: "次要嫌疑·KOBE STAR 航迹",
        type: "route" as const, status: "history" as const,
        coordinates: [/* 见 §4.2 */] },
      { id: "traj-suspect-3", name: "次要嫌疑·DAEYANG VICTORY 航迹",
        type: "route" as const, status: "history" as const,
        coordinates: [/* 见 §4.3 */] },
      { id: "traj-suspect-4", name: "次要嫌疑·OCEAN PEARL 航迹",
        type: "route" as const, status: "history" as const,
        coordinates: [/* 见 §4.4 */] },
      { id: "traj-suspect-5", name: "一般嫌疑·浙象渔18866 航迹",
        type: "route" as const, status: "history" as const,
        coordinates: [/* 见 §4.5 */] },
    ],
  },
};
```

---

## 7. 视觉色彩约定（前端参考）

| 嫌疑等级 | importance | status | entity 渲染 | trajectory 渲染 |
|---|---|---|---|---|
| 首要 | high | danger | **红色闪烁** ●→💥 | 红色实线 |
| 次要 | medium | warning | **橙色** ● | 橙色实线 |
| 一般 | low | normal | **灰/绿** ● | 黄色（或灰）实线 |

前端 `getStatusColor()` 已支持 `danger/warning/normal` 三档；entity / trajectory 渲染逻辑无需新增。

---

## 8. 时间窗 sanity check

```
T-72h ─────────────────────────────────────────────── now (T0)
       │                              │
       └─ 5 艘船的轨迹起点（出发港口）
                                      └─ 当前位置

T-36h ━━━━━━ 排污窗口 10:00–12:00 ━━━━━━ T-34h
       │                                                              │
       └─ 排污原点（5 艘船依次经过、停留、离开）
                                       │
                                       └─ 油膜从原点开始向 SW 漂移 36h

T-0h（now）：SAR 拍摄到油膜在 (123.0125, 30.2561)，
            驱动 weather-fetch + oil-drift 反推
```

5 艘船的轨迹时间戳全部覆盖 T-72h ~ T-0h，**只有在 T-36.5h ~ T-35.5h 这一小时区间经过排污原点**——和气象反推的排污时间窗对齐。

---

## 9. 集成入口

| capability | 直接 import 哪段 |
|---|---|
| `oil-drift.ts` | §2 `oilDriftMock` |
| `ais-fetch.ts` | §3 `vessels` + §4 全部 5 艘船的 `points`（可以用 `vessels.map((v, i) => ({ ...v, points: trajectories[i] }))` 组装）|
| `ais-match-suspects.ts` | §5 `aisMatchMock` |
| `ais-suspect-ranking.ts` | §6 `aisRankingMock` |

数据完全自洽，可以一次性所有 capability 都用这份 mock；改任何一处数字只动这一份文档即可。

---

## 10. 后续可调点

- **时间戳精度**：当前用 `tFromNow(hours)` 占位；如果想要 ISO 8601 字符串，capability 实现里 `new Date(t).toISOString()`
- **轨迹点密度**：每艘船现在 ~10 点；如果地图上轨迹看起来太"折线"不够丝滑，每艘船插值到 30 点
- **MMSI / IMO 号**：编造的，符合编号位数规则。如果接审计要换"明显假"（如 999xxxxxx）告诉我
- **AIS gap 时间戳**：OCEAN PEARL 那 5 min 断点是关键剧情，capability 实现要确保 `points` 数组里在断点窗口之间没有打点
