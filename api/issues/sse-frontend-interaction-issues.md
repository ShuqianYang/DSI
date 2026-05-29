

# SSE 与前端交互问题汇总

> 创建时间: 2026-04-27
> 相关文件:
> - `api/src/sse/sseManager.ts`
> - `api/src/modules/tasks/routes.ts`
> - `api/src/index.ts`
> - `src/lib/api.ts`
> - `src/components/ChatPanel.tsx`
> - `src/components/RightPanel.tsx`

---

## 概述

当前 SSE 实现用于将后端 Agent Pipeline（Planner → Router → Executor → Actions → Insights）的任务状态实时推送到前端。

后端通过 `Redis Pub/Sub` 广播任务状态更新，各 API 实例订阅后通过内存中的 `Map<string, Set<Response>>` 推送给对应的 SSE 客户端。

前端在 `ChatPanel` 和 `RightPanel` 两个组件中独立建立 `EventSource` 连接，消费 SSE 消息。

---

## 问题列表（按优先级排序）

### P0 - 同一 Task 多处重复建立 SSE 连接

**影响**: 高

**描述**:

`ChatPanel.tsx:340` 和 `RightPanel.tsx:85` 各自独立对同一 `taskId` 创建 `EventSource`：

```ts
// ChatPanel.tsx:340
const evtSource = new EventSource(`http://localhost:3001/tasks/${taskId}/stream`);

// RightPanel.tsx:85
const evtSource = new EventSource(`http://localhost:3001/tasks/${taskId}/stream`);
```

后端 `sseManager.ts` 用 `Set<Response>` 存储同一 task 的所有客户端，导致：
- 同一浏览器与后端建立 2 条 SSE 长连接
- 同一消息被推送到同一浏览器的多个 `EventSource` 实例
- `RightPanel.tsx:103` 只在 `completed/failed` 时关闭，但 `ChatPanel` 也持有连接
- 不必要的网络带宽和内存占用

**建议修复**:

将 SSE 连接提升到共享层（如 React Context + Hook），或组件间通过事件同步连接状态，确保同一 `taskId` 只建立一个连接。

---

### P0 - 前端硬编码 API URL

**影响**: 高

**描述**:

```ts
// ChatPanel.tsx:340
const evtSource = new EventSource(`http://localhost:3001/tasks/${taskId}/stream`);

// RightPanel.tsx:85
const evtSource = new EventSource(`http://localhost:3001/tasks/${taskId}/stream`);
```

两处均硬编码 `http://localhost:3001`，生产环境无法运行。

**建议修复**:

使用 `process.env.NEXT_PUBLIC_API_URL` 或统一配置文件，与 `src/lib/api.ts` 中 `API_BASE` 保持一致。

---

### P1 - 无自动重连机制

**影响**: 中

**描述**:

`ChatPanel.tsx:353` 的 `onerror` 处理：

```ts
evtSource.onerror = () => {
  evtSource.close();
  sseConnections.current.delete(taskId);  // 直接放弃
};
```

网络闪断、WiFi 切换、服务器重启后不会恢复连接，任务后续更新全部丢失。

`RightPanel.tsx` 甚至没有 `onerror` 处理。

**建议修复**:

封装带指数退避（exponential backoff）重连的 `useTaskSse(taskId)` Hook：
- 断开时延迟 1s → 2s → 4s → 8s → ... 最大 30s 重试
- 达到最大重试次数后标记为失败
- 连接成功或任务完成时重置重试计数

---

### P1 - 无心跳保活机制

**影响**: 中

**描述**:

`tasks/routes.ts` 建立 SSE 后没有任何定时发送（如 `:ping\n\n` 或空消息）。长时间无消息的连接会被：
- Nginx/CDN 代理静默断开（默认 60s 超时）
- 浏览器认为连接已死

前端只有在收到下一条消息时才发现连接已断，此时已丢失中间状态。

**建议修复**:

后端每 30 秒发送一次心跳：

```ts
const heartbeat = setInterval(() => {
  if (res.writableEnded || res.destroyed) {
    clearInterval(heartbeat);
    return;
  }
  res.write(':ping\n\n');
}, 30000);
```

前端同时实现连接空闲超时检测（如 60s 无消息自动重连）。

---

### P2 - 后端异常断开清理不完整

**影响**: 低

**描述**:

`tasks/routes.ts:87` 只监听了 `req.on("close")`：

```ts
req.on("close", () => {
  removeSseClient(taskId, res);
  res.end();
});
```

TCP 异常断开（如客户端断电、网络切换）可能不触发 `close`，只触发 `error`。

**建议修复**:

同时监听 `req.on("error", ...)`：

```ts
req.on("close", cleanup);
req.on("error", cleanup);
```

---

### P2 - 补推逻辑缺乏客户端存活检查

**影响**: 低

**描述**:

`tasks/routes.ts:27-82` 的补推阶段连续写入多条消息，但没有检查 `res.writableEnded` 或 `res.destroyed`。如果客户端在补推中途断开，`res.write()` 可能抛异常导致未捕获错误。

**建议修复**:

每次 `write` 前检查客户端是否仍然存活：

```ts
function safeWrite(res: Response, data: unknown): boolean {
  if (res.writableEnded || res.destroyed) return false;
  try {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    return true;
  } catch {
    return false;
  }
}
```

---

### P2 - 无单 Task 连接数限制

**影响**: 低

**描述**:

`sseManager.ts` 的 `Set<Response>` 对同一 `taskId` 可无限追加。异常场景（如前端 bug 导致无限重连）下会造成内存泄漏。

**建议修复**:

在 `addSseClient` 中限制最大连接数（如 5 个），超出时关闭最早的连接：

```ts
export function addSseClient(taskId: string, res: Response) {
  if (!clients.has(taskId)) {
    clients.set(taskId, new Set());
  }
  const set = clients.get(taskId)!;
  if (set.size >= 5) {
    const first = set.values().next().value;
    if (first) {
      first.end();
      set.delete(first);
    }
  }
  set.add(res);
}
```

---

## 修复优先级建议

| 优先级 | 问题 | 修复工作量 | 涉及文件 |
|--------|------|-----------|----------|
| P0 | 重复 SSE 连接 | 中 | `ChatPanel.tsx`, `RightPanel.tsx`, 新增共享 Hook |
| P0 | 硬编码 URL | 低 | `ChatPanel.tsx`, `RightPanel.tsx` |
| P1 | 无自动重连 | 中 | 新增 `useTaskSse` Hook |
| P1 | 无心跳保活 | 低 | `tasks/routes.ts` |
| P2 | 异常断开清理 | 低 | `tasks/routes.ts` |
| P2 | 补推存活检查 | 低 | `tasks/routes.ts`, `sseManager.ts` |
| P2 | 连接数限制 | 低 | `sseManager.ts` |

---

## 架构层面的思考

当前 SSE 设计（Redis Pub/Sub + 内存级 clients Map）在单实例或少量实例部署下可正常工作。但在多实例部署时：

- **优势**: Redis Pub/Sub 天然广播到所有实例，每个实例只推送连接在自己上的客户端，无需粘性会话（sticky session）。
- **劣势**: `broadcastToAll` 全局事件会在每个实例上被处理一次，虽然每个客户端只连接在一个实例上、不会重复接收，但实例数很多时有 overhead。

若未来实例数增加，可考虑改用 **Redis Streams** 或 **Socket.IO with Redis Adapter** 替代原生 SSE + 手动 Pub/Sub。
