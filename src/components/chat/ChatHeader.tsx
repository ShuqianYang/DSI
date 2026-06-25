'use client';

import React from 'react';
import { Clock } from 'lucide-react';

interface ChatHeaderProps {
  title: string;
  subtitle: string;
  onHistoryToggle: () => void;
}

export default function ChatHeader({ title, subtitle, onHistoryToggle }: ChatHeaderProps) {
  return (
    <div className="flex items-center justify-between border-b border-[#3A3A4E] px-4 py-3">
      <div className="flex min-w-0 items-center gap-2">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#00E0FF]/20">
          <span className="text-sm font-medium text-[#00E0FF]">AI</span>
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-[#EAEAEA]">{title}</div>
          <div className="truncate text-xs text-[#8888AA]">{subtitle}</div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={onHistoryToggle}
          className="rounded-lg p-2 text-[#8888AA] transition-colors hover:bg-[#2A2A3E] hover:text-[#EAEAEA]"
          title="历史对话"
        >
          <Clock className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
