'use client';

import { Clock, Play, Pause } from 'lucide-react';
import { Subscription } from '@/types/prd';

interface SubscriptionSectionProps {
  subscriptions: Subscription[];
  toggleSubscription: (id: string) => void;
}

export default function SubscriptionSection({ subscriptions, toggleSubscription }: SubscriptionSectionProps) {
  return (
    <div className="p-3 space-y-3">
      {subscriptions.map((sub) => (
        <div
          key={sub.id}
          className="p-3 rounded-lg bg-[#2A2A3E] border border-[#3A3A4E] hover:border-[#00E0FF]/30 transition-colors"
        >
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-2">
              <Clock className="w-4 h-4 mt-0.5 text-[#00E0FF]" />
              <div>
                <div className="text-sm text-[#EAEAEA] font-medium">{sub.name}</div>
                <div className="text-xs text-[#8888AA] mt-1">{sub.schedule}</div>
              </div>
            </div>
            <button
              onClick={() => toggleSubscription(sub.id)}
              className={`p-1.5 rounded transition-colors ${
                sub.status === 'running'
                  ? 'bg-[#44FF44]/10 text-[#44FF44] hover:bg-[#44FF44]/20'
                  : 'bg-[#8888AA]/10 text-[#8888AA] hover:bg-[#8888AA]/20'
              }`}
            >
              {sub.status === 'running' ? (
                <Pause className="w-3.5 h-3.5" />
              ) : (
                <Play className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
          <div className="mt-2 flex items-center justify-between text-xs">
            <span className="text-[#8888AA]">
              {sub.status === 'running'
                ? `下次执行：${sub.nextExecuteTime ? new Date(sub.nextExecuteTime).toLocaleString('zh-CN') : '待定'}`
                : '已暂停'}
            </span>
            <span
              className={`px-1.5 py-0.5 rounded ${
                sub.status === 'running'
                  ? 'bg-[#44FF44]/10 text-[#44FF44]'
                  : 'bg-[#8888AA]/10 text-[#8888AA]'
              }`}
            >
              {sub.status === 'running' ? '运行中' : '已暂停'}
            </span>
          </div>
        </div>
      ))}
      {subscriptions.length === 0 && (
        <div className="text-center py-8 text-[#8888AA] text-sm">
          暂无订阅任务
        </div>
      )}
    </div>
  );
}
