type Formatter = (actionId: string, r: Record<string, unknown>) => string;

function detectActionType(r: Record<string, unknown>): string {
  if (r.region && r.vessels) return 'maritime';
  if (r.report_content) return 'daily_report';
  if (r.message || r.table) return 'satellite';
  if (r.articles && Array.isArray(r.articles)) return 'news';
  if (r.summary && (r.summary as Record<string, unknown>).fireDetected === true) return 'fire';
  return 'generic';
}

const formatters: Record<string, Formatter> = {
  maritime: (_actionId, r) => {
    const parts: string[] = [];
    const region = r.region as string;
    const summary = r.summary as Record<string, unknown> | undefined;
    const vessels = r.vessels as Array<Record<string, unknown>>;
    const risk = summary?.riskAssessment as string;
    parts.push(`## ${region}海域态势分析\n`);
    if (risk) parts.push(`${risk}\n`);
    if (summary) {
      parts.push(`- 总船舶数：${summary.totalVessels || vessels.length}`);
      parts.push(`- 高风险：${summary.dangerCount || 0}`);
      parts.push(`- 警告：${summary.warningCount || 0}`);
      parts.push(`- 正常：${summary.normalCount || 0}`);
    }
    if (vessels?.length > 0) {
      parts.push('\n**重点船舶：**');
      vessels.forEach((v) => {
        const speedText = v.speed != null ? `${v.speed}节` : '—';
        const headingText = v.heading != null ? `${v.heading}°` : '—';
        const statusText = v.status || '—';
        parts.push(`- **${v.name}** (${v.type}) — 航速 ${speedText}，航向 ${headingText}，状态：${statusText}`);
      });
    }
    parts.push('');
    return parts.join('\n');
  },

  daily_report: (_actionId, r) => {
    const parts: string[] = [];
    const content = r.report_content as string;
    const stats = r.stats as Record<string, unknown> | undefined;
    const date = r.date as string;
    if (date) parts.push(`## 安防日报 ${date}\n`);
    else parts.push(`## 分析结果\n`);
    parts.push(content);
    if (stats) {
      parts.push('\n**统计：**');
      for (const [k, v] of Object.entries(stats)) {
        parts.push(`- ${k}：${v}`);
      }
    }
    parts.push('');
    return parts.join('\n');
  },

  satellite: (_actionId, r) => {
    const parts: string[] = [];
    parts.push(`## 天基数据查询\n`);
    if (r.message) parts.push(r.message as string);
    if (r.table) parts.push(`\n\`\`\`\n${r.table}\n\`\`\``);
    parts.push('');
    return parts.join('\n');
  },

  news: (_actionId, r) => {
    const parts: string[] = [];
    const summary = r.summary as Record<string, unknown> | undefined;
    const articles = r.articles as Array<Record<string, unknown>>;
    const trends = r.trends as Array<Record<string, unknown>> | undefined;
    const query = r.query as string;

    parts.push(`## 实时新闻查询${query ? `：${query}` : ''}\n`);
    if (summary?.overview) parts.push(`${summary.overview}\n`);
    if (summary?.totalFound) {
      parts.push(`- 共检索到 ${summary.totalFound} 条，返回 ${summary.totalReturned || articles.length} 条`);
      parts.push(`- 时间范围：${summary.timeSpan || '近期'}`);
      parts.push('');
    }
    if (articles.length > 0) {
      parts.push('**重点报道：**\n');
      articles.slice(0, 5).forEach((a, i) => {
        const relevance = a.relevanceScore ? `（相关度 ${(a.relevanceScore as number * 100).toFixed(0)}%）` : '';
        parts.push(`${i + 1}. **${a.title}** — ${a.source}${relevance}`);
        if (a.summary) parts.push(`   ${a.summary}`);
      });
      parts.push('');
    }
    if (trends && trends.length > 0) {
      parts.push('**趋势分析：**\n');
      trends.forEach((t) => {
        const sentimentMap: Record<string, string> = { negative: '负面', positive: '正面', neutral: '中性' };
        const sentiment = sentimentMap[t.sentiment as string] || (t.sentiment as string);
        parts.push(`- **${t.topic}**：${t.description}（${sentiment}，${t.articleCount}篇）`);
      });
      parts.push('');
    }
    return parts.join('\n');
  },

  fire: (_actionId, r) => {
    const parts: string[] = [];
    const summary = r.summary as Record<string, unknown> | undefined;
    parts.push('## 火灾检测结果\n');
    if (summary?.riskAssessment) {
      parts.push(`${summary.riskAssessment}\n`);
    }
    if (summary) {
      parts.push(`- **位置**：${summary.location || '未知'}`);
      parts.push(`- **中心坐标**：${(summary.centerCoordinates as number[])?.join(', ') || '未知'}`);
      parts.push(`- **烧毁面积**：${summary.burnedAreaHectares || '未知'} 公顷`);
      parts.push(`- **置信度**：${summary.confidence || '未知'}`);
      parts.push(`- **火灾类型**：${summary.fireType || '未知'}`);
    }
    parts.push('');
    return parts.join('\n');
  },

  generic: (actionId, r) => {
    const parts: string[] = [];
    parts.push(`## 执行结果 (${actionId})\n`);
    parts.push('```json\n' + JSON.stringify(r, null, 2) + '\n```');
    parts.push('');
    return parts.join('\n');
  },
};

export function formatTaskResult(result: Record<string, unknown> | null): string {
  if (!result || Object.keys(result).length === 0) {
    return '任务执行完成，暂无详细结果。';
  }

  // Agent loop 模式：result.message 已经是 LLM 生成的 markdown，直接展示
  if (result.mode === 'agent_loop') {
    const message = result.message as string;
    return message?.trim() || '任务执行完成。';
  }

  const parts: string[] = [];
  for (const [actionId, actionResult] of Object.entries(result)) {
    const r = actionResult as Record<string, unknown>;
    const type = detectActionType(r);
    const formatter = formatters[type] || formatters.generic;
    parts.push(formatter(actionId, r));
  }
  return parts.join('\n');
}
