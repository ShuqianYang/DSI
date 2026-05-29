  第1步：Dify 平台
    ├── Planner Agent 提示词更新（加入 news 描述）
    ├── Router Agent 新增 news 工具（定义参数 schema）
    └── Insight Agent 提示词更新（加入 news 结果结构）

  第2步：本地代码（Mock 模式）
    ├── action.ts 新增 "news"
    ├── news.ts 能力实现（Mock 数据即可）
    ├── registry.ts 注册
    └── planner/service.ts + router/service.ts Mock 逻辑同步

  第3步：联调验证
    ├── 本地启动，Mock 模式测试 news 流程
    └── 确认 Dify Agent 输出的 ActionType 字符串与本地一致

  第4步：接入真实新闻 API
    ├── api/src/lib/news.ts 实现真实调用
    └── 配置 NEWS_API_KEY 环境变量

  第5步：Dify 生产环境验证
    └── 关闭 Mock，真实 Dify Agent 走完整流程

  │ 1    │ packages/shared/src/types/action.ts          │ 新增 "news" 到 ActionType enum  │ 无（底层类型）  │
  ├──────┼──────────────────────────────────────────────┼─────────────────────────────────┼─────────────────┤
  │ 2    │ api/src/modules/actions/capabilities/news.ts │ 新建，Mock 能力实现             │ 依赖类型定义    │
  ├──────┼──────────────────────────────────────────────┼─────────────────────────────────┼─────────────────┤
  │ 3    │ api/src/modules/actions/registry.ts          │ 导入并注册 newsCapability       │ 依赖 news.ts    │
  ├──────┼──────────────────────────────────────────────┼─────────────────────────────────┼─────────────────┤
  │ 4    │ api/src/modules/router/service.ts            │ 新增 news 意图检测（3 处）      │ 依赖 ActionType │
  ├──────┼──────────────────────────────────────────────┼─────────────────────────────────┼─────────────────┤
  │ 5    │ api/src/modules/planner/service.ts           │ mockGeneratePlan 中支持新闻计划 │ 无硬依赖     