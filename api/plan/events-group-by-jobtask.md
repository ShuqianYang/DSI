# events 按 jobTask 聚合展示 — 信息包视图（UI 组织方案）

> **现状**：一个 query → 后端 executor 跑 N 个 capability → DB `events` 表写 N 条扁平 row（共享 `taskId = jobTaskId`）→ 前端 `useRightPanelData.ts` 拉 events 后**扁平列表**展示。
> **用户感受**：一个 query 的 7 个 subtask 看起来是 7 个零散事件卡片。
> **本计划**：纯前端 group by `taskId`，把同一个 jobTask 下的 events 聚合到一个"信息包卡片"，可展开查看每个 subtask 子条；**后端 schema / executor 逻辑零改**，每个 subtask 的 gisData / read / 镜头节奏全部保留。

---

## Goal

把"信息包"概念在前端可视化：

1. 一个 query → 一个可展开的"信息包卡片"
2. 卡片标题 = jobTask name（query 摘要）
3. 展开后看到 1..N 个 subtask 子条，按 timestamp asc 时序排列（先完成的在上）
4. 卡片头部显示总进度条（subTasks 完成数 / 总数）+ 整体状态徽章
5. 保留每个 subtask 的颗粒度：独立 gisData / 独立 read 状态 / 独立点击地图联动

---

## Architecture

```
DB（现状不动）:
  jobTasks (id, name, status, subTasks, agentTaskId, ...)
       ↑
       │ taskId (FK)
       │
  events (id, taskId → jobTasks.id, title, content, gisData, status, read, timestamp, ...)

后端（现状不动）:
  executor 启动 → 创建 jobTask → 跑 N 个 capability → N 次 db.insert(events) 共享同一 jobTaskId

前端改造点:
  src/lib/eventGrouping.ts (新增)  ← Phase 1
       │ groupEventsByTask(events, tasks)
       ▼
  EventList.tsx (改造)              ← Phase 2
       │ 外层 group 卡片
       │   └── 内层 events 子条
       ▼
  useRightPanelData.ts (轻改)        ← Phase 3
       │ events / tasks 都已经拉好；接入 SSE 实时进度刷新
```

---

## Ordered Phases

### Phase 1 — 数据结构组装（pure function）

**新增文件**：`src/lib/eventGrouping.ts`

```ts
import type { ApiEvent, ApiTask } from "@/lib/api";

export interface EventGroup {
  taskId: string | null;             // null = 未归属（兜底分组）
  task: ApiTask | null;              // 对应的 jobTask 数据；null = 未匹配到
  events: ApiEvent[];                // 该 task 下所有 events，已按 timestamp asc 排
  latestTimestamp: number;           // 用于 group 之间排序
}

export function groupEventsByTask(
  events: ApiEvent[],
  tasks: ApiTask[]
): EventGroup[] {
  const taskMap = new Map(tasks.map((t) => [t.id, t]));
  const groupMap = new Map<string, EventGroup>();

  for (const e of events) {
    const key = e.taskId ?? "_unattached";
    if (!groupMap.has(key)) {
      groupMap.set(key, {
        taskId: e.taskId ?? null,
        task: e.taskId ? taskMap.get(e.taskId) ?? null : null,
        events: [],
        latestTimestamp: 0,
      });
    }
    const g = groupMap.get(key)!;
    g.events.push(e);
    const t = typeof e.timestamp === "string" ? Date.parse(e.timestamp) : Number(e.timestamp);
    g.latestTimestamp = Math.max(g.latestTimestamp, t);
  }

  // group 内 events 按 timestamp asc 排（先完成的 subtask 在上）
  for (const g of groupMap.values()) {
    g.events.sort((a, b) => {
      const ta = typeof a.timestamp === "string" ? Date.parse(a.timestamp) : Number(a.timestamp);
      const tb = typeof b.timestamp === "string" ? Date.parse(b.timestamp) : Number(b.timestamp);
      return ta - tb;
    });
  }

  // group 之间按 latestTimestamp desc（最新 query 在上）
  return Array.from(groupMap.values()).sort((a, b) => b.latestTimestamp - a.latestTimestamp);
}
```

**验证**：单元测试覆盖：
- 5 events 共享 1 taskId → 输出 1 group，events 5 条
- 7 events 分属 2 taskId → 输出 2 groups
- taskId 为 null 的 events → 兜底"_unattached" group
- events 时间戳乱序 → group 内排好 asc

**工作量**：~50 行代码 + ~30 行测试。

---

### Phase 2 — EventList 组件改造

**改文件**：`src/components/right-panel/EventList.tsx`

当前结构（推测）：扁平 `events.map((e) => <EventCard key={e.id} event={e} />)`。

改造后：

```tsx
const groups = groupEventsByTask(events, tasks);

return (
  <div>
    {groups.map((g) => (
      <InfoPackCard key={g.taskId ?? "_unattached"} group={g} ... />
    ))}
  </div>
);
```

**新增子组件 `InfoPackCard`**（同文件内或拆出去）：

```
┌─────────────────────────────────────┐
│ ▼ 东海油污溯源研判               ⏱  │   ← 标题 + 折叠按钮 + 时间
│   进度 5/7 ▰▰▰▰▰▱▱   [running]   │   ← 进度条 + 状态徽章
├─────────────────────────────────────┤
│  ├─ subtask-1 区域标记完成      ✓ │
│  ├─ subtask-2 油膜识别完成      ✓ │
│  ├─ subtask-3 气象数据获取      ✓ │
│  ├─ subtask-4 油污漂移反推      ✓ │
│  └─ subtask-5 AIS 拉取中...     ◌ │   ← 进行中的最新一条
└─────────────────────────────────────┘
```

**折叠状态默认**：

- `task.status === 'running'` → 展开（用户正在看进行中的流程）
- `task.status` 其他（completed / partial / failed）→ 折叠（历史信息包，按需展开）

**子条样式**：复用现有 event 卡片设计但变小（左侧缩进 + 字体小一号 + 按钮组缩到 hover 可见）。

**工作量**：~100-150 行（含状态 + 样式）。

---

### Phase 3 — useRightPanelData 同步任务进度

**改文件**：`src/hooks/useRightPanelData.ts`

当前已经拉 `tasks`（jobTasks）+ `events` 两份数据。Phase 1 的 `groupEventsByTask` 是 pure function，可以在 useMemo 里调，避免每次渲染重算：

```ts
const groups = useMemo(() => groupEventsByTask(events, tasks), [events, tasks]);
```

把 `groups` 返回给消费方（EventList）。原有 `events / tasks` 也保留（其他地方可能用到）。

**SSE 实时进度**：当前 SSE 推 `step_update` / `progress` 消息已经更新 tasks 和 events state——Phase 1 的 groupEventsByTask 自动响应（useMemo 依赖 events/tasks 重算）。无需新增 SSE handler。

**工作量**：~10 行（仅在 hook 出口加 useMemo + group 计算）。

---

### Phase 4 — UI 视觉细节

| 子项 | 内容 |
|---|---|
| 卡片头布局 | 标题 + 状态徽章 + 子条数 + latestTimestamp 显示（"1 分钟前"）|
| 状态徽章配色 | running 蓝、completed 绿、partial 橙、failed 红，复用现有 status color tokens |
| 进度条 | subTasks 完成数 / 总数；视觉用细条 + 完成数字 |
| 折叠/展开动画 | CSS transition height（可选 framer-motion，但简单 css 足够）|
| 已读状态聚合 | events 全已读 → 卡片显示"已读"徽章；任一未读 → 卡片显示"新"红点 |
| "全部已读"操作 | 卡片右上角按钮：点击批量 mark all events as read（调 `updateEvent` 一遍） |
| 点击子条联动 | 完全复用现有 onClick → push activeGisDataList → 地图 flyTo + 划线，**零改** |

**工作量**：~50 行 CSS + ~30 行新交互逻辑。

---

### Phase 5 — 兼容性回归 & 端到端冒烟

| 检查 | 通过条件 |
|---|---|
| 油污溯源 7 subtask | 右侧只看到 1 个"信息包卡片"，展开后 7 个子条按 subtask 顺序显示 |
| 单 step 任务（如日报）| 右侧 1 个"信息包卡片"，展开后只有 1 个子条；视觉不突兀 |
| 多个并行 query | 同一会话用户发 3 个 query → 右侧 3 个"信息包卡片"按 latestTimestamp desc 排列 |
| SSE 实时增量 | 任务跑到 subtask-3 完成 → 信息包卡片进度条 3/7，子条 list 实时出现 3 条 |
| 历史回放 | 刷新页面 → 拉 events + tasks → 重新 group → 跟实时跑出来的视觉一致 |
| 点击联动 | 点击任一信息包内的子条 → activeGisDataList push → 地图镜头 + 划线生效 |
| `taskId` 为 null 的兜底 | 任意 event.taskId 为 null（理论上不应该有，但容错）→ 单独显示为"未归属"组 |
| jobTask 已删除的 events（taskId 引用失效）| group.task 为 null，UI 用 events[0].taskName 兜底标题 |
| `tsc --noEmit` | 0 新增错 |
| 性能（events 100+ 条）| useMemo 缓存 group 结果，重算成本 < 5ms |

---

## Validation 矩阵

| 项 | 命令 / 操作 | 通过条件 |
|---|---|---|
| 单元测试 | `pnpm test -- eventGrouping` | groupEventsByTask 测试 4 个场景全过 |
| TS 类型 | `npx tsc --noEmit -p tsconfig.json` | 0 新增错 |
| 实时演示 | 浏览器跑"排查漏油"快捷按钮 → 观察右侧 | 1 个信息包卡片渐进展开为 7 条子条 + 进度条 0→7/7 + 状态 running→completed |
| 老 capability 兼容 | 跑日报 query | 单 event 也走信息包卡片 |
| 多查询并存 | 跑两次不同 query | 两个信息包卡片，新 query 在上 |
| 点击联动 | 点击任一子条 | 地图 flyTo + region/entity 触发，不退化 |

---

## Open Questions / Risks

1. **"全部已读"语义** — 整个信息包已读是否要存到 `jobTasks.read` 字段？本期不做：用 derived state（所有子条已读 → 卡片视觉显示已读）。如果用户想"右侧整个数字徽章按信息包数算"再考虑加字段
2. **jobTask name 内容** — 当前 jobTask.name 可能是 capability 推断出的内部名（如"日报" / "东海油污溯源"），不是用户原始 query 全文。如果想用 query 全文做标题：(a) 加 jobTasks.query 字段（后端 1 行）；(b) 从 agentTaskId 反查 tasks 表的 query。本期 **暂用 jobTask.name**，等 UI 验证发现"标题不够 informative"再加
3. **折叠状态持久化** — 用户折叠一个信息包后刷新页面是否记忆？本期不做：每次刷新按 status running=展开 / 其他=折叠的默认策略
4. **新 query 卡片 scroll** — 用户发新 query → 新信息包出现最上 → 是否自动 scroll 到顶？本期默认 yes（简单的 useEffect scrollTop=0）
5. **mockData 兼容** — `mockData.ts` 里 `mockTaskEvents` 已无外部引用（page.tsx 早期清理过），新 group 逻辑不依赖任何 mock；零影响
6. **真"信息包"概念后续重构** — 如果未来想真做 DB 层 `info_packs` 表（grill Q1 的方案 c）：前端 group 逻辑可平滑替换为"按 packId group"，DB schema 升级影响面只在 hook 层
7. **后端 events.timestamp 类型** — 数据库存 `timestamp with timezone`，前端 API 序列化时是 ISO 字符串还是 number 取决于 api wrapper；group 函数已经做了 `Date.parse(string) || Number(number)` 双兼容，应当安全
8. **Phase 4 视觉细节属于 UX 调优** — 可以 Phase 1+2+3 跑通后视觉再迭代，不阻塞核心功能

---

## 执行顺序总结

| Phase | 文件 | 阻塞下一步？ | 工作量 |
|---|---|---|---|
| 1 | `src/lib/eventGrouping.ts`（新增） + 单测 | 是（前端依赖类型） | 半天 |
| 2 | `src/components/right-panel/EventList.tsx`（改造）+ 内部 `InfoPackCard` 子组件 | 是 | 1 天 |
| 3 | `src/hooks/useRightPanelData.ts`（useMemo 接 groupEventsByTask）| 否（独立小调）| 半天 |
| 4 | 视觉细节 + 已读批量 + 折叠/展开动画 | 否 | 半-1 天 |
| 5 | 端到端冒烟 + 兼容回归 | — | 半天 |

**总工作量**：**2-3 天**（纯前端，零后端动作）。

每完成一步独立可验证，跑通后再开下一步——和之前 `wind-particle-layer.md` / `oil-spill-mock-data.md` 同节奏。
