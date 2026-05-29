'use client';

import { Trash2 } from 'lucide-react';
import { ChatMessage as ChatMessageType } from '@/types/prd';

interface ChatHistoryProps {
  messages: ChatMessageType[];
  onContinue: (id: string) => void;
  onDelete: (id: string) => void;
  onClearAll: () => void;
  formatTime: (timestamp: number) => string;
}

export default function ChatHistory({ messages, onContinue, onDelete, onClearAll, formatTime }: ChatHistoryProps) {
  const userMessages = messages
    .filter((m) => m.role === 'user')
    .slice(-10)
    .reverse();

  return (
    <div className="border-b border-[#3A3A4E] max-h-48 overflow-y-auto">
      <div className="p-3 space-y-2">
        <div className="text-xs text-[#8888AA] mb-2">历史对话</div>
        {userMessages.map((msg) => (
          <div
            key={msg.id}
            className="flex items-center justify-between p-2 rounded bg-[#2A2A3E]/50 hover:bg-[#2A2A3E] cursor-pointer transition-colors group"
          >
            <div className="flex-1 min-w-0" onClick={() => onContinue(msg.id)}>
              <div className="text-xs text-[#EAEAEA] truncate">{msg.content}</div>
              <div className="text-xs text-[#8888AA] mt-1">{formatTime(msg.timestamp)}</div>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete(msg.id);
              }}
              className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-[#FF4444]/20 text-[#FF4444] transition-all"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        ))}
        {userMessages.length === 0 && (
          <div className="text-xs text-[#8888AA] text-center py-4">暂无历史对话</div>
        )}
      </div>
      <div className="px-3 pb-2 flex gap-2">
        <button onClick={onClearAll} className="text-xs text-[#FF4444] hover:underline">
          清空全部
        </button>
      </div>
    </div>
  );
}
