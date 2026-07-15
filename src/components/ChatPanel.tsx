'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { getScenarioProfile, type ScenarioId, type ScenarioProfile } from '@datasourceintelligence/shared';
import { ThinkingStep, GisData, Task } from '@/types/prd';
import type { SkillCatalogItem, SkillCatalogResponse } from '@/types/skillCatalog';
import { useTaskChat } from '@/hooks/useTaskChat';
import ChatHeader from './chat/ChatHeader';
import ChatHistory from './chat/ChatHistory';
import ChatMessageList from './chat/ChatMessageList';
import ChatInput from './chat/ChatInput';
import ScenarioTabs from './chat/ScenarioTabs';
import ScenarioSkillButton from './chat/ScenarioSkillButton';

interface ChatPanelProps {
  userId?: string;
  scenario?: ScenarioProfile;
  onScenarioChange?: (scenarioId: ScenarioId) => void;
  onSendMessage: (message: string) => void;
  onTaskCreate?: (task: Task, steps: ThinkingStep[], gisData?: GisData) => void;
  onTaskFinished?: (taskId: string, status: 'completed' | 'failed') => void;
}

export default function ChatPanel({
  userId,
  scenario: scenarioProp,
  onScenarioChange = () => undefined,
  onSendMessage,
  onTaskCreate,
  onTaskFinished,
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
  } = useTaskChat({
    userId,
    scenarioId: scenario.id,
    onTaskCreate,
    onTaskFinished,
  });

  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const [skillItems, setSkillItems] = useState<SkillCatalogItem[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [skillsError, setSkillsError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSkillsLoading(true);
    setSkillsError(null);

    fetch(`/api/skills?_t=${Date.now()}`, { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = (await response.json()) as SkillCatalogResponse;
        if (!cancelled) setSkillItems(data.items);
      })
      .catch((loadError) => {
        if (!cancelled) setSkillsError(loadError instanceof Error ? loadError.message : 'Skill 加载失败');
      })
      .finally(() => {
        if (!cancelled) setSkillsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [scenario.id]);

  const scenarioSkills = useMemo(() => {
    const skillIdSet = new Set(scenario.skillIds);
    return skillItems.filter((item) => skillIdSet.has(item.name));
  }, [skillItems, scenario.skillIds]);

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

      <ScenarioTabs scenario={scenario} onScenarioChange={onScenarioChange} />

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

      <ChatInput
        inputValue={inputValue}
        isLoading={isLoading}
        inputRef={inputRef}
        placeholder={scenario.inputPlaceholder}
        leftSlot={<ScenarioSkillButton scenario={scenario} skills={scenarioSkills} loading={skillsLoading} error={skillsError} />}
        onChange={setInputValue}
        onSend={handleSendClick}
      />
    </div>
  );
}
