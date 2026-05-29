import { ThinkingStep, GisData } from '@/types/prd';

export const mockThinkingResponses: Record<
  string,
  {
    content: string;
    thinking: string;
    thinkingSteps: ThinkingStep[];
    hasGisData?: boolean;
    gisData?: GisData;
  }
> = {
  '分析东海近期态势': {
    thinking: `用户请求分析东海近期态势。\n\n1. 识别查询意图：区域态势概览 + 实时告警聚合 + 趋势判断。\n2. 确定数据源：AIS实时信号、雷达网、监测基站、卫星遥感。\n3. 关联当前活跃告警：商船_Voyager_01 逼近管控区（一级预警）。\n4. 统计近24小时数据：船舶活动量、异常轨迹数、告警触发次数。\n5. 评估整体风险等级：中等（存在1个一级预警）。`,
    thinkingSteps: [
      { id: 's1', name: '意图解析', status: 'completed', detail: '识别为「区域态势概览」查询', duration: 180 },
      { id: 's2', name: '数据聚合', status: 'completed', detail: '聚合AIS、雷达、基站、卫星共4路数据源', duration: 920 },
      { id: 's3', name: '告警关联', status: 'completed', detail: '关联1个一级预警、2个二级提示', duration: 450 },
      { id: 's4', name: '趋势计算', status: 'completed', detail: '对比昨日同期：船舶活动量+12%，异常轨迹+3条', duration: 680 },
      { id: 's5', name: '风险评级', status: 'completed', detail: '综合风险等级：中等', duration: 320 },
    ],
    content: `**东海近期态势简报**\n\n当前整体风险等级：⚠️ 中等\n\n**实时概况：**\n- 活跃船舶：247艘（较昨日+12%）\n- 异常轨迹：5条（新增3条）\n- 告警状态：1个一级预警、2个二级提示\n\n**重点目标：**\n- 商船_Voyager_01 距离管控区边界12海里，航速14节，持续逼近中\n- 不明渔船_Fishing_X 未开启AIS，轨迹可疑\n\n**建议：**\n1. 对商船_Voyager_01 保持一级跟踪\n2. 派遣巡逻艇前出查证不明渔船\n3. 北部监测区加强雷达扫描频率`,
    gisData: {
      type: 'entity' as const,
      entities: [
        {
          id: 'entity-001',
          name: '商船_Voyager_01',
          type: 'ship' as const,
          coordinates: [122.5, 31.2] as [number, number],
          importance: 'high' as const,
          status: 'warning' as const,
          description: '当前位置：东海海域，距离我管控区边界约12海里',
        },
      ],
      trajectories: [
        {
          id: 'traj-001',
          name: '商船_Voyager_01_航行轨迹',
          type: 'route' as const,
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
          ] as [number, number][],
          status: 'realtime' as const,
        },
      ],
      regions: [
        {
          id: 'region-001',
          name: '东海管控区',
          type: 'control' as const,
          coordinates: [
            [120.0, 30.0],
            [124.0, 30.0],
            [124.0, 33.0],
            [120.0, 33.0],
          ] as [number, number][],
          rules: '禁止未授权船舶进入，违者将受到警告或拦截',
        },
      ],
    },
  },
};

export function getMockResponse(input: string): {
  content: string;
  thinking: string;
  thinkingSteps: ThinkingStep[];
  gisData?: GisData;
} {
  const key = Object.keys(mockThinkingResponses).find(
    (k) => input.includes(k) || k.includes(input)
  );
  if (key) {
    const resp = mockThinkingResponses[key];
    return {
      content: resp.content,
      thinking: resp.thinking,
      thinkingSteps: resp.thinkingSteps,
      gisData: resp.gisData,
    };
  }

  return {
    content: `收到您的问题：「${input}」\n\n我已启动分析流程，根据当前系统数据：\n- 关联到相关实体 2 个\n- 匹配历史告警 1 条\n- 数据源覆盖：AIS、雷达、监测站\n\n**初步结论：**\n暂无重大异常发现，整体态势平稳。\n\n如需更深入的分析，我可以为您生成专项报告或启动定时监测任务。`,
    thinking: `用户输入了一个通用查询。\n\n1. 尝试意图识别：未匹配到精确模板，按「通用查询」处理。\n2. 关键词提取：提取地名、实体名、时间等关键信息。\n3. 多数据源模糊检索。\n4. 统计关联结果，生成摘要。`,
    thinkingSteps: [
      { id: 's1', name: '意图解析', status: 'completed', detail: '未匹配精确模板，按通用查询处理', duration: 200 },
      { id: 's2', name: '关键词提取', status: 'completed', detail: '提取关键信息用于检索', duration: 180 },
      { id: 's3', name: '数据检索', status: 'completed', detail: '多数据源模糊匹配', duration: 560 },
      { id: 's4', name: '结果汇总', status: 'completed', detail: '生成初步结论', duration: 310 },
    ],
  };
}
