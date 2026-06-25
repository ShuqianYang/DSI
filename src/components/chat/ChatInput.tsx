'use client';

import React from 'react';
import { Send } from 'lucide-react';

interface ChatInputProps {
  inputValue: string;
  isLoading: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  placeholder: string;
  onChange: (value: string) => void;
  onSend: () => void;
}

export default function ChatInput({
  inputValue,
  isLoading,
  inputRef,
  placeholder,
  onChange,
  onSend,
}: ChatInputProps) {
  return (
    <div className="border-t border-[#3A3A4E] p-4">
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') onSend();
          }}
          placeholder={placeholder}
          className="flex-1 rounded-lg border border-[#3A3A4E] bg-[#2A2A3E] px-4 py-2.5 text-sm text-[#EAEAEA] transition-colors placeholder-[#8888AA] focus:border-[#00E0FF] focus:outline-none"
        />
        <button
          onClick={onSend}
          disabled={!inputValue.trim() || isLoading}
          className="rounded-lg bg-[#00E0FF] p-2.5 text-[#121212] transition-colors hover:bg-[#00E0FF]/80 disabled:cursor-not-allowed disabled:opacity-50"
          title="发送"
        >
          <Send className="h-5 w-5" />
        </button>
      </div>
      <div className="mt-2 flex items-center justify-between text-xs text-[#8888AA]">
        <span>按 Enter 发送，Shift + Enter 换行</span>
      </div>
    </div>
  );
}
