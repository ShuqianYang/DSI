# 场景级独立会话历史实现计划

> **目标**：切换场景时刷新 ChatPanel 对话框，每个场景保留独立的会话历史；数据模型直接面向未来“类 ChatGPT 多会话”能力演进。

## 已确认的设计决策

| 决策项 | 选择 | 说明 |
|---|---|---|
| 持久化层级 | `localStorage` | 刷新后保留，按用户隔离 |
| 用户隔离 | 按 `userId` | key 为 `ty-chat-sessions-${userId}` |
| 数据模型 | `ChatSession` 抽象 | 当前每个 `scenarioId` 对应一个默认 session，未来可扩展为多个 |
| 进行中任务 | 后台继续运行 | SSE 不关闭；`isLoading` 按 session 独立 |

---

## 数据模型

```typescript
// src/types/prd.ts
export interface ChatSession {
  id: string;              // 当前规则：default-${scenarioId}
  scenarioId: ScenarioId;  // 所属场景
  title: string;           // 当前规则："默认会话"
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}
```

`ChatMessage` 保持不变。

---

## 分步实现清单

### Step 1: 类型定义

**状态：** ✅ 已完成

**文件：** `src/types/prd.ts`

- 从 `@datasourceintelligence/shared` 引入 `ScenarioId`。
- 在 `ChatMessage` 后新增 `ChatSession` 接口。

**验证：** `pnpm ts-check`（只关注类型层错误）或 `cd packages/shared && pnpm build`。

---

### Step 2: 会话存储工具函数

**状态：** ✅ 已完成

**文件：** `src/lib/chatSessions.ts`（新建）

提供以下函数：

- `getStorageKey(userId)`
- `loadSessions(userId)` —— 安全读取 localStorage
- `saveSessions(userId, sessions)` —— 安全写入 localStorage
- `getDefaultSessionId(scenarioId)`
- `createDefaultSession(scenarioId)`
- `ensureSession(sessions, scenarioId)` —— 不存在则创建默认 session
- `updateSessionMessages(sessions, sessionId, updater)`
- `findSessionIdByTaskId(sessions, taskId)` —— SSE 事件归属查找

**验证：** 新建文件后运行 `pnpm lint src/lib/chatSessions.ts`。

---

### Step 3: 重构 `useTaskChat` 支持多 session

**状态：** ✅ 已完成

**文件：** `src/hooks/useTaskChat.ts`

1. `UseTaskChatOptions` 增加 `userId?: string`。
2. 内部状态从单一 `messages` 改为：
   - `sessions: ChatSession[]`
   - `activeSessionId: string | null`
   - `loadingSessionIds: Set<string>`
3. 派生：
   - `messages = activeSession?.messages ?? []`
   - `isLoading = activeSessionId ? loadingSessionIds.has(activeSessionId) : false`
4. 初始化时从 localStorage 加载 sessions。
5. `scenarioId` 变化时：
   - 调用 `ensureSession` 确保有默认 session。
   - 设置 `activeSessionId`。
6. 所有 `setMessages` 调用改为更新对应 session 的 `messages`：
   - 用户主动发消息、系统消息、`clearAll`、`deleteMessage` 更新 `activeSession`。
   - SSE 更新（`upsertThinkingStep`、`applyTaskResultToMessage`、`finishTaskFromStream`、`handleAgentLoopUpdate`）先通过 `findSessionIdByTaskId` 定位 session。
7. `sendMessage` 开始时把 `activeSessionId` 加入 `loadingSessionIds`；任务完成/失败时移除。
8. `inputValue` 保持全局（本次不拆分到 session），但切换场景时建议清空或保留按用户偏好决定。

**验证：**
- `pnpm lint src/hooks/useTaskChat.ts`
- 运行前端 dev，手动切换场景确认历史隔离

---

### Step 4: `ChatPanel` 透传 `userId`

**状态：** ✅ 已完成

**文件：** `src/components/ChatPanel.tsx`

- `ChatPanelProps` 增加 `userId?: string`。
- 把 `userId` 传给 `useTaskChat`。

**验证：** `pnpm lint src/components/ChatPanel.tsx`

---

### Step 5: `page.tsx` 传入当前用户 ID

**状态：** ✅ 已完成

**文件：** `src/app/page.tsx`

- 在渲染 `ChatPanel` 处把 `mockUser.id`（或未来真实登录用户的 id）传入 `userId`。

**验证：** `pnpm lint src/app/page.tsx`

---

### Step 6: `ChatHistory` 侧栏兼容

**状态：** ✅ 已完成（无需改动，组件仅依赖 `messages` prop）

**文件：** `src/components/chat/ChatHistory.tsx`

- 当前组件只接收 `messages` prop，理论上无需改动。
- 但“历史对话”标题语义需要从“当前会话历史”演进为“会话列表入口”，本次可保持现状，仅确认 `messages` 正确传入。

**验证：** 打开历史侧栏，确认显示的是当前 active session 的最后 10 条用户消息。

---

### Step 7: 端到端验证

**状态：** ⏳ 待手动验证

1. 在场景 A 发送几条消息。
2. 切换到场景 B，确认对话框为空或只有场景 B 的默认问候。
3. 在场景 B 发送消息。
4. 切回场景 A，确认场景 A 的消息完整保留。
5. 刷新页面，确认两个场景的历史都从 localStorage 恢复。
6. 用无痕窗口/换账号登录，确认 session 隔离生效。

---

## 风险与注意事项

| 风险 | 缓解 |
|---|---|
| localStorage 容量限制（~5MB） | 后续可增加消息数量限制或归档策略；当前场景默认会话不会很快超限。 |
| 敏感数据落盘 | 当前是本地演示/测试环境；生产环境应迁移到后端持久化并加密。 |
| 版本迁移 | `ChatSession` 结构未来变更时，建议加 `version` 字段做迁移。 |
| 进行中任务跨场景 | SSE 全局监听，更新时按 `taskId` 找 session；切换场景不会中断后台任务。 |

---

## 下一步（由你指定步骤编号）

按顺序执行 Step 1 → Step 7，或跳过某步直接执行你指定的步骤。
