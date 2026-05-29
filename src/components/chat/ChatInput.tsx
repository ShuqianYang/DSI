'use client';

import { Send } from 'lucide-react';

interface ChatInputProps {
  inputValue: string;
  isLoading: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onChange: (value: string) => void;
  onSend: () => void;
}

export default function ChatInput({ inputValue, isLoading, inputRef, onChange, onSend }: ChatInputProps) {
  return (
    <div className="p-4 border-t border-[#3A3A4E]">
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSend();
          }}
          placeholder="输入您的问题..."
          className="flex-1 bg-[#2A2A3E] border border-[#3A3A4E] rounded-lg px-4 py-2.5 text-sm text-[#EAEAEA] placeholder-[#8888AA] focus:outline-none focus:border-[#00E0FF] transition-colors"
        />
        {/* 暂时注释：语音输入按钮
        <button
          onClick={() => {}}
          className="p-2.5 rounded-lg bg-[#2A2A3E] hover:bg-[#3A3A4E] transition-colors text-[#8888AA] hover:text-[#EAEAEA]"
          title="语音输入"
        >
          <Mic className="w-5 h-5" />
        </button>
        */}
        <button
          onClick={onSend}
          disabled={!inputValue.trim() || isLoading}
          className="p-2.5 rounded-lg bg-[#00E0FF] hover:bg-[#00E0FF]/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-[#121212]"
          title="发送"
        >
          <Send className="w-5 h-5" />
        </button>
      </div>
      <div className="mt-2 flex items-center justify-between text-xs text-[#8888AA]">
        <span>按 Enter 发送，Shift + Enter 换行</span>
        {/* 暂时注释：订阅此需求按钮
        <button className="text-[#00E0FF] hover:underline">订阅此需求</button>
        */}
      </div>
    </div>
  );
}
