# 前端组件重构计划：ChatPanel & RightPanel 逻辑/UI 解耦

> 创建时间: 2026-04-27
> 关联分析: [sse-frontend-interaction-issues.md](./sse-frontend-interaction-issues.md)
> 目标文件:
> - `src/components/ChatPanel.tsx` (1052 行)
> - `src/components/RightPanel.tsx` (862 行)

---

## 总体设计原则

| 原则 | 说明 |
|------|------|
| **职责分离** | 业务逻辑进 Hook，数据转换进 utils，渲染进组件 |
| **文件粒度假定** | 单文件 ≤ 250 行，超过则拆分 |
| **样式与逻辑解耦** | 样式映射函数抽离，UI 改样式不碰业务文件 |
| **数据流单向化** | API → Hook → 组件，消除组件内重复 state 映射 |

---

## 第一阶段：ChatPanel.tsx 拆分

### 目标文件结构

```
src/components/chat/
├── ChatPanel.tsx           # 主组件：纯渲染 + 布局 (~200行)
├── ChatInput.tsx           # 输入区域子组件
├── ChatMessage.tsx         # 单条消息渲染（含思考过程折叠）
├── ChatHistory.tsx         # 历史对话侧边栏
├── ThinkingSteps.tsx       # 思考步骤列表
└── MarkdownContent.tsx     # Markdown 渲染（从 ChatPanel 提取）

src/hooks/
└── useTaskChat.ts          # ChatPanel 业务逻辑 Hook (~200行)

src/lib/
├── taskResultFormatter.ts  # formatTaskResult 提取
└── taskMock.ts             # mockThinkingResponses + getMockResponse 提取
```

### 1.1 提取 `useTaskChat` Hook

**职责**：封装 SSE 连接、消息状态管理、任务创建、动画控制。

```ts
// src/hooks/useTaskChat.ts
export function useTaskChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // SSE 连接管理（合并 ChatPanel + RightPanel 的连接）
  const sseRef = useRef<Map<string, EventSource>>(new Map());

  // 动画定时器
  const timersRef = useRef<Map<string, NodeJS.Timeout[]>>(new Map());

  // 核心方法
  const sendMessage = async (input: string) => { ... };
  const connectSse = (taskId: string) => { ... };
  const disconnectSse = (taskId: string) => { ... };
  const deleteMessage = (id: string) => { ... };

  // 清理
  useEffect(() => {
    return () => {
      sseRef.current.forEach((es) => es.close());
      timersRef.current.forEach((ts) => ts.forEach(clearTimeout));
    };
  }, []);

  return { messages, isLoading, sendMessage, deleteMessage, ... };
}
```

**关键改动**：
- `handleSseUpdate` 的 230 行状态机收进 Hook，组件只接收 `messages` 数组
- `animatePlanSteps` 的动画逻辑封装在 Hook 内，组件无感知
- `sseConnections` / `stepAnimationTimers` / `planAnimationState` / `delayedEvents` 四个 ref 合并管理

### 1.2 提取 `taskResultFormatter.ts`

**职责**：后端 result → Markdown 字符串，按 actionType 分发。

```ts
// src/lib/taskResultFormatter.ts
type Formatter = (result: Record<string, unknown>) => string;

const formatters: Record<string, Formatter> = {
  maritime: (r) => { /* 海域态势 */ },
  daily_report: (r) => { /* 日报 */ },
  satellite: (r) => { /* 天基数据 */ },
};

export function formatTaskResult(result: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [actionId, actionResult] of Object.entries(result)) {
    const r = actionResult as Record<string, unknown>;
    const type = detectActionType(r); // 自动识别类型
    const formatter = formatters[type] || formatters.generic;
    parts.push(formatter(r));
  }
  return parts.join('\n');
}
```

**好处**：新增 actionType 时只需在 `formatters` 注册，不改动组件。

### 1.3 提取 `taskMock.ts`

```ts
// src/lib/taskMock.ts
export const mockThinkingResponses = { ... };
export function getMockResponse(input: string) { ... }
```

### 1.4 提取子组件

| 组件 | 原位置 | 新位置 | 职责 |
|------|--------|--------|------|
| `MarkdownContent` | ChatPanel.tsx:167 | `chat/MarkdownContent.tsx` | Markdown 渲染 |
| `ThinkingSteps` | ChatPanel.tsx:941 | `chat/ThinkingSteps.tsx` | 步骤列表 + 状态图标 |
| `ChatMessage` | ChatPanel.tsx:894 | `chat/ChatMessage.tsx` | 单条消息（气泡 + 思考过程 + 正文） |
| `ChatInput` | ChatPanel.tsx:1017 | `chat/ChatInput.tsx` | 输入框 + 发送按钮 |
| `ChatHistory` | ChatPanel.tsx:827 | `chat/ChatHistory.tsx` | 历史对话折叠面板 |

### 1.5 ChatPanel.tsx 重构后

```tsx
// src/components/chat/ChatPanel.tsx (~120行)
export default function ChatPanel({ onSendMessage, onGisDataRequest }: ChatPanelProps) {
  const { messages, isLoading, sendMessage, deleteMessage, clearAll } = useTaskChat();
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  return (
    <div className="h-full flex flex-col glass-panel rounded-lg overflow-hidden">
      <ChatHeader onHistoryToggle={() => setIsHistoryOpen(!isHistoryOpen)} />
      {isHistoryOpen && <ChatHistory messages={messages} onContinue={...} onDelete={deleteMessage} />}
      <ChatMessageList messages={messages} isLoading={isLoading} />
      <ChatInput onSend={sendMessage} isLoading={isLoading} />
    </div>
  );
}
```

---

## 第二阶段：RightPanel.tsx 拆分

### 目标文件结构

```
src/components/right-panel/
├── RightPanel.tsx            # 主组件：Tab 布局 (~150行)
├── TaskList.tsx              # 可执行任务列表
├── TaskItem.tsx              # 单条任务卡片
├── SubscriptionList.tsx      # 订阅任务列表
├── RequirementList.tsx       # 定制需求列表
├── EventList.tsx             # 事件列表
├── EventItem.tsx             # 单条事件卡片
├── InsightList.tsx           # AI 洞察列表
└── InsightItem.tsx           # 单条洞察卡片

src/hooks/
└── useRightPanel.ts          # 右侧面板业务逻辑 + SSE 监听

src/lib/
└── styleMaps.ts              # 所有样式映射函数
```

### 2.1 提取 `useRightPanel` Hook

**职责**：数据获取、props/API 数据合并、SSE 监听、自动展开逻辑。

```ts
// src/hooks/useRightPanel.ts
export function useRightPanel(propTasks: Task[], propEvents: TaskEvent[]) {
  const { tasks: apiTasks, events: apiEvents, subscriptions: apiSubs, ... } = useRightPanelData();

  // SSE 监听（仅保留一份连接）
  useEffect(() => {
    const handleTaskCreated = (e: Event) => {
      const taskId = (e as CustomEvent).detail as string;
      refresh();
      // 这里的 SSE 改为调用共享的 useTaskChat 中的 connectSse
      // 或者通过事件总线通知 ChatPanel 建立连接
    };
    window.addEventListener('agent:task-created', handleTaskCreated);
    return () => window.removeEventListener('agent:task-created', handleTaskCreated);
  }, [refresh]);

  // 数据合并（原 mergedTasks / mergedEvents 逻辑）
  const tasks = useMemo(() => mergeTasks(propTasks, apiTasks), [propTasks, apiTasks]);
  const events = useMemo(() => mergeEvents(propEvents, apiEvents), [propEvents, apiEvents]);

  // 自动展开
  const { expandedTasks, toggleTask } = useAutoExpand(tasks);

  return { tasks, events, expandedTasks, toggleTask, ... };
}
```

**关键改动**：
- `mergedTasks` / `mergedEvents` 的合并逻辑收进 Hook
- `subscriptions` / `insights` / `requirements` 的 API → state 映射消除，直接从 Hook 读取
- SSE 连接与 ChatPanel 共享（通过全局事件或统一 Hook），避免重复连接

### 2.2 提取 `styleMaps.ts`

```ts
// src/lib/styleMaps.ts
export const riskStyleMap = {
  high: 'border-[#FF4444] text-[#FF4444]',
  medium: 'border-[#FFAA00] text-[#FFAA00]',
  // ...
};

export const taskStatusStyleMap = { ... };
export const taskStatusLabelMap = { ... };
// ... 所有纯映射函数
```

### 2.3 提取子组件

| 组件 | 原位置 | 新位置 | 职责 |
|------|--------|--------|------|
| 任务列表 + 筛选 | RightPanel.tsx:457-571 | `right-panel/TaskList.tsx` | 任务列表 + 状态筛选 |
| 单条任务卡片 | 内联 | `right-panel/TaskItem.tsx` | 任务折叠/展开/子任务 |
| 订阅列表 | RightPanel.tsx:577-631 | `right-panel/SubscriptionList.tsx` | 订阅卡片列表 |
| 需求列表 | RightPanel.tsx:634-663 | `right-panel/RequirementList.tsx` | 需求卡片列表 |
| 事件列表 | RightPanel.tsx:703-779 | `right-panel/EventList.tsx` | 事件列表 |
| 单条事件卡片 | 内联 | `right-panel/EventItem.tsx` | 事件展开/地图联动 |
| 洞察列表 | RightPanel.tsx:782-855 | `right-panel/InsightList.tsx` | 洞察列表 |
| 单条洞察卡片 | 内联 | `right-panel/InsightItem.tsx` | 洞察展开/来源标签 |

---

## 第三阶段：SSE 连接统一

### 问题

当前 `ChatPanel` 和 `RightPanel` 各自建立 SSE 连接。

### 方案

**方案 A：全局 SSE Hook（推荐）**

```ts
// src/hooks/useGlobalSse.ts
const connections = new Map<string, EventSource>();

export function useGlobalSse() {
  const subscribe = (taskId: string, onMessage: (data: unknown) => void) => {
    if (connections.has(taskId)) {
      // 复用已有连接，追加回调
      addCallback(taskId, onMessage);
      return;
    }
    const es = new EventSource(`${API_BASE}/tasks/${taskId}/stream`);
    connections.set(taskId, es);
    es.onmessage = (e) => { broadcastToCallbacks(taskId, JSON.parse(e.data)); };
  };

  const unsubscribe = (taskId: string, onMessage: (data: unknown) => void) => {
    removeCallback(taskId, onMessage);
    if (getCallbacks(taskId).length === 0) {
      connections.get(taskId)?.close();
      connections.delete(taskId);
    }
  };

  return { subscribe, unsubscribe };
}
```

**方案 B：通过全局事件总线**

`ChatPanel` 建立 SSE，`RightPanel` 监听同一事件总线获取状态更新，不直接建立 SSE。

| 方案 | 复杂度 | 适用场景 |
|------|--------|----------|
| A | 中 | 需要两端都能独立接收 SSE 消息 |
| B | 低 | RightPanel 只需在任务完成时刷新列表，不需要逐 step 更新 |

---

## 第四阶段：文件依赖关系图

```
src/components/chat/ChatPanel.tsx
  ├── useTaskChat (hooks)
  ├── ChatMessage (components)
  ├── ChatInput (components)
  ├── ChatHistory (components)
  └── ChatHeader (components)

src/hooks/useTaskChat.ts
  ├── createAgentTask / getTask (lib/api)
  ├── formatTaskResult (lib/taskResultFormatter)
  ├── getMockResponse (lib/taskMock)
  └── useGlobalSse (hooks)  <-- 第三阶段

src/components/right-panel/RightPanel.tsx
  ├── useRightPanel (hooks)
  ├── TaskList (components)
  ├── SubscriptionList (components)
  ├── EventList (components)
  └── InsightList (components)

src/hooks/useRightPanel.ts
  ├── useRightPanelData (hooks)
  ├── mergeTasks / mergeEvents (utils)
  └── useGlobalSse (hooks)  <-- 第三阶段
```

---

## 实施顺序建议

| 阶段 | 内容 | 风险 | 预估改动文件数 |
|------|------|------|---------------|
| 1 | 提取 `styleMaps.ts` 和 `taskMock.ts` | 极低，纯移动代码 | 3 |
| 2 | 提取 `MarkdownContent` 子组件 | 低 | 2 |
| 3 | 提取 `useTaskChat` Hook + 拆分 ChatPanel | **中**，核心逻辑移动 | 6-8 |
| 4 | 提取 `useRightPanel` Hook + 拆分 RightPanel | **中**，数据流调整 | 6-8 |
| 5 | SSE 连接统一 | **中**，需测试两端接收 | 3 |
| 6 | 提取 `taskResultFormatter.ts` | 低 | 2 |

---

## 未知项（需确认）

1. **`useRightPanelData` 当前实现** — 需要读取确认它返回的数据结构，以确定 `mergeTasks` 的边界。
2. **`ChatPanel` 与 `RightPanel` 的 SSE 需求差异** — RightPanel 是否真的需要逐 step 更新？还是只需要 completed/failed 时刷新？
3. **是否有现有测试覆盖** — `handleSseUpdate` 和 `formatTaskResult` 逻辑复杂，重构前建议补充快照测试。
