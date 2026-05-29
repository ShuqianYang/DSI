'use client';

import { ChevronRight } from 'lucide-react';
import { Insight } from '@/types/prd';
import { formatFullTime, getRiskStyle, getCategoryLabel } from '@/lib/styleMaps';

interface InsightListProps {
  insights: Insight[];
  expandedInsight: string | null;
  setExpandedInsight: (id: string | null) => void;
  onInsightClick?: (insight: Insight) => void;
}

export default function InsightList({ insights, expandedInsight, setExpandedInsight, onInsightClick }: InsightListProps) {
  return (
    <>
      {insights.map((insight) => (
        <div
          key={insight.id}
          className={`p-2.5 rounded-lg bg-[#1E1E2E] border ${getRiskStyle(insight.riskLevel)} cursor-pointer hover:scale-[1.01] transition-all`}
          onClick={() => {
            setExpandedInsight(expandedInsight === insight.id ? null : insight.id);
            onInsightClick?.(insight);
          }}
        >
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs px-2 py-0.5 rounded bg-[#2A2A3E] text-[#8888AA]">
                  {getCategoryLabel(insight.category)}
                </span>
                <span
                  className={`text-xs px-2 py-0.5 rounded ${
                    insight.riskLevel === 'high'
                      ? 'bg-[#FF4444]/20 text-[#FF4444]'
                      : insight.riskLevel === 'medium'
                      ? 'bg-[#FFAA00]/20 text-[#FFAA00]'
                      : insight.riskLevel === 'low'
                      ? 'bg-[#FFFF44]/20 text-[#FFFF44]'
                      : 'bg-[#44FF44]/20 text-[#44FF44]'
                  }`}
                >
                  {insight.riskLevel === 'high'
                    ? '高危'
                    : insight.riskLevel === 'medium'
                    ? '中危'
                    : insight.riskLevel === 'low'
                    ? '低危'
                    : '安全'}
                </span>
              </div>
              <div className="text-sm text-[#EAEAEA] font-medium">{insight.title}</div>
              <div className="text-xs font-mono text-[#8888AA] mt-1">{formatFullTime(insight.timestamp)}</div>
            </div>
            <ChevronRight
              className={`w-4 h-4 text-[#8888AA] transition-transform ${
                expandedInsight === insight.id ? 'rotate-90' : ''
              }`}
            />
          </div>
          {expandedInsight === insight.id && (
            <div className="mt-3 pt-3 border-t border-[#3A3A4E]">
              <div className="text-sm text-[#EAEAEA]">{insight.content}</div>
              {insight.sources && insight.sources.length > 0 && (
                <div className="mt-3">
                  <div className="text-xs text-[#8888AA] mb-1">数据来源</div>
                  <div className="flex flex-wrap gap-1">
                    {insight.sources.map((source) => (
                      <span
                        key={source}
                        className="text-xs px-2 py-0.5 rounded bg-[#2A2A3E] text-[#00E0FF]"
                      >
                        {source}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      ))}
      {insights.length === 0 && (
        <div className="text-center py-4 text-[#8888AA] text-xs">
          暂无洞察
        </div>
      )}
    </>
  );
}
