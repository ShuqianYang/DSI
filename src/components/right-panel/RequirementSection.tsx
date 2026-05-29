'use client';

import type { ApiRequirement } from '@/lib/api';

interface RequirementSectionProps {
  requirements: ApiRequirement[];
}

export default function RequirementSection({ requirements }: RequirementSectionProps) {
  return (
    <div className="p-3 space-y-3">
      <div className="text-xs text-[#8888AA] mb-2">未完成需求</div>
      <div className="space-y-2">
        {requirements.map((req) => (
          <div
            key={req.id}
            className="p-3 rounded-lg bg-[#FFAA00]/5 border border-l-[#FFAA00]"
          >
            <div className="flex items-start justify-between">
              <div>
                <div className="text-sm text-[#EAEAEA]">{req.description}</div>
                <div className="text-xs text-[#8888AA] mt-1">
                  {req.timestamp ? new Date(req.timestamp).toLocaleString('zh-CN') : ''} · 需求单 {req.requirementId}
                </div>
              </div>
              <span className="text-xs text-[#FFAA00] bg-[#FFAA00]/10 px-2 py-0.5 rounded">
                {req.status === 'pending' ? '待处理' : req.status === 'processing' ? '处理中' : '已驳回'}
              </span>
            </div>
          </div>
        ))}
        {requirements.length === 0 && (
          <div className="text-center py-8 text-[#8888AA] text-sm">
            暂无未完成需求
          </div>
        )}
      </div>
    </div>
  );
}
