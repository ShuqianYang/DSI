'use client';

import { Clock } from 'lucide-react';

interface ChatHeaderProps {
  onHistoryToggle: () => void;
}

export default function ChatHeader({ onHistoryToggle }: ChatHeaderProps) {
  return (
    <div className="px-4 py-3 border-b border-[#3A3A4E] flex items-center justify-between">
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-full bg-[#00E0FF]/20 flex items-center justify-center">
          <span className="text-[#00E0FF] text-sm font-medium">AI</span>
        </div>
        <div>
          <div className="text-sm font-medium text-[#EAEAEA]">信息服务智能助手</div>
          <div className="text-xs text-[#8888AA]">基于数智融合分析</div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={onHistoryToggle}
          className="p-2 rounded-lg hover:bg-[#2A2A3E] transition-colors text-[#8888AA] hover:text-[#EAEAEA]"
          title="历史对话"
        >
          <Clock className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
