import {
  User,
  ChatMessage,
  Alert,
  Notification,
  Task,
  Subscription,
  Insight,
  UnfinishedRequirement,
  Entity,
  Trajectory,
  Region,
  TaskEvent,
} from '@/types/prd';

// 模拟用户数据
export const mockUser: User = {
  id: 'user-001',
  name: '张明',
  phone: '138****8888',
  email: 'zhangming@company.com',
  organization: '情报分析中心',
  role: '高级分析师',
};

// 模拟实体数据
export const mockEntities: Entity[] = [
  {
    id: 'entity-001',
    name: '商船_Voyager_01',
    type: 'ship',
    coordinates: [122.5, 31.2],
    importance: 'high',
    status: 'warning',
    description: '当前位置：东海海域，距离我管控区边界约15海里',
  },
  {
    id: 'entity-002',
    name: '民航客机_CA1234',
    type: 'aircraft',
    coordinates: [116.3, 39.9],
    importance: 'medium',
    status: 'normal',
    description: '正常飞行，高度10800米，预计30分钟后降落',
  },
  {
    id: 'entity-003',
    name: '监测基站_BS_North',
    type: 'base',
    coordinates: [121.4, 31.2],
    importance: 'high',
    status: 'normal',
    description: '正常工作中，已连接23个终端',
  },
];

// 模拟轨迹数据
export const mockTrajectories: Trajectory[] = [
  {
    id: 'traj-001',
    name: '商船_Voyager_01_航行轨迹',
    type: 'route',
    coordinates: [
      [118.5, 24.5],
      [119.2, 25.8],
      [120.0, 27.2],
      [120.8, 28.5],
      [121.2, 29.5],
      [121.5, 30.2],
      [122.0, 30.8],
      [122.3, 31.0],
      [122.5, 31.2],
      [122.8, 31.5],
    ],
    timestamps: [
      Date.now() - 9000000,
      Date.now() - 8000000,
      Date.now() - 7000000,
      Date.now() - 6000000,
      Date.now() - 5000000,
      Date.now() - 4000000,
      Date.now() - 3000000,
      Date.now() - 2000000,
      Date.now() - 1000000,
      Date.now() - 300000,
    ],
    status: 'realtime',
  },
  {
    id: 'traj-002',
    name: '通信线路_B-Link_01',
    type: 'communication',
    coordinates: [
      [115.8, 30.2],
      [117.2, 30.5],
      [118.6, 30.8],
      [119.8, 31.0],
      [120.6, 31.2],
      [121.0, 31.4],
      [121.4, 31.5],
      [121.8, 31.5],
      [122.2, 31.5],
      [122.6, 31.4],
    ],
    status: 'realtime',
  },
  {
    id: 'traj-003',
    name: '预警航线_W-Zone_A',
    type: 'warning',
    coordinates: [
      [123.5, 29.0],
      [123.8, 29.5],
      [124.0, 30.0],
      [124.2, 30.5],
      [124.5, 31.0],
      [124.8, 31.5],
      [125.0, 32.0],
      [125.2, 32.5],
    ],
    status: 'realtime',
  },
];

// 模拟区域数据
export const mockRegions: Region[] = [
  {
    id: 'region-001',
    name: '东海管控区',
    type: 'control',
    coordinates: [
      [120.0, 30.0],
      [124.0, 30.0],
      [124.0, 33.0],
      [120.0, 33.0],
    ],
    rules: '禁止未授权船舶进入，违者将受到警告或拦截',
  },
  {
    id: 'region-002',
    name: '北部监测区',
    type: 'monitor',
    coordinates: [
      [115.0, 35.0],
      [120.0, 35.0],
      [120.0, 40.0],
      [115.0, 40.0],
    ],
  },
];

// 模拟告警数据
export const mockAlerts: Alert[] = [
  {
    id: 'alert-001',
    title: '商船逼近管控区边界',
    level: 'high',
    timestamp: Date.now() - 1800000,
    entityId: 'entity-001',
    description: '商船_Voyager_01正在逼近东海管控区边界，当前距离15海里，预计1小时后进入',
    isRead: false,
  },
  {
    id: 'alert-002',
    title: '通信异常检测',
    level: 'medium',
    timestamp: Date.now() - 3600000,
    entityId: 'entity-003',
    description: '监测基站_BS_North检测到异常通信信号，已启动深度分析',
    isRead: false,
  },
];

// 模拟通知数据
export const mockNotifications: Notification[] = [
  {
    id: 'notif-001',
    type: 'tip',
    title: '定时任务已完成',
    timestamp: Date.now() - 7200000,
    taskId: 'task-001',
    status: '已完成',
    content: '您的《每日态势日报》已生成，可在已完成任务中查看',
  },
  {
    id: 'notif-002',
    type: 'system',
    title: '系统升级通知',
    timestamp: Date.now() - 86400000,
    content: '系统将于本周六02:00-06:00进行升级维护，届时部分功能将暂时不可用',
  },
];

// 模拟任务数据
export const mockTasks: Task[] = [
  {
    id: 'task-001',
    name: '每日态势日报',
    type: 'daily',
    executeTime: Date.now() - 7200000,
    status: 'completed',
    dataCount: 156,
    subTasks: [
      { id: 'sub-001-1', name: '数据采集', status: 'completed', order: 1 },
      { id: 'sub-001-2', name: '数据清洗', status: 'completed', order: 2 },
      { id: 'sub-001-3', name: '态势分析', status: 'completed', order: 3 },
      { id: 'sub-001-4', name: '报告生成', status: 'completed', order: 4 },
      { id: 'sub-001-5', name: '结果推送', status: 'completed', order: 5 },
    ],
  },
  {
    id: 'task-002',
    name: '区域监测周报',
    type: 'weekly',
    executeTime: Date.now() - 172800000,
    status: 'completed',
    dataCount: 892,
    subTasks: [
      { id: 'sub-002-1', name: '区域数据汇总', status: 'completed', order: 1 },
      { id: 'sub-002-2', name: '异常事件筛选', status: 'completed', order: 2 },
      { id: 'sub-002-3', name: '趋势对比分析', status: 'completed', order: 3 },
      { id: 'sub-002-4', name: '风险评估计算', status: 'completed', order: 4 },
      { id: 'sub-002-5', name: '周报排版输出', status: 'completed', order: 5 },
      { id: 'sub-002-6', name: '领导审批推送', status: 'completed', order: 6 },
    ],
  },
  {
    id: 'task-003',
    name: '商船轨迹实时追踪',
    type: 'realtime',
    executeTime: Date.now() - 300000,
    status: 'running',
    dataCount: 48,
    subTasks: [
      { id: 'sub-003-1', name: 'AIS信号接入', status: 'completed', order: 1 },
      { id: 'sub-003-2', name: '目标识别匹配', status: 'completed', order: 2 },
      { id: 'sub-003-3', name: '轨迹点采集', status: 'running', order: 3 },
      { id: 'sub-003-4', name: '轨迹预测计算', status: 'pending', order: 4 },
      { id: 'sub-003-5', name: '越界告警判定', status: 'pending', order: 5 },
    ],
  },
  {
    id: 'task-004',
    name: '北部监测区深度分析',
    type: 'daily',
    executeTime: Date.now() - 1800000,
    status: 'failed',
    dataCount: 0,
    subTasks: [
      { id: 'sub-004-1', name: '监测站连通性检查', status: 'completed', order: 1 },
      { id: 'sub-004-2', name: '遥感图像获取', status: 'failed', order: 2 },
      { id: 'sub-004-3', name: '图像解译分析', status: 'pending', order: 3 },
      { id: 'sub-004-4', name: '目标特征提取', status: 'pending', order: 4 },
    ],
  },
  {
    id: 'task-005',
    name: '能源运输航线评估',
    type: 'weekly',
    executeTime: Date.now() - 3600000,
    status: 'partial',
    dataCount: 320,
    subTasks: [
      { id: 'sub-005-1', name: '航线历史数据加载', status: 'completed', order: 1 },
      { id: 'sub-005-2', name: '当前航速航向分析', status: 'completed', order: 2 },
      { id: 'sub-005-3', name: '气象海况数据融合', status: 'completed', order: 3 },
      { id: 'sub-005-4', name: '海盗风险区域匹配', status: 'completed', order: 4 },
      { id: 'sub-005-5', name: '马六甲海峡段评估', status: 'failed', order: 5 },
      { id: 'sub-005-6', name: '替代航线推荐', status: 'running', order: 6 },
      { id: 'sub-005-7', name: '综合评分输出', status: 'pending', order: 7 },
    ],
  },
];

// 模拟订阅数据
export const mockSubscriptions: Subscription[] = [
  {
    id: 'sub-001',
    name: '伊朗最新态势跟踪',
    type: '定时推送',
    schedule: '每天07:00',
    nextExecuteTime: Date.now() + 43200000,
    status: 'running',
  },
  {
    id: 'sub-002',
    name: '商船轨迹监测',
    type: '实时告警',
    schedule: '实时',
    nextExecuteTime: Date.now(),
    status: 'running',
    entityId: 'entity-001',
  },
  {
    id: 'sub-003',
    name: '区域风险评估',
    type: '定时推送',
    schedule: '每周一09:00',
    nextExecuteTime: Date.now() + 259200000,
    status: 'paused',
  },
];

// 模拟洞察数据
export const mockInsights: Insight[] = [
  {
    id: 'insight-001',
    category: 'geopolitics',
    title: '东亚海域紧张局势升温',
    summary: '近期东海海域船舶活动异常增加，建议加强监测',
    timestamp: Date.now() - 3600000,
    riskLevel: 'high',
    regionId: 'region-001',
    content: '根据最新开源情报分析，东亚海域近期出现多艘不明国籍船舶活动频繁的情况。建议相关部门加强该区域的监测和巡逻力量，同时密切关注相关国家的外交动态。',
    sources: ['开源情报A', 'AIS数据', '卫星图像'],
  },
  {
    id: 'insight-002',
    category: 'military',
    title: '军事演习区域划定',
    summary: '某海域宣布军事演习，可能影响民用航运',
    timestamp: Date.now() - 7200000,
    riskLevel: 'medium',
    content: '根据公开信息，某国宣布在指定海域进行为期一周的军事演习。建议提前通知相关航运公司调整航线，避免不必要的风险。',
  },
  {
    id: 'insight-003',
    category: 'industry',
    title: '能源运输航线安全评估',
    summary: '液化天然气运输航线风险等级下降',
    timestamp: Date.now() - 14400000,
    riskLevel: 'low',
    content: '经过综合分析，当前能源运输航线整体风险等级为低。建议继续保持现有监测力度。',
  },
];

// 事件关联的GIS实体数据（日报发现的异常目标）
export const eventEntities001: Entity[] = [
  {
    id: 'entity-event-001',
    name: '不明渔船_Fishing_X',
    type: 'ship',
    coordinates: [123.8, 30.5],
    importance: 'high',
    status: 'danger',
    description: '日报识别出的异常渔船，未开启AIS应答，正在向管控区移动',
  },
  {
    id: 'entity-event-002',
    name: '侦察机_Patrol_R1',
    type: 'aircraft',
    coordinates: [125.2, 32.1],
    importance: 'high',
    status: 'warning',
    description: '在东部海域低空盘旋飞行，已持续45分钟',
  },
];

// 事件关联的轨迹数据（异常轨迹）
export const eventTrajectories001: Trajectory[] = [
  {
    id: 'traj-event-001',
    name: '不明渔船异常轨迹',
    type: 'warning',
    coordinates: [
      [121.0, 28.5],
      [122.0, 29.2],
      [122.8, 29.8],
      [123.5, 30.2],
      [123.8, 30.5],
    ],
    timestamps: [
      Date.now() - 10800000,
      Date.now() - 9000000,
      Date.now() - 7200000,
      Date.now() - 5400000,
      Date.now() - 3600000,
    ],
    status: 'realtime',
  },
];

// 事件关联的GIS实体数据（能源运输航线）
export const eventEntities004: Entity[] = [
  {
    id: 'entity-event-003',
    name: 'LNG运输船_Energy_01',
    type: 'ship',
    coordinates: [103.5, 1.2],
    importance: 'medium',
    status: 'normal',
    description: '液化天然气运输船，当前位于马六甲海峡东口',
  },
  {
    id: 'entity-event-004',
    name: '护航舰_Escort_N1',
    type: 'ship',
    coordinates: [103.8, 1.5],
    importance: 'medium',
    status: 'normal',
    description: '商船护航舰艇，保持5海里警戒距离',
  },
];

export const eventTrajectories004: Trajectory[] = [
  {
    id: 'traj-event-002',
    name: '能源运输推荐航线',
    type: 'route',
    coordinates: [
      [100.5, 2.5],
      [101.5, 2.2],
      [102.5, 1.8],
      [103.5, 1.2],
      [104.5, 0.8],
      [105.5, 0.5],
      [106.5, 0.2],
    ],
    status: 'history',
  },
];

// 模拟任务事件数据
export const mockTaskEvents: TaskEvent[] = [
  {
    id: 'event-001',
    taskId: 'task-001',
    taskName: '每日态势日报',
    title: '日报生成成功',
    content: '《每日态势日报》已生成，共处理156条数据，发现异常轨迹3条，其中2个高风险目标需重点关注。',
    status: 'success',
    timestamp: Date.now() - 7200000,
    read: false,
    gisData: {
      type: 'entity',
      entities: eventEntities001,
      trajectories: eventTrajectories001,
    },
  },
  {
    id: 'event-002',
    taskId: 'task-003',
    taskName: '商船轨迹实时追踪',
    title: '轨迹追踪进行中',
    content: '已锁定目标商船，当前距离管控区边界12海里，持续监测中。目标航向东南，航速14节。',
    status: 'partial',
    timestamp: Date.now() - 300000,
    read: false,
    gisData: {
      type: 'entity',
      entities: [mockEntities[0]],
      trajectories: [mockTrajectories[0]],
    },
  },
  {
    id: 'event-003',
    taskId: 'task-004',
    taskName: '北部监测区深度分析',
    title: '任务执行失败',
    content: '数据源连接超时，北部监测站数据获取失败，请检查网络配置',
    status: 'failed',
    timestamp: Date.now() - 1800000,
    read: true,
  },
  {
    id: 'event-004',
    taskId: 'task-005',
    taskName: '能源运输航线评估',
    title: '评估部分完成',
    content: '已完成80%航线评估，马六甲海峡段数据缺失，已使用历史数据补全。发现2艘护航目标。',
    status: 'partial',
    timestamp: Date.now() - 3600000,
    read: false,
    gisData: {
      type: 'entity',
      entities: eventEntities004,
      trajectories: eventTrajectories004,
    },
  },
  {
    id: 'event-005',
    taskId: 'task-002',
    taskName: '区域监测周报',
    title: '周报生成成功',
    content: '《区域监测周报》已生成，共处理892条数据，生成风险报告5份',
    status: 'success',
    timestamp: Date.now() - 172800000,
    read: true,
  },
  {
    id: 'event-006',
    taskId: 'task-003',
    taskName: '商船轨迹实时追踪',
    title: '告警触发：目标接近管控区',
    content: '商船_Voyager_01已进入管控区20海里警戒范围，触发一级预警。建议立即派遣巡逻艇前出查证。',
    status: 'partial',
    timestamp: Date.now() - 600000,
    read: false,
    gisData: {
      type: 'entity',
      entities: [
        {
          id: 'entity-event-005',
          name: '巡逻艇_Guard_09',
          type: 'ship',
          coordinates: [121.8, 30.8],
          importance: 'high',
          status: 'normal',
          description: '已派遣前出查证，预计25分钟后抵达目标位置',
        },
      ],
      trajectories: [
        {
          id: 'traj-event-003',
          name: '巡逻艇前出航线',
          type: 'route',
          coordinates: [
            [121.0, 31.5],
            [121.3, 31.2],
            [121.5, 31.0],
            [121.8, 30.8],
          ],
          status: 'realtime',
        },
      ],
      regions: [mockRegions[0]],
    },
  },
];

// 模拟未完成需求
export const mockUnfinishedRequirements: UnfinishedRequirement[] = [
  {
    id: 'req-001',
    userId: 'user-001',
    timestamp: Date.now() - 86400000,
    description: '需要获取特定海域的历史气象数据',
    chatId: 'chat-005',
    status: 'pending',
    requirementId: 'REQ-2026-001',
  },
];

// 模拟对话记录
export const mockChatHistory: ChatMessage[] = [
  {
    id: 'chat-001',
    role: 'user',
    content: '请分析一下最近一周东海海域的船舶活动情况',
    timestamp: Date.now() - 86400000,
    hasGisData: true,
  },
  {
    id: 'chat-002',
    role: 'assistant',
    content: `根据过去一周的数据分析，东海海域共监测到各类船舶活动约3,200次。

**主要发现：**
1. 正常航运活动占78%，整体秩序良好
2. 发现可疑航行轨迹12条，已标记并持续跟踪
3. 商船_Voyager_01曾在管控区边界附近徘徊，已发送询问信号

**建议：**
- 加强对北部监测区的巡逻力度
- 持续关注商船_Voyager_01的动向
- 如需详细报告，我可以生成一份完整的分析报告`,
    timestamp: Date.now() - 86400000 + 5000,
    hasGisData: true,
    gisData: {
      type: 'entity',
      entities: [mockEntities[0]],
      trajectories: [mockTrajectories[0]],
      regions: [mockRegions[0]],
    },
    thinking: `用户想了解东海海域最近一周的船舶活动情况。\n\n1. 首先识别到查询意图：海域态势分析 + 时间范围（最近一周）+ 区域（东海）+ 对象（船舶）。\n2. 需要从多个数据源聚合：AIS信号、雷达监测、卫星遥感、岸基监测站。\n3. 关联已知实体：商船_Voyager_01 有异常轨迹，需要重点标注。\n4. 生成统计摘要和GIS可视化数据。`,
    thinkingSteps: [
      { id: 'step-1', name: '意图解析', status: 'completed', detail: '识别为「海域态势统计分析」类型查询，区域=东海，时间范围=7天', duration: 320 },
      { id: 'step-2', name: '数据源定位', status: 'completed', detail: '匹配到 AIS数据库、雷达监测日志、卫星遥感数据（Sentinel-2）', duration: 480 },
      { id: 'step-3', name: '数据聚合', status: 'completed', detail: '共检索到3,247条船舶记录，去重后有效记录3,200条', duration: 1250 },
      { id: 'step-4', name: '异常检测', status: 'completed', detail: '通过轨迹偏离算法识别出12条可疑轨迹，其中1个高风险目标', duration: 890 },
      { id: 'step-5', name: 'GIS数据组装', status: 'completed', detail: '生成实体标记、轨迹线、管控区域面数据', duration: 560 },
      { id: 'step-6', name: '生成结论', status: 'completed', detail: '输出统计摘要与建议', duration: 340 },
    ],
    isThinkingExpanded: false,
  },
  {
    id: 'chat-003',
    role: 'user',
    content: '能给我生成一份日报吗？',
    timestamp: Date.now() - 43200000,
  },
  {
    id: 'chat-004',
    role: 'assistant',
    content: `好的，我已为您创建《每日态势日报》订阅任务。

**任务详情：**
- 任务名称：每日态势日报
- 执行时间：每天早上07:00
- 推送方式：应用内消息
- 报告内容：涵盖海域态势、异常告警、热点分析等

日报将在明天早上7点首次推送，您可以在「已完成任务」中查看历史报告。`,
    timestamp: Date.now() - 43200000 + 3000,
    thinking: `用户请求生成日报。\n\n1. 识别到这是一个「订阅任务创建」请求，而非即时报告需求。\n2. 检查用户权限：当前用户具有高级分析师权限，可以创建定时任务。\n3. 匹配默认日报模板：每日态势日报模板包含海域态势、异常告警、热点分析。\n4. 设定执行时间：默认每天早上07:00，与用户历史偏好一致。`,
    thinkingSteps: [
      { id: 'step-1', name: '意图解析', status: 'completed', detail: '识别为「定时订阅任务创建」', duration: 210 },
      { id: 'step-2', name: '权限校验', status: 'completed', detail: '用户权限：高级分析师，允许创建定时任务', duration: 150 },
      { id: 'step-3', name: '模板匹配', status: 'completed', detail: '匹配「每日态势日报」标准模板', duration: 280 },
      { id: 'step-4', name: '任务注册', status: 'completed', detail: '任务ID=task-001，调度策略=每日07:00', duration: 420 },
    ],
    isThinkingExpanded: false,
  },
  {
    id: 'chat-005',
    role: 'user',
    content: '帮我查一下商船 Voyager 01 现在的位置和状态',
    timestamp: Date.now() - 18000000,
    hasGisData: true,
  },
  {
    id: 'chat-006',
    role: 'assistant',
    content: `已为您查询到商船_Voyager_01的实时状态：

**当前状态：⚠️ 警告**
- 实时位置：东经122.5°，北纬31.2°
- 当前航向：东南偏南（156°）
- 当前航速：14节
- 距离东海管控区边界：约12海里
- 状态变化：距离从15海里缩短至12海里，正在逼近

**历史轨迹：**
该船自昨日18:00起从外海驶入，轨迹显示有异常绕航行为。此前发送的询问信号未收到回复。

**建议：**
- 持续锁定跟踪，已触发一级预警
- 建议在距离10海里时进行二次呼叫
- 如需派遣巡逻艇前出查证，请告知`,
    timestamp: Date.now() - 18000000 + 4000,
    hasGisData: true,
    gisData: {
      type: 'entity',
      entities: [mockEntities[0]],
      trajectories: [mockTrajectories[0]],
    },
    thinking: `用户想查询特定实体「商船 Voyager 01」的实时状态。\n\n1. 实体名称模糊匹配：输入"Voyager 01" → 匹配到系统内注册实体「商船_Voyager_01」(ID: entity-001)。\n2. 查询实时数据流：AIS最后信号 2分钟前，坐标 (122.5, 31.2)。\n3. 关联告警：该实体当前处于 warning 状态，已触发 alert-001。\n4. 计算与管控区边界距离：12海里，较上次记录减少3海里。\n5. 调取历史轨迹：最近10个轨迹点，判断为异常逼近行为。`,
    thinkingSteps: [
      { id: 'step-1', name: '实体匹配', status: 'completed', detail: '模糊匹配「Voyager 01」→ 商船_Voyager_01（置信度99%）', duration: 180 },
      { id: 'step-2', name: '实时数据查询', status: 'completed', detail: '获取AIS最新信号：坐标(122.5, 31.2)，航速14节，航向156°', duration: 560 },
      { id: 'step-3', name: '关联告警', status: 'completed', detail: '关联到告警 alert-001：商船逼近管控区边界', duration: 320 },
      { id: 'step-4', name: '边界距离计算', status: 'completed', detail: '计算到东海管控区边界最近距离：12海里（持续缩小中）', duration: 420 },
      { id: 'step-5', name: '轨迹分析', status: 'completed', detail: '提取最近10个轨迹点，判定为「异常逼近」模式', duration: 680 },
      { id: 'step-6', name: '生成响应', status: 'completed', detail: '组装实体卡片、轨迹数据、预警建议', duration: 280 },
    ],
    isThinkingExpanded: false,
  },
  {
    id: 'chat-007',
    role: 'user',
    content: '评估一下马六甲海峡东口的能源运输风险',
    timestamp: Date.now() - 3600000,
    hasGisData: true,
  },
  {
    id: 'chat-008',
    role: 'assistant',
    content: `能源运输航线风险评估报告（马六甲海峡东口）：

**评估概览：**
- 评估航线：LNG运输船_Energy_01 当前航段
- 风险等级：中等偏低
- 综合评分：72/100（安全阈值：60）

**分项评估：**
| 维度 | 评分 | 状态 |
|------|------|------|
| 海盗风险 | 85 | 良好 |
| 气象海况 | 68 | 一般 |
| 航道拥堵 | 70 | 一般 |
| 护航覆盖 | 90 | 优秀 |

**当前发现：**
- LNG运输船_Energy_01 位于马六甲海峡东口（103.5°E, 1.2°N）
- 护航舰_Escort_N1 保持5海里警戒距离
- 该段历史海盗事件密度较低

**建议：**
- 继续沿推荐航线航行
- 注意夜间保持AIS开启
- 如遇异常船只接近，立即呼叫护航舰`,
    timestamp: Date.now() - 3600000 + 6000,
    hasGisData: true,
    gisData: {
      type: 'entity',
      entities: [eventEntities004[0], eventEntities004[1]],
      trajectories: [eventTrajectories004[0]],
    },
    thinking: `用户请求对马六甲海峡东口的能源运输风险进行评估。\n\n1. 识别评估对象：能源运输航线 + 特定区域（马六甲海峡东口）。\n2. 关联在航实体：LNG运输船_Energy_01 当前位于该海域，且有护航舰伴随。\n3. 多维度风险模型计算：\n   - 海盗风险：基于历史事件密度、时段、区域治安评分\n   - 气象海况：融合实时气象数据与预报\n   - 航道拥堵：AIS船舶密度统计\n   - 护航覆盖：护航舰距离与响应能力\n4. 综合加权评分：72/100，属安全范围。\n5. 调取推荐航线数据用于GIS展示。`,
    thinkingSteps: [
      { id: 'step-1', name: '意图解析', status: 'completed', detail: '识别为「航线风险评估」，区域=马六甲海峡东口，对象=能源运输船', duration: 260 },
      { id: 'step-2', name: '实体定位', status: 'completed', detail: '匹配到 LNG运输船_Energy_01 及护航舰_Escort_N1', duration: 380 },
      { id: 'step-3', name: '海盗风险计算', status: 'completed', detail: '历史事件密度=0.2起/月，评分85分（低风险）', duration: 720 },
      { id: 'step-4', name: '气象海况融合', status: 'completed', detail: '当前浪高1.2m，能见度8海里，评分68分', duration: 580 },
      { id: 'step-5', name: '航道拥堵分析', status: 'completed', detail: '当前AIS密度12艘/10km²，评分70分', duration: 450 },
      { id: 'step-6', name: '护航覆盖评估', status: 'completed', detail: '护航舰距离5海里，响应时间15分钟，评分90分', duration: 340 },
      { id: 'step-7', name: '综合评分与输出', status: 'completed', detail: '加权综合评分72/100，生成评估报告与GIS数据', duration: 410 },
    ],
    isThinkingExpanded: false,
  },
];
