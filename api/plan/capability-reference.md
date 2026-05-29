# Capability 参考手册

本文档汇总系统当前可用的 12 个 capability，按场景归类，并列出每个 capability 执行所需的参数。

---

## 一、空间基准

### region-mark
- **覆盖场景**：火灾、漏油、地震、洪涝
- **功能**：地图区域标记工具。用户指定区域后，系统在 Cesium 地图上框选目标范围，返回区域边界框、中心坐标、cameraView，作为后续卫星查询、灾害识别、AIS 查询、新闻匹配的空间输入。
- **所需参数**：

  | 参数 | 必填 | 说明 |
  |------|------|------|
  | `region` | 否 | 区域预设名称，默认"中国东海" |
  | `query` | 否 | 回退搜索关键词 |

  **预设区域**：中国东海、东海、柳州、柳州市、柳南区、广西柳州市柳南区、石门、石门县、湖南石门、湖南石门县

---

## 二、遥感影像

### satellite
- **覆盖场景**：火灾、漏油、地震、洪涝
- **功能**：遥感影像获取工具。根据任务类型请求对应影像：火灾场景提报火情监测需求；漏油场景执行 SAR 油膜检测；地震与洪涝场景支持 `phase=pre` / `phase=post`，分别获取灾前历史影像与灾后应急影像。真实影像获取失败时回退 mock 数据。
- **所需参数**：

  | 参数 | 必填 | 说明 |
  |------|------|------|
  | `query` | 否 | 查询字符串，默认"未指定查询" |
  | `fireScenario` | 否 | `true` 触发火灾场景 |
  | `earthquakeScenario` | 否 | `true` 触发地震场景 |
  | `floodScenario` | 否 | `true` 触发洪涝场景 |
  | `phase` | 否 | `"pre"` 或 `"post"`，与地震/洪涝场景配合 |
  | `region` | 否 | 区域名称 |
  | `bbox` | 否 | 边界框 `[west, south, east, north]` |
  | `detectOilSpill` | 否 | `true` 触发 SAR 油膜检测 |

---

## 三、灾害识别

### fire
- **覆盖场景**：火灾
- **功能**：火情识别与图层生成工具。接收卫星影像或遥感数据后，识别火灾中心点、烧毁区域多边形，并生成前端可渲染的火情 overlay、mask 图层和 GIS 区域数据。
- **所需参数**：

  | 参数 | 必填 | 说明 |
  |------|------|------|
  | `region` | 否 | 区域名称，默认"Kensai" |
  | `query` | 否 | 查询字符串 |
  | `bbox` | 否 | 边界框 `[west, south, east, north]` |
  | `fromScenario` | 否 | `true` 表示来自 scenario 触发 |

### oil-drift
- **覆盖场景**：漏油
- **功能**：油污漂移分析工具。接收 SAR 检测出的油膜中心区域，结合风场、洋流等气象参数，反推可能排污原点，生成油污漂移路径、扩散轨迹和可视化结果。
- **所需参数**：无。数据全部来自 `context`（satellite 返回的油膜中心坐标 + weather-fetch 返回的气象数据）。

---

## 四、AIS 船舶

### ais-fetch
- **覆盖场景**：漏油
- **功能**：船舶 AIS 轨迹获取工具。根据 region-mark 给出的海域范围，拉取近 72 小时内相关船舶轨迹数据。目前为 mock 版，返回候选船舶列表。
- **所需参数**：

  | 参数 | 必填 | 说明 |
  |------|------|------|
  | `region` | 否 | 区域名称，默认"中国东海" |

### ais-match-suspects
- **覆盖场景**：漏油
- **功能**：嫌疑船匹配工具。将油污嫌疑船名单与 AIS 轨迹进行匹配，检查船舶是否经过疑似排污原点、油膜漂移路径或异常区域。
- **所需参数**：无。使用 mock 数据直接处理。

### ais-suspect-ranking
- **覆盖场景**：漏油
- **功能**：嫌疑船排序工具。根据 AIS 轨迹、时间接近度、空间接近度、行为异常程度，对候选船舶进行排污概率排序，输出 ranked list。
- **所需参数**：无。使用 mock 数据直接处理。

---

## 五、海域态势

### maritime
- **覆盖场景**：火灾、漏油
- **功能**：海域态势与交通风险分析工具。拉取或整合区域附近 AIS 船舶与 ADS 飞机数据，识别异常航行、靠近灾区、疑似暗船、危险接近、救援通道干扰等风险。漏油场景中可承接 ais-fetch / ais-match-suspects 的结果，做更高层的海域态势判断。
- **所需参数**：

  | 参数 | 必填 | 说明 |
  |------|------|------|
  | `region` | 否 | 海域名称，匹配 24 个已知海域，默认"南海" |
  | `query` | 否 | 分析查询，未传时自动生成 |

### weather-fetch
- **覆盖场景**：火灾、漏油
- **功能**：气象风场获取工具。返回目标区域的 10×10 网格风场数据，包含 u/v 分量，用于驱动前端风场粒子层。火灾场景可用于判断烟羽、火势扩散方向；漏油场景可作为 oil-drift 的输入之一。
- **所需参数**：

  | 参数 | 必填 | 说明 |
  |------|------|------|
  | `region` | 否 | 区域标签，默认"东海油膜片区" |

---

## 六、灾后评估

### earthquake-evaluation
- **覆盖场景**：地震
- **功能**：地震灾后评估工具。加载 `earthquake.geojson` 损毁数据，结合震前/震后影像生成对比结果，输出建筑或区域损毁多边形、震中标记、灾害统计，并配置前端分屏对比模式。
- **所需参数**：

  | 参数 | 必填 | 说明 |
  |------|------|------|
  | `region` | 否 | 区域名称，默认"广西柳州市柳南区" |
  | `query` | 否 | 查询字符串 |

- **Context 依赖**：需从 context 读取 `responseType` 为 `"pre_earthquake"` 和 `"post_earthquake"` 的 satellite 结果（含 imageOverlays）。

### flood-evaluation
- **覆盖场景**：洪涝
- **功能**：洪涝灾后评估工具。加载 `flood.geojson` 淹没数据，结合洪水前后影像生成淹没区域多边形、灾情统计结果（淹没面积、损毁桥梁、中断道路），并配置前端分屏对比模式。
- **所需参数**：

  | 参数 | 必填 | 说明 |
  |------|------|------|
  | `region` | 否 | 区域名称，默认"湖南石门县" |
  | `query` | 否 | 查询字符串 |

- **Context 依赖**：需从 context 读取 `responseType` 为 `"pre_flood"` 和 `"post_flood"` 的 satellite 结果（含 imageOverlays）。

---

## 七、信息查询

### news
- **覆盖场景**：火灾、漏油、地震、洪涝
- **功能**：新闻与权威通报获取工具。根据灾种和区域返回相关新闻、通报或结构化事件信息。目前多为硬编码 mock 数据。火灾可返回含 GIS 区域的新闻，地震可返回震级等结构化数据，漏油和洪涝返回对应事件报道。
- **所需参数**：

  | 参数 | 必填 | 说明 |
  |------|------|------|
  | `query` | 否 | 搜索关键词，默认"未指定查询" |
  | `region` | 否 | 区域过滤 |
  | `timeRange` | 否 | 时间范围，默认"7d" |
  | `fireScenario` | 否 | `true` 返回火灾 mock 新闻 |
  | `earthquakeScenario` | 否 | `true` 返回地震权威通报 |
  | `floodScenario` | 否 | `true` 返回洪涝权威通报 |

---

## 场景 → Capability 映射速查

| 场景 | 涉及的 Capability |
|------|------------------|
| 火灾 | region-mark → satellite → fire → weather-fetch → news → maritime |
| 漏油 | region-mark → satellite → oil-drift → ais-fetch → ais-match-suspects → ais-suspect-ranking → maritime → weather-fetch → news |
| 地震 | region-mark → satellite(pre) → news → satellite(post) → earthquake-evaluation |
| 洪涝 | region-mark → satellite(pre) → news → satellite(post) → flood-evaluation |

---

## 参数速查总表

| Capability | 必填参数 | 可选参数 | 外部依赖 |
|------------|---------|---------|---------|
| region-mark | — | `region`, `query` | — |
| satellite | — | `query`, `fireScenario`, `earthquakeScenario`, `floodScenario`, `phase`, `region`, `bbox`, `detectOilSpill` | — |
| fire | — | `region`, `query`, `bbox`, `fromScenario` | — |
| oil-drift | — | — | context: satellite 油膜中心 + weather-fetch 气象 |
| ais-fetch | — | `region` | — |
| ais-match-suspects | — | — | mock 数据 |
| ais-suspect-ranking | — | — | mock 数据 |
| maritime | — | `region`, `query` | — |
| weather-fetch | — | `region` | — |
| earthquake-evaluation | — | `region`, `query` | context: satellite pre/post 影像 |
| flood-evaluation | — | `region`, `query` | context: satellite pre/post 影像 |
| news | — | `query`, `region`, `timeRange`, `fireScenario`, `earthquakeScenario`, `floodScenario` | — |
