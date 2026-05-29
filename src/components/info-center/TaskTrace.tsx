'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, CheckCircle2, XCircle, Loader2, CircleDot } from 'lucide-react';
import type { getTask } from '@/lib/api';

interface TaskTraceProps {
  task: Awaited<ReturnType<typeof getTask>>;
}

const STATUS_ICON: Record<string, React.ReactNode> = {
  completed: <CheckCircle2 className="w-4 h-4 text-[#44FF44]" />,
  failed: <XCircle className="w-4 h-4 text-[#FF4444]" />,
  running: <Loader2 className="w-4 h-4 text-[#00E0FF] animate-spin" />,
  pending: <CircleDot className="w-4 h-4 text-[#8888AA]" />,
};

const ACTION_TYPE_LABEL: Record<string, string> = {
  maritime: '船舶数据采集',
  'ais-fetch': 'AIS 数据获取',
  'ais-match-suspects': '嫌疑匹配',
  'ais-suspect-ranking': '嫌疑排序',
  news: '新闻情报检索',
  intelligence: '情报分析',
  weather: '天气数据获取',
  'weather-fetch': '气象获取',
  gis: 'GIS 标绘',
  'region-mark': '区域标记',
  satellite: '卫星影像',
  fire: '火灾监测',
  'oil-drift': '溢油漂移',
  'daily_report': '日报生成',
  subscription: '订阅执行',
  requirement: '需求处理',
  'intelligent_qa': '智能问答',
};

export default function TaskTrace({ task }: TaskTraceProps) {
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());

  const toggleStep = (id: string) => {
    setExpandedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const formatTime = (iso: string | null) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  return (
    <div className="bg-[#1E1E2E] rounded-xl border border-[#3A3A4E] p-4">
      <div className="text-xs text-[#8888AA] mb-3">任务执行链路</div>

      {/* 原始需求 */}
      <div className="mb-4 pb-3 border-b border-[#3A3A4E]">
        <div className="text-xs text-[#8888AA] mb-1">原始需求</div>
        <div className="text-sm text-[#EAEAEA] font-medium">{task.query}</div>
        <div className="flex items-center gap-3 mt-2 text-xs text-[#8888AA]">
          <span>状态: <span className={task.status === 'completed' ? 'text-[#44FF44]' : task.status === 'failed' ? 'text-[#FF4444]' : 'text-[#00E0FF]'}>{task.status}</span></span>
          <span>创建: {formatTime(task.createdAt)}</span>
        </div>
      </div>

      {/* Steps 时间线 */}
      <div className="space-y-2">
        {task.steps.map((step, index) => {
          const isExpanded = expandedSteps.has(step.id);
          const label = ACTION_TYPE_LABEL[step.actionType] || step.actionType;
          const icon = STATUS_ICON[step.status] || STATUS_ICON.pending;

          return (
            <div key={step.id} className="relative">
              {/* 连接线 */}
              {index < task.steps.length - 1 && (
                <div className="absolute left-[18px] top-8 bottom-[-8px] w-px bg-[#3A3A4E]" />
              )}

              <div className="flex items-start gap-3">
                <div className="mt-0.5 shrink-0">{icon}</div>
                <div className="flex-1 min-w-0">
                  <button
                    onClick={() => toggleStep(step.id)}
                    className="flex items-center gap-1.5 w-full text-left group"
                  >
                    <span className="text-sm text-[#EAEAEA] group-hover:text-[#00E0FF] transition-colors">
                      {label}
                    </span>
                    {step.result && (
                      <span className="text-xs text-[#8888AA]">
                        {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                      </span>
                    )}
                  </button>
                  <div className="text-xs text-[#8888AA] mt-0.5">
                    {step.status}
                  </div>

                  {/* 展开结果 */}
                  {isExpanded && step.result && (
                    <div className="mt-2 bg-[#2A2A3E] rounded-lg p-3 text-xs text-[#EAEAEA] overflow-x-auto">
                      <pre className="whitespace-pre-wrap break-all">
                        {JSON.stringify(step.result, null, 2)}
                      </pre>
                    </div>
                  )}

                  {step.error && (
                    <div className="mt-2 text-xs text-[#FF4444] bg-[#FF4444]/10 border border-[#FF4444]/20 rounded-lg p-2">
                      {step.error}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
