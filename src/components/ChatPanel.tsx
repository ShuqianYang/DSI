'use client';

import { useEffect, useRef, useState } from 'react';
import { getScenarioProfile, type ScenarioId, type ScenarioProfile } from '@datasourceintelligence/shared';
import { ThinkingStep, GisData, Task } from '@/types/prd';
import { useTaskChat } from '@/hooks/useTaskChat';
import ChatHeader from './chat/ChatHeader';
import ChatHistory from './chat/ChatHistory';
import ChatMessageList from './chat/ChatMessageList';
import ChatInput from './chat/ChatInput';
import ScenarioSwitcher from './chat/ScenarioSwitcher';

interface ChatPanelProps {
  scenario?: ScenarioProfile;
  onScenarioChange?: (scenarioId: ScenarioId) => void;
  onSendMessage: (message: string) => void;
  onGisDataRequest?: (gisData: GisData) => void;
  onTaskCreate?: (task: Task, steps: ThinkingStep[], gisData?: GisData) => void;
  onTaskFinished?: (taskId: string, status: 'completed' | 'failed') => void;
  onGisOperation?: (operations: Array<Record<string, unknown>>) => void;
}

export default function ChatPanel({
  scenario: scenarioProp,
  onScenarioChange = () => undefined,
  onSendMessage,
  onGisDataRequest,
  onTaskCreate,
  onTaskFinished,
  onGisOperation,
}: ChatPanelProps) {
  const scenario = scenarioProp ?? getScenarioProfile();
  const {
    messages,
    inputValue,
    isLoading,
    setInputValue,
    sendMessage,
    addSystemMessage,
    deleteMessage,
    clearAll,
    toggleThinkingExpanded,
  } = useTaskChat({ onGisDataRequest, onGisOperation, onTaskCreate, onTaskFinished });

  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const previousScenarioIdRef = useRef<ScenarioId>(scenario.id);

  useEffect(() => {
    if (previousScenarioIdRef.current === scenario.id) return;
    previousScenarioIdRef.current = scenario.id;
    addSystemMessage(scenario.switchMessage);
  }, [scenario.id, scenario.switchMessage, addSystemMessage]);

  const handleContinue = (chatId: string) => {
    const chat = messages.find((message) => message.id === chatId);
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
    <div className="flex h-full flex-col overflow-hidden rounded-lg glass-panel">
      <ChatHeader
        title={scenario.chatTitle}
        subtitle={scenario.chatSubtitle}
        onHistoryToggle={() => setIsHistoryOpen(!isHistoryOpen)}
      />

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
        greetingTitle={scenario.greetingTitle}
        greetingDescription={scenario.greetingDescription}
        quickActions={scenario.quickActions}
        onToggleThinking={toggleThinkingExpanded}
        formatTime={formatTime}
        onSuggestion={(text) => {
          setInputValue(text);
          inputRef.current?.focus();
        }}
      />

      <ScenarioSwitcher scenario={scenario} onScenarioChange={onScenarioChange} />
      <ChatInput
        inputValue={inputValue}
        isLoading={isLoading}
        inputRef={inputRef}
        placeholder={scenario.inputPlaceholder}
        onChange={setInputValue}
        onSend={handleSendClick}
      />
    </div>
  );
}
