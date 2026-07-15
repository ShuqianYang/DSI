# 报警-调度流程：预测点与路径的“快照”行为分析

> 分析对象：
> - 流程图：`s:\Projects\projects_new\api\docs\alarm-to-dispatch-automatic-flow.mmd`
> - 前端代码：`s:\Projects\weitong\ruoyi-ui\src\views\portal\situation.vue`
> - 模拟器代码：`s:\Projects\weitong\patrol_simulator\simulator.py`

## 结论

1. **处置规划结果生成后，用户点击“资源调度”派遣无人设备时，目标点仍使用之前生成的预测候选点，没有根据嫌疑人最新真实位置重新计算预测点。**
2. **调度路径也是快照。** 无人设备被派遣后，模拟器沿规划阶段写入的 `path_waypoints` 移动；前端只是重画路径起点/剩余段，不会根据设备实时位置重新调用路径规划。

---

## 证据一：派遣时未重新预测嫌疑人位置

### 1. 手动调度入口只消费旧候选点

`situation.vue` 中“资源调度”按钮绑定的是 `runDispatch`：

```vue
<!-- situation.vue:184 -->
<el-button type="warning" size="mini" :loading="isDispatching" :disabled="!predictionCandidates.length" @click="runDispatch">
  {{ isDispatching ? '调度中...' : '资源调度' }}
</el-button>
```

`runDispatch` 的逻辑（`situation.vue:1490-1592`）:

```js
// situation.vue:1492
if (!this.predictionCandidates || this.predictionCandidates.length === 0) {
  this.$message({ message: '当前无轨迹预测结果，请先进行轨迹预测', ... })
  return
}

// situation.vue:1516
const selected = this.predictionCandidates.find(c => c.candidate_id === this.selectedCandidateId)
  || this.predictionCandidates.reduce((a, b) => b.probability > a.probability ? b : a)

// situation.vue:1538
const predictedPos = { lng: selected.x, lat: selected.y, t: tPred }
const trajectory = [currentPos, predictedPos]

// situation.vue:1566
const result = await dispatchResources(payload)
```

要点：
- 调度的前置条件是 `predictionCandidates.length > 0`，即必须存在**之前**预测的结果。
- `predictedPos` 直接取自 `selected.x / selected.y`，也就是 `predictPath` 返回的候选点坐标。
- 整个 `runDispatch` **没有再次调用 `predictPath` 或 `predictTrajectoryForCurrentEvent`**。

### 2. 预测候选点只在固定周期生成

`predictionCandidates` 由 `predictTrajectoryForCurrentEvent`（`situation.vue:2477-2516`）写入：

```js
// situation.vue:2500
const lastPoint = traj[traj.length - 1]
this._currentSuspectPos = { lng: lastPoint.lng, lat: lastPoint.lat }

// situation.vue:2511
await this.predictTrajectory(historyTrack)
```

`predictTrajectory` 内部调用 `predictPath`（`situation.vue:2724`）并把返回的 `candidate_points` 存到 `this.predictionCandidates`（`situation.vue:2733`）。

自动循环 `startPredictionLoop`（`situation.vue:2381-2403`）只是每隔 `autoDispatchIntervalSec` 秒（默认 200 秒）重新预测一次，**与“用户点击派遣”动作无关**。

因此，从用户点击“资源调度”到后端生成 allocation，目标预测点都是预测周期里留下来的旧点，而不是嫌疑人当前真实位置重新计算出来的。

---

## 证据二：调度路径是快照，不随无人设备位置重规划

### 1. 模拟器：只认 Redis 里的 `path_waypoints`

`simulator.py` 的 `DispatchedResourceState` 被设计为“沿 path_waypoints 路径点序列逐段移动”：

```python
# simulator.py:438
class DispatchedResourceState:
    """被调度资源的移动状态：沿 path_waypoints 路径点序列逐段移动"""

# simulator.py:449-460
raw_wp = alloc.get("path_waypoints")
if isinstance(raw_wp, list) and len(raw_wp) >= 2:
    self.waypoints = []
    for p in raw_wp:
        if isinstance(p, dict) and "lng" in p and "lat" in p:
            self.waypoints.append((float(p["lng"]), float(p["lat"])))
    if len(self.waypoints) < 2:
        self.waypoints = [(self.target_lng, self.target_lat)]
else:
    self.waypoints = [(self.target_lng, self.target_lat)]
```

主循环中，只有两种情形会新建 `DispatchedResourceState`（`simulator.py:862-904`）：

```python
# simulator.py:884-888
if existing is None:
    start_lng = rs.lng if rs else alloc["target_lng"]
    start_lat = rs.lat if rs else alloc["target_lat"]
    ds = DispatchedResourceState(rid, start_lng, start_lat, alloc, speed=res_speed)
    dispatched_states[rid] = ds

# simulator.py:891-899
elif existing.alloc_id != alloc.get("alloc_id"):
    target_dist = dist_meters((existing.target_lng, existing.target_lat), (alloc["target_lng"], alloc["target_lat"]))
    if target_dist > 5:
        start_lng = existing.lng
        start_lat = existing.lat
        ds = DispatchedResourceState(rid, start_lng, start_lat, alloc, speed=res_speed)
        dispatched_states[rid] = ds
```

要点：
- 资源刚被调度时，按当时位置作为起点，沿 `path_waypoints` 移动。
- 只有在后端写入**新的 allocation（alloc_id 变化）且目标点变化超过 5 米**时，才会从设备当前位置重新生成一条路径。
-  otherwise，模拟器继续走原来的 waypoints，不会根据设备实时位置重新规划。

### 2. 前端：只重画线，不重新规划

`situation.vue` 的 `_drawAllocationFromDB`（`situation.vue:1619-1723`）从 Redis 读取 active allocation 后：

```js
// situation.vue:1656-1658
if (state) {
  state.dispatchTarget = target
  state.fullWaypoints = Array.isArray(waypoints) ? waypoints : null
}

// situation.vue:1663-1671
const curPos = { lat: state.lat, lng: state.lng }
const remaining = this._getRemainingWaypoints(waypoints, curPos)
latlngs = [[curPos.lat, curPos.lng], ...remaining.map(p => [p.lat, p.lng])]
```

`_getRemainingWaypoints`（`situation.vue:1726-1743`）只是找到最近路径点并截取后面的点。`refreshDispatchLineStartPoint`（`situation.vue:1024-1033`）和 `recomputeDispatchLine`（`situation.vue:1036-1052`）也只是把线的起点拉到资源当前位置。

这些操作**都没有调用路径规划接口**，waypoints 始终来自 Redis 中的那份 `path_waypoints`。

---

## 补充：预测对象、自动循环时间细节与调度触发时机

### 1. 预测对象：嫌疑人（suspect）轨迹

`situation.vue` 中的轨迹预测只针对当前选中的**嫌疑人事件**：

```js
// situation.vue:2478-2482
async predictTrajectoryForCurrentEvent() {
  if (!this.currentEventId) return
  try {
    const res = await getSuspectEvent(this.currentEventId, 60)
    ...
```

`currentEventId` 来自左侧事件列表中选中事件的 `event.id`（`situation.vue:1445`）。拉取的轨迹点随后被重组成 `historyTrack` 传给 `predictPath`：

```js
// situation.vue:2503-2508
const historyTrack = traj.map((p, i) => ({
  lng: p.lng,
  lat: p.lat,
  timestamp: i * 10.0,
  speed: 1.5
}))
```

最终 `pathPlanning.js` 里的 `predictPath` 把它转成 API-04 请求体：

```js
// pathPlanning.js:72-76
const historical_trajectory = historyTrack.map((point, index) => ({
  x: point.lng,
  y: point.lat,
  timestamp: point.timestamp || index * 10.0,
  speed: point.speed || 1.0
}))
```

请求地址：

```js
// pathPlanning.js:105
apiClient.post('/trajrp/api/v1/prediction/trajectory_forecast', requestData)
```

所以：
- 预测对象是**嫌疑人**；
- 虽然请求体里有 `timestamp`，但当前传入的是前端生成的相对时间戳 `0, 10, 20, 30...`，不是后端原始 `recordTime`。

### 2. 自动预测循环的时间细节

预测循环由 `startPredictionLoop()` 控制（`situation.vue:2381-2403`）：

```js
// situation.vue:2381-2403
startPredictionLoop() {
  this.stopPredictionInterval()
  if (this.isPredicting) return

  const getInterval = () => {
    const v = Math.round(Number(this.autoDispatchIntervalSec))
    return Number.isFinite(v) && v > 0 ? v : 200
  }
  this.isPredicting = true
  this.predictTrajectoryForCurrentEvent().finally(() => { this.isPredicting = false })
  this.predictionCountdown = getInterval()
  this._countdownTimer = setInterval(() => {
    this.predictionCountdown--
    if (this.predictionCountdown <= 0) {
      this.predictionCountdown = getInterval()
      if (this.isPredicting) return
      this.isPredicting = true
      this.predictTrajectoryForCurrentEvent().finally(() => { this.isPredicting = false })
    }
  }, 1000)
}
```

默认间隔来自 `autoDispatchIntervalSec`：

```js
// situation.vue:384-391
autoDispatchIntervalSec: (() => {
  try {
    const v = Math.round(Number(localStorage.getItem('situation_auto_dispatch_interval_sec')))
    return Number.isFinite(v) && v > 0 ? v : 200
  } catch (e) {
    return 200
  }
})()
```

模型配置里也写死了默认 200 秒：

```js
// situation.vue:406
auto_dispatch_interval_sec: 200
```

循环行为可总结为：

```text
选中非 resolved 事件 -> 立即预测一次 -> 倒计时 200 秒 -> 再次预测 -> 循环
```

手动点击“轨迹预测”按钮（`runPrediction`，`situation.vue:1478-1487`）会立即预测，并把倒计时重置为当前间隔值：

```js
// situation.vue:1481
this.predictionCountdown = Math.round(Number(this.autoDispatchIntervalSec)) || 200
```

### 3. 什么时候会“重新触发调度”（调用 API-07）

当前主流程里，**只有用户手动点击“资源调度”按钮才会触发调度（API-07）**。

- `predictTrajectoryForCurrentEvent` 末尾的注释明确说明自动调度已被移除：

  ```js
  // situation.vue:2512
  // 移除预测完成后的自动调度逻辑，改为仅手动触发
  ```

- 手动调度的入口是 `runDispatch`（`situation.vue:1490-1592`），内部调用：

  ```js
  // situation.vue:1566
  const result = await dispatchResources(payload)
  ```

- 代码里确实还有一段“嫌疑人移动后自动预测+调度”的逻辑（`moveSuspectToNextPoint` -> `predictAndDispatch` -> `scheduleResources`），但它没有被启用：
  - `startSuspectMovement()`（`situation.vue:2554`）只有定义， nowhere 被调用；
  - 因此 `moveSuspectToNextPoint()` 里的 `this.predictAndDispatch()`（`situation.vue:2648`）永远不会执行。

- 模拟器侧虽然会在后端写入**新的 allocation（`alloc_id` 变化且目标点变化 > 5 米）**时重新生成路径，但这需要后端主动重新触发调度，前端当前不会主动发起。

---

## 影响与风险

| 风险点 | 说明 |
|---|---|
| 目标点漂移 | 嫌疑人在预测后到派遣前可能已经移动，调度目标仍是旧预测点，可能导致拦截失败。 |
| 路径过时 | 无人设备出发点与规划时相比已变化，但路径未重规划，可能导致 ETA 不准或走不必要路线。 |
| 缺少闭环 | 流程图 note 已写明路径规划“未实时感知动态障碍物；需外部循环重触发才能更新”，但代码里没有这样的外部循环。 |

---

## 改进建议（如需修正）

1. **派遣前强制刷新预测**：在 `runDispatch` 中先调用 `predictTrajectoryForCurrentEvent()`，用最新历史轨迹重新生成 `predictionCandidates`，再取候选点作为 `predictedPos`。
2. **持续重规划路径**：
   - 后端：在无人设备移动过程中，定时根据设备最新位置与嫌疑人最新位置重新调用路径规划接口，写入新的 `active_allocation`。
   - 模拟器/前端：检测到 `alloc_id` 变化或目标点变化超过阈值后，自动切换到新路径。
