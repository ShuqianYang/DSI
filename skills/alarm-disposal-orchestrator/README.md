# alarm-disposal-orchestrator — 研究与进展记录

> 本文件记录 2026-06-22 当天围绕 `alarm-disposal-orchestrator` skill 的研究、实现与下一步方向。`SKILL.md` 继续作为正式使用说明，本 README 作为工程备忘录。

---

## 今日已完成

### 1. Skill 核心链路跑通（端到端真实测试）
- 验证了从「用户自然语言/JSON 报警输入」→「weitong 后端」→「盲区补全」→「TrajRP 轨迹预测」→「资源调度」→「回显 dispatch plan」的完整链路。
- 在 `192.168.0.27` 上真实创建 suspect event（eventId=9），9 个接口全部命中，最终生成建议分配方案。
- 确认了 `/home`（便携设备后端 `192.168.0.33:5284`）超时不可达时的自动回退行为：自动切到 simulator 源（DB `patrol_resource` + Redis `realtime:patrol_resource:*`）。

### 2. 实现 A / B / B+ / C 四个快照/复用选项
- **A. 点-in-time snapshot 定位**：明确 skill 只输出某一时刻的静态处置建议，不在后台持续跟踪资源位置。
- **B. `--event-id` 复用**：支持对已有事件重新跑预测+调度，不创建重复事件。
- **B+. 取消旧分配**：复用 `--event-id` 时先 `POST /allocation/finish {status:"cancelled"}`，释放之前已分配资源，避免残留。
- **C. `--static-resources`**：允许直接传 `[{"id","type","lng","lat","speed"}]` 作为静态资源点，绕过 portable/simulator/DB。

### 3. 增加 simulator 数据源支持
- `orchestrate.py` 新增 `fetch_simulator_resources()`：
  - 目录来自 Postgres `patrol_resource`（id/type/speed/is_dispatched）。
  - 实时位置优先读 Redis `realtime:patrol_resource:{id}`，Redis 缺失时回退到 DB `patrol_resource_position` 最新一条。
  - 排除 `is_dispatched=true` 和没有位置的资源。
- 新增 `scripts/seed_positions.py`：不跑完整 `simulator.py`，直接按警点或边境线给所有 `patrol_resource` 写入 Redis 实时位置，便于测试。
- 新增 `--resource-source {portable,simulator}`，默认 portable 自动回退 simulator。

### 4. 消除 Windows 命令行 JSON 引号问题
- 给 `orchestrate.py` 增加三个文件入参：
  - `--alarm-file`
  - `--personnel-file`
  - `--static-resources-file`
- 文件内容与内联字符串等价，但**完全绕开 shell 引号转义**，避免之前 `Invalid alarm JSON: char 0` 的 4 回合失败。
- `SKILL.md` Workflow 步骤已更新为推荐文件式调用。

### 5. 研究 `situation.vue` / `resource_dispatch_service.py` / `qijingnan` 的代价图链路
**关键发现：**
- `situation.vue` 的资源调度 payload 里**没有高程、没有土地利用、没有道路网**，只传了 `resources_available / target_info / rules`。
- `situation.vue` 中 `generateCostMap()` 调 `/api/v1/analysis/passage_cost` 是**死代码**，从未被调用。
- 调度固定使用 `task_id = "cost_fixed_task_001"`，是一张**预烘焙的代价图**，不会按当前事件区域/资源类型重算。
- `qijingnan` 后端**有能力**做高程+土地+道路代价：
  - 输入：土地利用 TIF、AW3D30 高程 TIF、OSM 路网 shp、ROI bbox、object_type。
  - 输出：`cost_matrix.tif`。
  - 路径规划 `/api/v1/dispatch/intent_path_planning` 读这张 TIF 做 A*。
- 因此：高程分析**没进前端调度链**，通行代价也**不是真实重算**，只是复用旧图；`SchedulerGA` 中的 `terrain_zones` 只是 2D 矩形 slowdown，不是 DEM/坡度。

### 6. 解释 eventId=9 只有 2 个人员的原因
- 当时 `patrol_resource_position` = 0 行，Redis `realtime:patrol_resource:*` = 0 key（之前测试完清理掉了）。
- 25 个目录资源中 10 个 `is_dispatched=true` 被排除；剩余 15 个因无位置也被跳过。
- 所以方案里只有用户传入的 P_001/P_002。
- 这不是 DB 没数据，也不是 skill 绕开 DB，而是**实时位置数据为空**。

---

## 当前文件清单

```
skills/alarm-disposal-orchestrator/
├── SKILL.md                          # 正式技能说明（已更新 file 模式、snapshot 语义、reuse 规则）
├── scripts/
│   ├── orchestrate.py                # 核心编排脚本
│   └── seed_positions.py             # 给 Redis 写入测试位置的辅助脚本
└── README.md                         # 本文件
```

---

## 接下来建议的方向

### 方向 A：让 skill 真实可用（优先）
1. **给 `seed_positions.py` 加 `--reset-dispatch`**
   - 一键把所有 `patrol_resource.is_dispatched` 置回 `false`，清理历史测试残留。
2. **跑通 simulator 源的真实设备调度**
   - 用 `seed_positions.py` 给 25 个资源播种位置；
   - 用 `--resource-source simulator` 跑 `orchestrate.py`；
   - 确认方案中出现无人机/无人车，而不只是 P_001/P_002。

### 方向 B：接入真实高程/通行代价（中等工程量）
1. 在 `orchestrate.py` 里增加「代价图生成」前置步骤：
   - 根据事件区域 bbox + 资源类型调 `POST /analysis/passage_cost`；
   - 拿到新的 `task_id`；
   - 把新 `task_id` 传给 `dispatch/resource_allocation`。
2. 同步改 `situation.vue`：
   - 去掉写死的 `cost_fixed_task_001`；
   - 在调度前按 ROI 调 `generateCostMatrix`；
   - 把动态 `task_id` 传给 `dispatchResources`。
3. 风险：需要确认 `qijingnan` 服务上 44T/45T 图源是否覆盖当前新疆测试区域（87.15°E, 43.89°N 在 44T/45T 边界附近），否则 `select_tiles` 可能选不到图。

### 方向 C：提高单点报警体验（小改动）
- 当前单点报警会跳过 `trajectory_forecast`（需要 ≥2 点），但 dispatch 仍基于当前点工作。
- 可以考虑在单点场景下直接给 dispatch 一个短距虚拟目标点，避免 `prediction_candidates=[]` 的困惑。

### 方向 D：测试与 CI
- 把 `--alarm-file` / `--personnel-file` 模式作为推荐调用写入 SKILL.md 示例。
- 增加一条离线单元测试：只测 argparse 与 JSON 文件读取，不需要真实后端。
- 在服务器上跑 `--resource-source simulator` 真实测试并截图/记录。

---

## 遗留状态（需要清理）

- 服务器 `patrol_resource` 表有 **10 行 `is_dispatched=true`** 的测试残留。
- 服务器 suspect event 累计测试记录 eventId ≈ 4–9。
- Redis `realtime:patrol_resource:*` 已清理（`seed_positions.py --cleanup`）。

---

## 关键参考路径

| 组件 | 路径 |
|---|---|
| 前端调度入口 | `S:/Projects/weitong/ruoyi-ui/src/views/portal/situation.vue` |
| 后端调度服务 | `S:/Projects/weitong/资源分配/resource_dispatch_service.py` |
| 路径规划/代价图服务 | `S:/Projects/weitong/qijingnan/app.py` |
| 代价计算模块 | `S:/Projects/weitong/qijingnan/core/cost_modeling.py` |
| 意图路径规划 | `S:/Projects/weitong/qijingnan/core/path_planning_intent.py` |
| 模拟器参考 | `S:/Projects/weitong/patrol_simulator/simulator.py` |
| 资源 SQL | `S:/Projects/weitong/sql/patrol_resource.sql` |

---

*最后更新：2026-06-22*
