'use client';

import { useState, useRef } from 'react';
import { ChatMessage as ChatMessageType, ThinkingStep, GisData, Task } from '@/types/prd';
import { useTaskChat } from '@/hooks/useTaskChat';
import ChatHeader from './chat/ChatHeader';
import ChatHistory from './chat/ChatHistory';
import ChatMessageList from './chat/ChatMessageList';
import ChatInput from './chat/ChatInput';

interface ChatPanelProps {
  onSendMessage: (message: string) => void;
  onGisDataRequest?: (gisData: GisData) => void;
  onTaskCreate?: (task: Task, steps: ThinkingStep[], gisData?: GisData) => void;
  onTaskFinished?: (taskId: string, status: 'completed' | 'failed') => void;
  onFireDetected?: () => void;
  onGisOperation?: (operations: Array<Record<string, unknown>>) => void;
}

export default function ChatPanel({ onSendMessage, onGisDataRequest, onTaskCreate, onTaskFinished, onFireDetected, onGisOperation }: ChatPanelProps) {
  const {
    messages,
    inputValue,
    isLoading,
    setInputValue,
    sendMessage,
    deleteMessage,
    clearAll,
    toggleThinkingExpanded,
  } = useTaskChat({ onGisDataRequest, onFireDetected, onGisOperation, onTaskCreate, onTaskFinished });

  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleContinue = (chatId: string) => {
    const chat = messages.find((m) => m.id === chatId);
    if (chat) {
      setInputValue(chat.content);
      inputRef.current?.focus();
    }
    setIsHistoryOpen(false);
  };

  const handleSendClick = () => {
    const content = inputValue.trim();
    if (!content || isLoading) return;
    sendMessage(content);
    onSendMessage(content);
  };

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();

    if (isToday) {
      return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    }
    return (
      date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }) +
      ' ' +
      date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    );
  };

  return (
    <div className="h-full flex flex-col glass-panel rounded-lg overflow-hidden">
      <ChatHeader onHistoryToggle={() => setIsHistoryOpen(!isHistoryOpen)} />

      {isHistoryOpen && (
        <ChatHistory
          messages={messages}
          onContinue={handleContinue}
          onDelete={deleteMessage}
          onClearAll={clearAll}
          formatTime={formatTime}
        />
      )}

      <ChatMessageList
        messages={messages}
        isLoading={isLoading}
        onToggleThinking={toggleThinkingExpanded}
        formatTime={formatTime}
        onSuggestion={(text) => {
          setInputValue(text);
          inputRef.current?.focus();
        }}
      />

      <ChatInput
        inputValue={inputValue}
        isLoading={isLoading}
        inputRef={inputRef}
        onChange={setInputValue}
        onSend={handleSendClick}
      />
    </div>
  );
}
