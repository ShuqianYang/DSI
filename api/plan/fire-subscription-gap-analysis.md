# 火情监测订阅与研判流程 — 现有架构差距分析

## Context

实现一个完整的**火情监测订阅与智能研判**闭环流程：

用户通过对话框提报订阅需求（含区域划定）→ 智能体自动完成需求解析与流程编排 → 生成订阅监测任务 → 自动值守并模拟火情事件 → 选定事件后执行全流程研判 → 地图展示结果 → 标准化推送。

本分析评估现有代码架构与该目标流程的差距，并识别哪些差异点可通过"写死"（硬编码）方式快速补齐。

---

## 现有架构概览

### 后端
- **Agent Pipeline**: Planner → Router → Executor，基于 Dify LLM + 规则回退
- **持久层**: PostgreSQL + Drizzle ORM，7 张核心表（tasks, task_steps, job_tasks, events, subscriptions, requirements, insights）
- **订阅系统**: Subscription CRUD + node-cron scheduler（每分钟扫描到期订阅）
- **事件系统**: Event CRUD，executor 执行 action 后自动写入 events 表
- **Capability 体系**: 9 个已注册能力（maritime, intelligence, subscription, requirement, intelligent_qa, daily_report, satellite, news, fire-detector）
- **SSE 实时推送**: 双通道（in-process + Redis Pub/Sub）
- **任务队列**: BullMQ + Redis

### 前端
- **Cesium 3D 地图**: 支持实体/轨迹/区域渲染、脉冲环、事件联动、火灾 overlay、本地瓦片
- **ChatPanel**: 聊天输入 + 消息展示 + thinking steps 动画
- **RightPanel**: 即时服务 / 订阅任务 / 定制服务 / 事件 / AI洞察 五个标签
- **useTaskChat**: SSE 连接管理 + 步骤级实时更新 + 火灾检测联动回调

### 关键文件路径
| 组件 | 路径 |
|------|------|
| Planner | `api/src/modules/planner/service.ts` |
| Router | `api/src/modules/router/service.ts` |
| Executor | `api/src/modules/executor/service.ts` |
| Scheduler | `api/src/modules/scheduler/service.ts` |
| Subscription CRUD | `api/src/modules/subscriptions/service.ts` |
| Event CRUD | `api/src/modules/events/service.ts` |
| fire-detector | `api/src/modules/actions/capabilities/fire.ts` |
| subscription | `api/src/modules/actions/capabilities/subscription.ts` |
| CesiumMap | `src/components/cesium/CesiumMap.tsx` |
| GisViewer | `src/components/GisViewer.tsx` |
| useTaskChat | `src/hooks/useTaskChat.ts` |
| page.tsx | `src/app/page.tsx` |

---

## 目标流程 vs 现有能力 — 差距矩阵

| 步骤 | 目标能力 | 现有能力 | 差距 | 写死解决难度 |
|------|---------|---------|------|------------|
| **1. 文本提报需求** | 自然语言输入订阅需求 | Chat + Planner 解析意图 | 已有基础，Planner 需理解"订阅+火情+区域"组合意图 | **容易** |
| **2. 区域提取** | 从文本提取监测区域 | 无区域提取逻辑 | 需要 NLP 提取或关键词匹配 | **容易** |
| **3. 手动绘制区域** | 地图交互画 polygon 确认 | 无区域绘制工具 | 需要 Cesium 鼠标交互绘制 | **较难** |
| **4. 确认提交** | 需求确认表单 | 无确认 UI | 需要模态框/表单组件 | **容易** |
| **5. 需求解析** | 结构化解析为订阅配置 | Planner 生成 plan | 已有基础 | **容易** |
| **6. 舆情监测配置** | 关联新闻监测到订阅 | news capability 存在，但未与订阅关联 | 需要 subscription 存储监测配置 | **中等** |
| **7. 天基资源调度** | 卫星成像需求调度 | satellite capability（查询历史数据），无调度能力 | 需要新增 satellite-schedule capability | **较难** |
| **8. 研判流程编排** | 线索核查→遥感比对→卫星调度→解译→判定 | Executor 串行执行 action，无研判专用流程 | 需要新增多个 capability + 编排逻辑 | **较难** |
| **9. 生成订阅任务** | 创建带区域的订阅记录 | Subscription CRUD 完整，但 capability 太简单 | subscription capability 需扩展参数 | **容易** |
| **10. 地图高亮区域** | 动态展示监测订阅区域 | Region 渲染已有（静态 mockRegions） | 需要动态 region 创建与展示 | **容易** |
| **11. 自动值守** | 订阅周期性执行火情检测 | Scheduler 每分钟扫描 + 执行 toolType | 已有基础，需关联 fire-detector | **容易** |
| **12. 模拟火情事件** | 生成多个疑似火情供选择 | 无批量事件生成机制 | 需要在 scheduler/capability 中硬编码生成 | **容易** |
| **13. 事件选择触发研判** | 用户选择事件后启动研判 | 无事件选择→任务触发机制 | 需要前端选择 UI + 后端触发新任务 | **中等** |
| **14. 地图展示研判结果** | 火情点位、影响范围、风险等级 | Fire overlay 存在（固定 Kensai 区域） | 需要动态点位/范围/风险展示 | **中等** |
| **15. 标准化封装推送** | 推送至边防应用平台 | 无外部推送机制 | 需要 webhook/http 推送 capability | **较难** |

---

## 可通过"写死"解决的差异点

### 容易写死（代码量小，逻辑简单）

#### 1. 需求意图识别
- **做法**: 在 Planner prompt 和 Router 的 `parseActionsFromText()` 中硬编码关键词匹配
- **触发词**: "订阅" + "火情" → 生成特定 plan（subscription → fire-detector → news）
- **文件**: `api/src/modules/planner/service.ts`, `api/src/modules/router/service.ts`

#### 2. 区域提取
- **做法**: Router 中硬编码区域关键词到坐标范围的映射
- **示例**: "新疆边境" / "哈萨克斯坦" → `{west: 79.5, south: 42.5, east: 88.0, north: 49.0}`
- **文件**: `api/src/modules/router/service.ts`

#### 3. 订阅任务生成（带区域）
- **做法**: 扩展 `subscription capability` 接收 `region` / `bbox` / `queryParams` 参数
- **效果**: subscription 记录存储监测区域，scheduler 执行时传入区域参数
- **文件**: `api/src/modules/actions/capabilities/subscription.ts`, `api/src/db/schema.ts`（可能需要扩展 queryParams 结构）

#### 4. 舆情监测配置
- **做法**: subscription 的 `toolType` 设为 `"fire-monitor"`（新类型），scheduler 执行时串行调用 `news` + `fire-detector`
- **或**: 保持 `toolType = "fire-detector"`，在 capability 内部先调 news 再返回火情结果
- **文件**: `api/src/modules/scheduler/service.ts`, `api/src/modules/actions/capabilities/fire.ts`

#### 5. 地图区域高亮（静态）
- **做法**: `fire-detector` capability 返回新疆边境固定 polygon，前端 `CesiumMap` 渲染为 Region
- **或**: 新增 `showSubscriptionRegion()` ref 方法，接收固定坐标数组
- **文件**: `api/src/modules/actions/capabilities/fire.ts`, `src/components/cesium/CesiumMap.tsx`

#### 6. 模拟火情事件列表
- **做法**: 在 scheduler 执行 fire-detector 订阅时，生成 3-5 个硬编码 mock 火情事件写入 `events` 表
- **示例事件**: 不同位置、不同置信度、不同时间戳的疑似火点
- **文件**: `api/src/modules/scheduler/service.ts` 或 `api/src/modules/actions/capabilities/fire.ts`

#### 7. 研判结果展示（扩展字段）
- **做法**: `fire-detector` 返回数据中增加 `riskLevel` / `affectedArea` / `spreadDirection` 等字段
- **前端**: `taskResultFormatter` 中格式化展示，CesiumMap 中根据风险等级渲染不同颜色
- **文件**: `api/src/modules/actions/capabilities/fire.ts`, `src/lib/taskResultFormatter.ts`, `src/components/cesium/CesiumMap.tsx`

### 较难写死（需要较多代码或交互组件）

#### 1. 地图交互绘制区域
- **原因**: 需要 Cesium `ScreenSpaceEventHandler` 实现 mouse-down/move/up 绘制 polygon，涉及坐标转换、图形编辑、撤销/确认等交互
- **估算**: 200-400 行前端代码
- **文件**: `src/components/cesium/CesiumMap.tsx` + 新绘制工具组件

#### 2. 天基资源调度（模拟）
- **原因**: 需要模拟卫星轨道、过境时间、成像能力、任务冲突检测等
- **简化写死**: 固定返回 "已调度 XX 卫星，预计 HH:MM 过境成像"
- **文件**: 新增 `api/src/modules/actions/capabilities/satellite-schedule.ts`

#### 3. 全流程研判步骤
- **原因**: 需要多个新 capability（fire-clue-verify, remote-sensing-compare, satellite-imaging, image-interpretation, fire-verdict）
- **简化写死**: 每个 capability 返回固定模板数据，但框架代码（注册、路由、执行）仍需新增
- **文件**: 多个新 capability 文件 + `registry.ts` + `executor/service.ts` + `router/service.ts`

#### 4. 外部平台推送
- **原因**: 需要 HTTP client + 认证 + 重试 + 日志
- **简化写死**: 固定 webhook URL，直接 POST JSON
- **文件**: 新增 `api/src/modules/actions/capabilities/push.ts`

---

## 关键差距总结

### 架构层面（难以写死）
1. **缺乏"订阅-事件-研判"闭环模型**: 现有订阅只是周期性执行一个 tool，没有"订阅产生事件→用户选择事件→触发新任务"的状态机
2. **缺乏交互式区域采集**: 用户无法在地图上划定监测范围
3. **缺乏外部系统集成**: 没有 webhook/推送 capability

### 功能层面（可以写死）
1. **Planner/Router 意图识别**: 加关键词和 prompt 示例即可
2. **订阅参数扩展**: subscription capability 和 schema 增加 region 字段
3. **Mock 火情事件**: scheduler 或 capability 中硬编码生成
4. **地图区域展示**: CesiumMap 增加固定 region 渲染
5. **研判结果格式化**: 扩展 fire-detector 返回数据结构

### 数据层面
1. **subscription.queryParams 是 JSONB**: 可以灵活存储区域、监测类型等配置，无需改表结构
2. **events.gisData 是 JSONB**: 可以存储火情事件的 GIS 数据，已有字段
3. **缺少**: subscription 执行历史表、火情研判任务与事件的关联关系

---

## 推荐的最小可行路径（写死为主）

若要最快实现演示效果，建议按以下顺序写死补齐：

1. **Planner + Router**: 硬编码"订阅火情"意图 → 生成 subscription + fire-detector + news 的 plan
2. **Subscription capability**: 扩展接收 `region` 参数，存储到 queryParams
3. **Scheduler**: 执行 fire-detector 订阅时，生成 3 个硬编码 mock 火情事件写入 events
4. **前端 EventList**: 增加"选择并研判"按钮，点击后触发新 task
5. **Executor**: 新 task 执行 fire-detector（带选定事件参数），返回研判结果
6. **CesiumMap**: 增加 `showFireAnalysisResult()` 方法，展示火情点位+范围+风险等级（固定样式）
7. **taskResultFormatter**: 格式化展示研判报告

**无需做的（暂时跳过）**:
- 地图交互绘制区域（先用文本提取/固定区域）
- 真实卫星调度（模拟返回即可）
- 外部平台推送（先在前端展示完成状态）
