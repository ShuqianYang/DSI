# v2 方案深入设计问答

> 针对用户在方案推进过程中提出的 5 个深入问题，给出分析和设计决策。

---

## 用户最终确认结果

| 题号 | 问题 | 用户确认 |
|------|------|----------|
| 1 | Session 记忆场景 | **A. 同 task 内多轮对话** |
| 2 | 是否扩展 continue 接口 | **是，但希望了解具体含义** |
| 3 | ChartRenderData 默认 chart_type | **A. `"auto"` 自动推荐** |
| 4 | 前端图表是否需要交互 | **希望了解 tooltip/legend 含义后再决定** |
| 5 | 报告保存方式 | **B. 保存到 `api/tmp/agent-loop/reports/`** |
| 6 | 下载格式 | **B. Word (.docx)** |
| 7 | Word 中图表处理 | **B. 后端生成 PNG 插入 Word** |

---

## 1. 当前的 session 有设计吗？

**有，本项目的会话设计以 `task` 为基本单位。**

### 1.1 核心概念

| 概念 | 说明 | 存储位置 |
|------|------|----------|
| `task` | 一次 Agent Loop 运行实例 | `tasks` 表 |
| `taskId` | 任务唯一标识 | `tasks.id` (UUID) |
| `userId` | 用户标识 | `tasks.user_id` |
| `transcript` | 单次 task 内的完整对话记录 | `agent_transcript_entries` 表 |
| `session summary memory` | 跨 task 的历史任务摘要 | `sessionSummaryMemoryManager` |

### 1.2 当前执行流程

```text
POST /tasks
  ├── 创建 task 记录（pending）
  ├── 立即返回 { taskId, status: "pending" }
  └── 异步执行 runAgentPipeline(taskId, body)
        ├── runAgentLoop({ taskId, query, transcriptStore, memoryManager })
        ├── 每轮对话写入 agent_transcript_entries
        ├── loop 结束后 task 状态变为 completed/failed
        └── 结果写入 tasks.result

GET /tasks/:taskId/stream
  └── SSE 实时推送 agent loop 事件

GET /tasks/:taskId
  └── 获取任务结果、步骤、错误等
```

### 1.3 同 task 内上下文

`runAgentLoop` 内部维护 `conversationMessages` 数组，每轮将 `assistant_message` 和 `tool_message` 追加进去，作为下一轮模型的上下文。因此：

> **同一个 taskId 内，天然支持多轮对话上下文。**

### 1.4 跨 task 记忆

当前通过 `sessionSummaryMemoryManager` 实现：

- 按 `userId` 查询最近完成的 N 个 tasks
- 加载这些 tasks 的 transcript
- 生成摘要后注入当前 task 的 system prompt

这意味着：**当前项目没有“同一个聊天 session 跨多个 task 的细粒度对话记忆”**，只有“同一用户最近 tasks 的摘要记忆”。

---

## 2. 我希望同一 session 中有上下文记忆，能实现吗？

**可以实现，但需要区分两种场景并做相应扩展。**

### 2.1 场景 A：同一个 task 内的多轮对话

这已经天然支持。关键在于**前端需要复用同一个 taskId**。

当前 `POST /tasks` 每次都会创建新 task。如果前端设计为多轮对话复用 taskId，需要：

1. 前端维护当前聊天 session 对应的 `taskId`
2. 第一轮：创建 task，获取 taskId
3. 后续轮次：不再创建新 task，而是向同一个 task 发送后续消息

但当前 `/tasks` API 并不支持“向已有 task 追加消息”，只支持创建新 task 并启动新 loop。

#### 什么是 `POST /tasks/:taskId/continue` 接口？

这是一个**追加消息接口**，用于在同一个 task 内继续对话。

**请求示例：**

```http
POST /tasks/123e4567-e89b-12d3-a456-426614174000/continue
Content-Type: application/json

{
  "message": "那昨天的呢？"
}
```

**响应示例：**

```json
{
  "taskId": "123e4567-e89b-12d3-a456-426614174000",
  "status": "running"
}
```

之后前端继续通过 `GET /tasks/:taskId/stream` 接收 SSE 事件。

#### 它的作用是什么？

假设用户第一轮问：

> "查询今天的一级预警数量"

AI 回答：

> "今天共有 12 条一级预警。"

用户接着问：

> "那昨天的呢？"

如果没有 continue 接口，前端只能创建一个新 task，新 task 没有“今天有 12 条”的上下文，可能无法理解“那昨天的呢”指的是什么。

有了 continue 接口，新消息会追加到同一个 task 的 conversation 中，模型能看到完整上下文：

```text
user: 查询今天的一级预警数量
assistant: 今天共有 12 条一级预警。
user: 那昨天的呢？
assistant: 昨天共有 8 条一级预警。
```

#### 实现要点

```text
POST /tasks/:taskId/continue
  ├── 校验 taskId 存在且状态为 completed 或 running
  ├── 从 agent_transcript_entries 加载历史消息
  ├── 将用户新消息追加到 conversationMessages
  ├── 调用 runAgentLoop 继续执行（传入 resumeMessages）
  └── 通过 SSE 推送后续事件
```

需要注意：

- 当前 `runAgentLoop` 是“从头开始”的设计，需要增加一个**resume 模式**，或包装一个 `continueAgentLoop` 函数
- 继续执行时，tool use context 需要重新构建，但历史 observations 可保留
- 该接口只适用于 `completed` 状态的 task，如果 task 还在 `running`，应直接返回“task 正在运行中”

### 2.2 场景 B：同一个聊天 session 跨多个 task 的上下文记忆

这是原项目 Redis session 记忆的能力，当前项目没有直接对应。需要扩展：

#### 数据库扩展

```typescript
// api/src/db/schema.ts
export const tasks = pgTable("tasks", {
  // ... 已有字段
  sessionId: text("session_id"), // 新增
});
```

#### API 扩展

```typescript
// CreateTaskRequest 增加 sessionId
interface CreateTaskRequest {
  query: string;
  userId?: string;
  sessionId?: string;  // 新增
}
```

#### 新的 MemoryManager

```typescript
// api/src/modules/agent-loop/sessionIdMemoryManager.ts
export function createSessionIdMemoryManager(input: {
  currentTaskId: string;
  sessionId: string;
  transcriptStore: AgentTranscriptStore;
  maxRecentMessages?: number;
}): MemoryManager {
  return {
    startRelevantMemoryPrefetch(messages, context) {
      const prefetch: AgentLoopPrefetch = {
        settledAt: null,
        consumedOnIteration: -1,
        promise: (async () => {
          // 1. 查询同 sessionId 下最近完成的 task（排除当前 task）
          // 2. 加载这些 task 的 transcript
          // 3. 提取最近 N 条 user/assistant/tool 消息
          // 4. 作为 PromptSection 注入上下文
          return sections;
        })(),
      };
      prefetch.promise.finally(() => { prefetch.settledAt = Date.now(); });
      return prefetch;
    },
  };
}
```

#### 推荐方案

| 场景 | 实现复杂度 | 推荐 |
|------|------------|------|
| A. 同 task 多轮 | 中 | **推荐**，最符合现有架构 |
| B. 跨 task session 记忆 | 高 | 如果业务需要，可作为二期扩展 |

**建议一期工程先做场景 A**，即：

- 前端一个聊天窗口对应一个 taskId
- 支持在当前 task 内多轮追问
- 跨 task 记忆复用现有的 `sessionSummaryMemoryManager`

如果需要场景 B，二期再扩展 `sessionId` 字段和对应 MemoryManager。

---

## 3. ChartRenderData 如何设计图表工具？

### 3.1 核心设计思路

`ChartRenderData` 不是“绘图工具”，而是“**图表数据准备工具**”。它接收 `MysqlQuery` 的结果，根据用户意图和数据特征，生成前端 recharts 可直接渲染的结构化数据。

### 3.2 输入输出设计

```typescript
const ChartRenderDataInputSchema = z.strictObject({
  chart_type: z.enum(["auto", "bar", "line", "pie"]).default("auto")
    .describe("图表类型，auto 表示由工具根据数据特征推荐"),
  data: z.array(z.record(z.union([z.string(), z.number()])))
    .describe("来自 MysqlQuery 的 rows"),
  title: z.string().min(1).describe("图表标题"),
  x_key: z.string().optional().describe("X 轴/分类字段"),
  y_key: z.string().optional().describe("Y 轴/数值字段"),
  label_key: z.string().optional().describe("饼图标签字段"),
  value_key: z.string().optional().describe("饼图数值字段"),
  series_keys: z.array(z.string()).optional().describe("折线图多系列字段"),
});
```

输出：

```typescript
interface ChartRenderDataOutput {
  chart_type: "bar" | "line" | "pie";
  title: string;
  data: Record<string, unknown>[];  // recharts 数据
  config: {
    x_axis?: string;
    y_axis?: string;
    label_key?: string;
    value_key?: string;
    series_keys?: string[];
  };
  chart_id: string;
}
```

### 3.3 能否像原项目一样根据数据自主选择工具？

**可以，但要分层：**

| 层级 | 职责 | 说明 |
|------|------|------|
| **模型层（LLM）** | 理解用户意图，决定是否需要图表、什么图表 | 例如用户说“统计一下” → 模型调用 `ChartRenderData` |
| **ChartRenderData 工具层** | 数据转换 + 类型推荐 | 当 `chart_type: "auto"` 时，根据数据特征推荐最佳图表 |
| **前端层** | 用 recharts 渲染 | 根据 `chart_type` 和 `config` 选择组件 |

#### 自动推荐逻辑示例

```typescript
function suggestChartType(data: Record<string, unknown>[], xKey?: string, yKey?: string): "bar" | "line" | "pie" {
  if (!data || data.length === 0) return "bar";

  // 有时间字段 → 折线图
  if (xKey && /time|date|hour|day|month/i.test(xKey)) {
    return "line";
  }

  // 只有两列，一列字符串一列数值 → 饼图或柱状图
  const keys = Object.keys(data[0]);
  if (keys.length === 2) {
    const numericCols = keys.filter(k => data.every(row => typeof row[k] === "number"));
    const stringCols = keys.filter(k => data.every(row => typeof row[k] === "string"));
    if (numericCols.length === 1 && stringCols.length === 1) {
      // 分类数少 → 饼图，否则柱状图
      return data.length <= 5 ? "pie" : "bar";
    }
  }

  // 默认柱状图
  return "bar";
}
```

**推荐做法：**

- Skill 中明确：当用户要求图表时，模型应调用 `ChartRenderData`
- `chart_type` 默认传 `"auto"`，由工具推荐
- 模型也可以在明确指定时传 `"bar"` / `"line"` / `"pie"`

### 3.4 图表交互（tooltip、legend）说明

recharts 是 React 图表库，原生支持交互。

#### Tooltip（提示框）

当鼠标悬停在图表的某个数据点上时，会弹出一个小浮层，显示该点的详细数值。

**示例：**

```text
柱状图：鼠标悬停在某根柱子上
┌─────────────────────┐
│ 一级预警            │
│ 数量: 12            │
└─────────────────────┘
```

作用：让用户无需读取坐标轴，就能快速看到精确数值。

#### Legend（图例）

当图表有多个数据系列时，图例显示每个系列对应的颜色和名称，用户可以点击图例隐藏/显示某个系列。

**示例：**

```text
● 一级预警  ● 二级预警  ● 三级预警
```

作用：帮助用户理解多系列图表，并提供简单的数据筛选能力。

#### 是否需要交互？

| 选项 | 说明 | 推荐场景 |
|------|------|----------|
| **需要交互** | 使用 recharts 原生 Tooltip + Legend | 用户在页面上做数据分析、探索 |
| **不需要交互** | 只显示静态图表 | 仅供展示、截图、嵌入报告 |

由于本项目已经有 `src/components/ui/chart.tsx` 封装了 `ChartTooltip` 和 `ChartLegend`，**建议默认开启交互**，不需要额外成本。

### 3.5 前端 recharts 如何渲染？

#### 后端给前端传输什么？

通过 task.result 或 SSE event 传输：

```json
{
  "type": "tool_observation",
  "toolName": "ChartRenderData",
  "output": {
    "chart_type": "bar",
    "title": "预警等级分布",
    "chart_id": "chart_abc123",
    "data": [
      { "level": "一级预警", "count": 12 },
      { "level": "二级预警", "count": 34 },
      { "level": "三级预警", "count": 56 }
    ],
    "config": {
      "x_axis": "level",
      "y_axis": "count"
    }
  }
}
```

#### 最终 Markdown 中的图表占位符

模型在最终回答中生成：

```markdown
最近一周预警等级分布如下：

![预警等级分布](chart://chart_abc123)

其中一级预警 12 条，二级预警 34 条，三级预警 56 条。
```

#### 前端渲染流程

```text
1. 前端解析 Markdown，识别 `![...](chart://<chart_id>)`
2. 从 task.result 的 charts 数组中找到对应 chart_id 的数据
3. 根据 chart_type 选择 recharts 组件：
   - bar → <BarChart />
   - line → <LineChart />
   - pie → <PieChart />
4. 用 src/components/ui/chart.tsx 中的 ChartContainer 包裹渲染
```

#### 前端组件伪代码

```tsx
// src/components/chat/ChartRenderer.tsx
import { BarChart, Bar, XAxis, YAxis, LineChart, Line, PieChart, Pie, Cell } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";

interface ChartData {
  chart_type: "bar" | "line" | "pie";
  title: string;
  chart_id: string;
  data: Record<string, unknown>[];
  config: {
    x_axis?: string;
    y_axis?: string;
    label_key?: string;
    value_key?: string;
    series_keys?: string[];
  };
}

export function ChartRenderer({ chartData }: { chartData: ChartData }) {
  const { chart_type, data, config } = chartData;

  if (chart_type === "bar") {
    return (
      <ChartContainer config={{}} className="h-[300px]">
        <BarChart data={data}>
          <XAxis dataKey={config.x_axis} />
          <YAxis />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Bar dataKey={config.y_axis} fill="#8884d8" />
        </BarChart>
      </ChartContainer>
    );
  }

  if (chart_type === "line") {
    return (
      <ChartContainer config={{}} className="h-[300px]">
        <LineChart data={data}>
          <XAxis dataKey={config.x_axis} />
          <YAxis />
          <ChartTooltip content={<ChartTooltipContent />} />
          {config.series_keys?.map((key, i) => (
            <Line key={key} type="monotone" dataKey={key} stroke={COLORS[i]} />
          ))}
        </LineChart>
      </ChartContainer>
    );
  }

  if (chart_type === "pie") {
    return (
      <ChartContainer config={{}} className="h-[300px]">
        <PieChart>
          <ChartTooltip content={<ChartTooltipContent />} />
          <Pie
            data={data}
            dataKey={config.value_key}
            nameKey={config.label_key}
            cx="50%"
            cy="50%"
            outerRadius={100}
          >
            {data.map((_, i) => (
              <Cell key={`cell-${i}`} fill={COLORS[i % COLORS.length]} />
            ))}
          </Pie>
        </PieChart>
      </ChartContainer>
    );
  }

  return null;
}
```

---

## 4. 当前生成的 figure 和 report 是否需要保存在本地？

**取决于业务需求，建议如下：**

### 4.1 Figure（图表）

由于 v2 方案使用 recharts 前端渲染，**后端不生成图片文件**，因此：

- **不需要本地保存 figure**
- 图表数据随 task.result 持久化到数据库
- 历史 task 可随时重新渲染图表

### 4.2 Report（日报）

用户确认：**保存到本地文件 `api/tmp/agent-loop/reports/`**。

原因：

- 用户需要下载 Word 报告
- 本地文件便于直接读取和下载
- 不占用数据库存储空间

#### 保存内容

| 内容 | 保存位置 | 说明 |
|------|----------|------|
| Markdown 报告 | `api/tmp/agent-loop/reports/{date}_{report_type}_{taskId}.md` | 原始 Markdown |
| Word 报告（下载时生成） | `api/tmp/agent-loop/reports/{date}_{report_type}_{taskId}.docx` | 下载后缓存 |
| 图表 PNG（下载时生成） | `api/tmp/agent-loop/reports/{date}_{report_type}_{taskId}_*.png` | 用于插入 Word |

### 4.3 文件清理

需要定时清理 `api/tmp/agent-loop/reports/` 目录下的过期文件。可参考原项目 `apscheduler` 的清理逻辑，在 Node.js 中用 `node-cron` 或类似库实现。

建议保留 **30 天**，与原有项目 `RETAIN_DAYS` 一致。

---

## 5. 如何实现报告的下载功能？

### 5.1 用户确认

| 选项 | 用户选择 |
|------|----------|
| 下载格式 | **Word (.docx)** |
| Word 中图表处理 | **后端生成 PNG 插入** |

### 5.2 关键调整：后端需要同时具备两种图表能力

由于 Word 下载要求图表是 PNG，但在线查看使用 recharts，因此需要：

```text
在线查看
  └── ChartRenderData 返回 { chart_type, data, config }
      └── 前端 recharts 渲染（含 tooltip/legend 交互）

Word 下载
  └── 根据 chart data 调用 generateChartPng()
      └── 后端生成 PNG 文件
          └── 插入 docx
```

### 5.3 后端 PNG 生成方案

推荐方案：**使用 `@observablehq/plot` 或 `quickchart-js`**

#### 方案 A：`@observablehq/plot`（推荐）

```typescript
// api/src/modules/agent-loop/tools/domain/chartRenderData/chartPngGenerator.ts
import * as Plot from "@observablehq/plot";
import { createCanvas } from "canvas";

export async function generateChartPng(
  chartData: ChartRenderDataOutput,
  outputPath: string
): Promise<string> {
  const { chart_type, data, config, title } = chartData;

  let plot;
  if (chart_type === "bar") {
    plot = Plot.plot({
      title,
      x: { label: config.x_axis },
      y: { label: config.y_axis },
      marks: [Plot.barY(data, { x: config.x_axis, y: config.y_axis })],
    });
  } else if (chart_type === "line") {
    plot = Plot.plot({
      title,
      marks: config.series_keys?.map((key) =>
        Plot.line(data, { x: config.x_axis, y: key, stroke: key })
      ),
    });
  } else if (chart_type === "pie") {
    // Plot 不直接支持 pie，可用 quickchart 或自己用 canvas 画
  }

  // 将 SVG 转为 PNG
  const svg = plot.outerHTML;
  // ... 使用 canvas 或 sharp 转 PNG

  return outputPath;
}
```

#### 方案 B：`quickchart-js`

```typescript
import QuickChart from "quickchart-js";

export async function generateChartPng(chartData: ChartRenderDataOutput): Promise<Buffer> {
  const qc = new QuickChart();
  qc.setConfig({
    type: chartData.chart_type,
    data: {
      labels: chartData.data.map((d) => d[config.x_axis ?? config.label_key!]),
      datasets: [{
        data: chartData.data.map((d) => d[config.y_axis ?? config.value_key!]),
      }],
    },
  });
  return qc.toBinary();
}
```

**推荐方案 A（`@observablehq/plot`）**，因为它与数据流更契合，且不需要外部网络请求。

### 5.4 Word 生成方案

使用 `docx` 库将 Markdown 转换为 docx，并在遇到 chart 占位符时插入 PNG 图片。

```typescript
// api/src/modules/agent-loop/tools/domain/dailyReport/dailyReportDownloader.ts
import { Document, Packer, Paragraph, ImageRun } from "docx";
import fs from "node:fs/promises";
import { generateChartPng } from "../chartRenderData/chartPngGenerator.js";

export async function generateDailyReportDocx(
  reportContent: string,
  charts: ChartRenderDataOutput[],
  outputPath: string
): Promise<string> {
  const children: (Paragraph | ImageRun)[] = [];

  // 简单按行解析 Markdown
  const lines = reportContent.split("\n");
  for (const line of lines) {
    const chartMatch = line.match(/!\[(.*?)\]\(chart:\/\/(\w+)\)/);
    if (chartMatch) {
      const chartId = chartMatch[2];
      const chart = charts.find((c) => c.chart_id === chartId);
      if (chart) {
        const pngPath = outputPath.replace(".docx", `_${chartId}.png`);
        await generateChartPng(chart, pngPath);
        const imageBuffer = await fs.readFile(pngPath);
        children.push(
          new Paragraph({
            children: [
              new ImageRun({
                data: imageBuffer,
                transformation: { width: 600, height: 300 },
                type: "png",
              }),
            ],
          })
        );
        continue;
      }
    }

    // 普通文本段落
    children.push(new Paragraph({ text: line }));
  }

  const doc = new Document({ sections: [{ children }] });
  const buffer = await Packer.toBuffer(doc);
  await fs.writeFile(outputPath, buffer);
  return outputPath;
}
```

### 5.5 下载接口

```text
GET /tasks/:taskId/daily-report/download
  ├── 从 tasks.result 读取 report_content 和 charts
  ├── 生成 docx 文件（如不存在）
  └── 返回 application/vnd.openxmlformats-officedocument.wordprocessingml.document
```

### 5.6 推荐实现路径（已确定）

**一期：**

- 在线查看 Markdown 日报（含 recharts 交互图表）
- 后端生成 Word (.docx) 下载
- Word 中图表用后端生成的 PNG 插入
- 报告 Markdown 和 Word 保存到 `api/tmp/agent-loop/reports/`

**二期（可选）：**

- PDF 导出
- 历史报告列表页
- 报告过期自动清理

---

## 6. 最终方案确认

基于以上所有讨论，最终方案确认如下：

### 6.1 架构

```text
完全内嵌至本项目
  ├── Skill（Markdown 提示词/路由）
  ├── Domain Tool（TypeScript 实现）
  ├── Agent Loop（现有框架）
  ├── Memory（同 task 内多轮 + 跨 task session summary）
  └── 前端 recharts 渲染
```

### 6.2 关键设计决策

| 决策项 | 最终选择 |
|--------|----------|
| 技术栈 | 本项目 TypeScript + Next.js + recharts |
| QA 入口 | 复用 `/tasks` + Skill 路由 |
| 日报入口 | 复用 `/tasks` + Skill 路由 |
| 同 task 多轮 | 扩展 `POST /tasks/:taskId/continue` |
| 跨 task 记忆 | 复用现有 `sessionSummaryMemoryManager` |
| 图表在线渲染 | recharts（含 tooltip/legend 交互） |
| 图表 Word 渲染 | 后端生成 PNG 插入 docx |
| 报告保存 | `api/tmp/agent-loop/reports/` |
| 下载格式 | Word (.docx) |
| 自定义报告 | 不做 |

### 6.3 核心文件清单

#### Skill
- `skills/border-defense-qa/SKILL.md`
- `skills/daily-report/SKILL.md`

#### Domain Tool
- `api/src/modules/agent-loop/tools/domain/chartRenderData/chartRenderData.ts`
- `api/src/modules/agent-loop/tools/domain/chartRenderData/chartPngGenerator.ts`
- `api/src/modules/agent-loop/tools/domain/dailyReport/dailyReport.ts`
- `api/src/modules/agent-loop/tools/domain/dailyReport/dailyReportSql.ts`
- `api/src/modules/agent-loop/tools/domain/dailyReport/dailyReportDownloader.ts`
- `api/src/modules/agent-loop/tools/domain/index.ts`（注册）

#### API
- `api/src/modules/tasks/routes.ts`（扩展 continue 接口）
- `api/src/modules/tasks/controller.ts`（扩展 continue 方法）
- 新增 `GET /tasks/:taskId/daily-report/download`

#### 前端
- `src/components/chat/ChartRenderer.tsx`
- 聊天消息渲染组件（识别 chart:// 占位符）

#### 其他
- `api/src/db/schema.ts`（如需扩展 sessionId，可选）
- `api/src/modules/agent-loop/promptManager.ts`（新增路由规则）

---

## 7. 下一步行动

1. 确认最终方案（本节内容）是否可接受。
2. 确认后，按以下优先级开始编码：
   - **里程碑 1**：迁移 SQL 模板 + 重写 `DailyReport` tool（本地 SQL + LLM）
   - **里程碑 2**：实现 `ChartRenderData` tool + 前端 recharts 渲染
   - **里程碑 3**：扩展 `POST /tasks/:taskId/continue` 接口实现同 task 多轮
   - **里程碑 4**：实现 Word 下载 + 后端 PNG 生成
   - **里程碑 5**：增强 `border-defense-qa` Skill + QA 图表/明细查询
3. 每个里程碑完成后进行测试和验证。

---

*文档更新时间：2026-06-30*
*方案作者：Kimi Code CLI*
