# 任务执行自动收 / 展开 ChatPanel + 进度弹窗

> 触发场景：用户在左侧 ChatPanel 提问 → 后端启动 7-step 流程 →
>   **任务开始时**：自动 force `setShowChat(false)` + `setSelectedTask(task)` —— 收起聊天框 + 弹出任务进度窗
>   **任务全部步骤结束**：
>     - 成功 → 自动 force `setShowChat(true)` + `setSelectedTask(null)` —— 展开聊天框 + 关闭进度窗
>     - 失败 → `setShowChat(true)` + selectedTask 不动 —— 展开聊天框（让用户看错误消息），进度窗保留（让用户看失败 subtask 细节）

---

## Goal

让用户在长流程任务（如东海油污 7 step ≈ 35s）期间，**自动把视线从"我刚问什么"切到"任务进度"**，结束时再自动切回 chat 看结果回复。零额外用户操作，依赖 `showChat` + `selectedTask` 两个已有 state 双向联动 task 生命周期。

---

## Architecture

```
ChatPanel (用户输入 → useTaskChat.sendMessage)
  ↓ createAgentTask
  ↓ onTaskCreate(task, steps, gisData?)  ← 现有 callback
       ↓
       page.tsx handleTaskCreate (现行实现：仅 setTasks(prev => [...]))
       ↓
       NEW：force setShowChat(false) + setSelectedTask(task)
       ↓
任务 SSE 流执行（subtask 1..N）
  ↓
useTaskChat SSE handler 监测 isFinished (line 348)
  ↓
NEW：调用 onTaskFinished?.(taskId, status)
       ↓
       page.tsx handleTaskFinished
       ↓
       完成 → setShowChat(true) + setSelectedTask(null)（id 比对避免清掉其他 task）
       失败 → setShowChat(true) 不动 selectedTask
```

---

## Ordered Phases

### Phase 1 — useTaskChat 新增 onTaskFinished callback

**文件**：`src/hooks/useTaskChat.ts`

**改动**：

1. `UseTaskChatOptions` 接口（line 9-13）加：
   ```ts
   onTaskFinished?: (taskId: string, status: 'completed' | 'failed') => void;
   ```

2. `useTaskChat` 函数签名（line 26）解构出 `onTaskFinished`

3. SSE handler 的 `isFinished` 分支（line 348+）末尾调用：
   ```ts
   if (isFinished) {
     // ...原有 messages / clearPlanAnimation / SSE close 逻辑...
     const finalStatus = data.type === 'completed' ? 'completed' : 'failed';
     onTaskFinished?.(taskId, finalStatus);
     // ...原有 getTask 兜底...
   }
   ```

**工作量**：~5 行；纯 callback 透传，不改业务逻辑。

---

### Phase 2 — ChatPanel 透传 onTaskFinished

**文件**：`src/components/ChatPanel.tsx`

**改动**：

1. ChatPanel props interface 加 `onTaskFinished`
2. 解构 props 时拿出 `onTaskFinished`
3. 透传给 `useTaskChat({ ..., onTaskFinished })`

**工作量**：~2-3 行；纯 prop 透传。

---

### Phase 3 — page.tsx handleTaskCreate 增加 force toggle

**文件**：`src/app/page.tsx`（line 392 `handleTaskCreate`）

**改动**：在现有 `setTasks(prev => [...])` 后追加：

```ts
const handleTaskCreate = useCallback((task: Task, steps: ThinkingStep[], gisData?: GisData) => {
  // ... 原有 setTasks 逻辑 ...

  // 任务开始：force 收起 ChatPanel + 弹出进度窗
  setShowChat(false);
  setSelectedTask(task);
}, []);
```

**工作量**：2 行。

---

### Phase 4 — page.tsx 新增 handleTaskFinished

**文件**：`src/app/page.tsx`

**改动**：

```ts
const handleTaskFinished = useCallback(
  (taskId: string, status: 'completed' | 'failed') => {
    // 都展开 chat
    setShowChat(true);

    // 成功时关闭进度窗（且只在显示的是这个 task 时关，避免清掉用户已切换看的其他 task）
    if (status === 'completed') {
      setSelectedTask((prev) => (prev?.id === taskId ? null : prev));
    }
    // 失败时进度窗保留，让用户看 failed subtask 细节
  },
  []
);
```

**工作量**：~10 行（含注释）。

---

### Phase 5 — page.tsx ChatPanel JSX 传 onTaskFinished

**文件**：`src/app/page.tsx`（line 538 附近 `<ChatPanel>`）

**改动**：

```diff
  <ChatPanel
    onSendMessage={handleSendMessage}
    onGisDataRequest={(gisData) => { ... }}
    onTaskCreate={handleTaskCreate}
+   onTaskFinished={handleTaskFinished}
    onFireDetected={handleFireDetected}
    onGisOperation={handleGisOperation}
  />
```

**工作量**：1 行。

---

## Validation

| 检查 | 通过条件 |
|---|---|
| **TS 类型** | `tsc --noEmit` 0 新错（baseline 3 不变） |
| **任务创建瞬间** | 点"排查漏油"快捷按钮 → ChatPanel 立刻收起（w-96 → w-0） + 地图左上角弹出 TaskSubTaskPanel | 
| **subtask 进行中** | 进度窗里 subTasks 状态逐步更新；ChatPanel 保持收起 |
| **任务成功结束** | SSE `completed` → ChatPanel 自动展开 + 进度窗关闭 |
| **任务失败结束** | SSE `failed` → ChatPanel 自动展开 + 进度窗保留（含 failed subtask 标识）|
| **多 task 并发** | 用户发 query1 → 进度窗显示 query1 task → 用户中途又发 query2 → 进度窗切到 query2 task；query1 完成时 selectedTask 仍是 query2，selectedTask 不会被清 |
| **用户已切换看其他 task** | task A 跑完时如果 selectedTask 已经被用户手动切到 task B，handleTaskFinished 不会清 selectedTask |
| **回归：手动 toggle 仍可用** | 用户在任务期间手动点击右侧 ChevronLeft/Right 按钮收起/展开 chat 仍正常 |
| **回归：点击其他 task 卡片** | 任务进行中用户点击右侧 TaskSection 另一个 task → selectedTask 切换；当前 task 完成时不影响 |

---

## Open Questions / Risks

1. **任务期间无法看 chat** — 35s 流程，期间 chat 收起、用户看不到自己刚问的 query 文字。
   **应对**：本期不做；如果体验差，下次在 TaskSubTaskPanel 加一行 "原始查询：xxx"（需要把 query 字符串透传到 task 对象或单独 state）

2. **失败时 chat 自动展开** — chat 突然出现可能挡地图视野；mobile 端尤其明显。
   **应对**：可接受；用户主动收起 chat 一次即可

3. **订阅任务自动触发** — 如果 subscription 服务 cron 触发的 task 也走 ChatPanel→handleTaskCreate 路径，自动 toggle UI 会让用户在不知情时被打扰。
   **现状**：需要确认 subscription 触发链路是否复用 ChatPanel 的 onTaskCreate。如果是，应当在 handleTaskCreate 内加判断（仅 user-initiated task 才 toggle）；如果不是，无影响

4. **task 对象的 id 稳定性** — handleTaskCreate 传进来的 task.id 是 ChatPanel 自己生成的临时 id，还是后端返回的真实 taskId？handleTaskFinished 拿到的是后端 taskId（SSE 推送）。如果两者不一致，"id 比对"逻辑失效，selectedTask 永远不会被清。
   **应对**：Phase 1 实施时 grep 确认 ChatPanel `handleTaskCreate` 调用时 task.id 来源；如果不一致需要在 ChatPanel 等到 SSE 拿到真 taskId 后再 onTaskCreate

5. **第一次 mount 的 setShowChat(false)** — 用户登录后第一次未提问就先有"展开的 ChatPanel"，handleTaskCreate 触发前不会动。OK

6. **动画时序冲突** — chat 收起 300ms transition + 进度窗淡入；两个动画同时触发可能视觉混乱。
   **应对**：先 `setShowChat(false)`，下一帧再 `setSelectedTask(task)`（用 `requestAnimationFrame` 或 `setTimeout 0`）。Phase 3 可以默认两个 set 同步触发，如果视觉不好再加延迟

7. **page.tsx 已有 useEffect[gisData] 等其他副作用** — 新增 setShowChat / setSelectedTask 是 setState 调用，不会跟其他 effect 冲突；React 18 batching 自动合并两个 setState 到同一 commit

---

## 执行顺序总结

| Phase | 文件 | 阻塞下一 phase？ |
|---|---|---|
| 1 | `src/hooks/useTaskChat.ts` | 是（callback 必须先定义）|
| 2 | `src/components/ChatPanel.tsx` | 是（透传必须先有）|
| 3 | `src/app/page.tsx` `handleTaskCreate` | 否（独立）|
| 4 | `src/app/page.tsx` `handleTaskFinished` | 否 |
| 5 | `src/app/page.tsx` ChatPanel JSX 传 prop | 是（其他 phase 完成后接） |

**总工作量**：~20 行 / 3 文件 / 预计 30 分钟。

每 Phase 独立可验证 ts 通过；最终视觉验证需要跑完整一次"排查漏油"流程，观察任务开始 / 结束时 chat + 弹窗的自动切换。
