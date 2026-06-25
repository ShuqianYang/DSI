'use client';

import { useEffect, useRef, useState } from 'react';
import type { ScenarioQuickAction } from '@datasourceintelligence/shared';
import { ChatMessage as ChatMessageType } from '@/types/prd';
import ChatMessage from './ChatMessage';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';

interface ChatMessageListProps {
  messages: ChatMessageType[];
  isLoading: boolean;
  greetingTitle: string;
  greetingDescription: string;
  quickActions: ScenarioQuickAction[];
  onToggleThinking: (msgId: string) => void;
  formatTime: (timestamp: number) => string;
  onSuggestion: (text: string) => void;
}

function SuggestionButtons({
  quickActions,
  onSuggestion,
}: {
  quickActions: ScenarioQuickAction[];
  onSuggestion: (text: string) => void;
}) {
  const [selected, setSelected] = useState<ScenarioQuickAction | null>(null);

  if (quickActions.length === 0) return null;

  const handleConfirm = () => {
    if (!selected) return;
    onSuggestion(selected.prompt);
    setSelected(null);
  };

  return (
    <>
      <div className="flex flex-wrap justify-center gap-2">
        {quickActions.map(({ label, prompt }) => (
          <button
            key={`${label}:${prompt}`}
            onClick={() => setSelected({ label, prompt })}
            className="rounded-full bg-[#2A2A3E] px-3 py-1.5 text-xs text-[#00E0FF] transition-colors hover:bg-[#00E0FF]/20"
          >
            {label}
          </button>
        ))}
      </div>

      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="border-[#3A3A4E] bg-[#2A2A3E] text-[#EAEAEA] sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-[#EAEAEA]">{selected?.label}</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <p className="text-sm leading-relaxed text-[#8888AA]">{selected?.prompt}</p>
          </div>
          <DialogFooter className="gap-2">
            <DialogClose asChild>
              <button
                onClick={() => setSelected(null)}
                className="rounded-lg bg-[#3A3A4E] px-4 py-2 text-sm text-[#EAEAEA] transition-colors hover:bg-[#4A4A5E]"
              >
                取消
              </button>
            </DialogClose>
            <button
              onClick={handleConfirm}
              className="rounded-lg bg-[#00E0FF] px-4 py-2 text-sm font-medium text-[#121212] transition-colors hover:bg-[#00E0FF]/80"
            >
              确认
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function ChatMessageList({
  messages,
  isLoading,
  greetingTitle,
  greetingDescription,
  quickActions,
  onToggleThinking,
  formatTime,
  onSuggestion,
}: ChatMessageListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const lastMsg = messages[messages.length - 1];
  const showSuggestionsAfterMsg = messages.length > 0 && lastMsg?.role === 'assistant' && !isLoading;

  return (
    <div ref={containerRef} className="flex-1 space-y-4 overflow-y-auto p-4">
      {messages.length === 0 && (
        <div className="py-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[#00E0FF]/10">
            <span className="text-3xl">AI</span>
          </div>
          <div className="mb-2 font-medium text-[#EAEAEA]">{greetingTitle}</div>
          <div className="mx-auto max-w-xs text-sm text-[#8888AA]">
            {greetingDescription}
          </div>
          <div className="mt-6">
            <SuggestionButtons quickActions={quickActions} onSuggestion={onSuggestion} />
          </div>
        </div>
      )}

      {messages.map((msg) =>
        msg.role === 'system' ? (
          <div key={msg.id} className="flex justify-center">
            <div className="rounded-full border border-[#3A3A4E] bg-[#1E1E2E]/80 px-3 py-1 text-xs text-[#8888AA]">
              {msg.content}
            </div>
          </div>
        ) : (
          <ChatMessage
            key={msg.id}
            msg={msg}
            onToggleThinking={onToggleThinking}
            formatTime={formatTime}
          />
        ),
      )}

      {showSuggestionsAfterMsg && (
        <SuggestionButtons quickActions={quickActions} onSuggestion={onSuggestion} />
      )}

      {isLoading && (
        <div className="flex justify-start">
          <div className="rounded-lg bg-[#2A2A3E] p-4">
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 animate-bounce rounded-full bg-[#00E0FF]" style={{ animationDelay: '0ms' }} />
              <div className="h-2 w-2 animate-bounce rounded-full bg-[#00E0FF]" style={{ animationDelay: '150ms' }} />
              <div className="h-2 w-2 animate-bounce rounded-full bg-[#00E0FF]" style={{ animationDelay: '300ms' }} />
            </div>
          </div>
        </div>
      )}
      <div ref={messagesEndRef} />
    </div>
  );
}
