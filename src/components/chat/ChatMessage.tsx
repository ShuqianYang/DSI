'use client';

import { Volume2 } from 'lucide-react';
import { ChatMessage as ChatMessageType } from '@/types/prd';
import MarkdownContent from './MarkdownContent';
import ThinkingProcess from './ThinkingProcess';

interface ChatMessageProps {
  msg: ChatMessageType;
  onToggleThinking: (msgId: string) => void;
  formatTime: (timestamp: number) => string;
}

export default function ChatMessage({ msg, onToggleThinking, formatTime }: ChatMessageProps) {
  return (
    <div
      className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
    >
      <div
        className={`max-w-[90%] rounded-lg p-3 ${
          msg.role === 'user'
            ? 'bg-[#00E0FF]/20 text-[#EAEAEA]'
            : 'bg-[#2A2A3E] text-[#EAEAEA]'
        }`}
      >
        {/* AI消息的思考过程 */}
        {msg.role === 'assistant' && (msg.thinking || msg.thinkingSteps) && (
          <ThinkingProcess
            msg={msg}
            onToggle={() => onToggleThinking(msg.id)}
          />
        )}

        {/* 消息正文 */}
        {msg.role === 'assistant' ? (
          <div className="text-sm">
            <MarkdownContent content={msg.content} />
          </div>
        ) : (
          <div className="text-sm whitespace-pre-wrap">{msg.content}</div>
        )}

        <div className="mt-2 flex items-center justify-between">
          <div className="text-xs text-[#8888AA]">{formatTime(msg.timestamp)}</div>
          {msg.role === 'assistant' && (
            <div className="flex items-center gap-1">
              {msg.hasGisData && (
                <span className="text-xs text-[#00E0FF] bg-[#00E0FF]/10 px-2 py-0.5 rounded">
                  含GIS数据
                </span>
              )}
              {/* 暂时注释：语音朗读按钮（预留）
              <button className="p-1 hover:bg-[#3A3A4E] rounded transition-colors">
                <Volume2 className="w-3 h-3 text-[#8888AA]" />
              </button>
              */}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
