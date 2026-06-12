'use client';

import { useState } from 'react';
import { Bell, Eye, Clock, ListTodo, Zap } from 'lucide-react';
import {
  Insight,
  TaskEvent,
  Task,
  GisData,
} from '@/types/prd';
import { useRightPanel } from '@/hooks/useRightPanel';
import TaskSection from './right-panel/TaskSection';
import SubscriptionSection from './right-panel/SubscriptionSection';
import RequirementSection from './right-panel/RequirementSection';
import EventList from './right-panel/EventList';
import InsightList from './right-panel/InsightList';

interface RightPanelProps {
  tasks?: Task[];
  events?: TaskEvent[];
  onInsightClick?: (insight: Insight) => void;
  onEntityClick?: (entityId: string) => void;
  onTaskClick?: (task: Task) => void;
  onEventGisClick?: (eventId: string, gisData: GisData) => void;
  onAgentLoopGisClick?: (linkId: string, gisData: GisData) => void;
  onEventRead?: (eventId: string) => void;
  activeGisIds?: Set<string>;
}

type TabType = 'info' | 'subscription' | 'custom';
type InfoSubTabType = 'event' | 'insight';

export default function RightPanel({
  tasks: propTasks = [],
  events: propEvents = [],
  onInsightClick,
  onTaskClick,
  onEventGisClick,
  onAgentLoopGisClick,
  onEventRead,
  activeGisIds,
}: RightPanelProps) {
  const [activeTab, setActiveTab] = useState<TabType>('info');
  const [infoSubTab, setInfoSubTab] = useState<InfoSubTabType>('event');

  const {
    tasks,
    events,
    subscriptions,
    insights,
    requirements,
    expandedTasks,
    expandedEvents,
    expandedInsight,
    toggleTask,
    toggleEvent,
    toggleSubscription,
    setExpandedInsight,
  } = useRightPanel({ propTasks, propEvents, onEventRead });

  return (
    <div className="h-full flex flex-col glass-panel rounded-lg overflow-hidden">
      {/* Tab 导航 */}
      <div className="flex border-b border-[#3A3A4E]">
        {[
          { key: 'info' as TabType, label: '即时', icon: Zap },
          // { key: 'subscription' as TabType, label: '订阅', icon: Clock },
          { key: 'custom' as TabType, label: '定制', icon: ListTodo },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex-1 px-3 py-3 text-xs font-medium transition-colors relative ${
              activeTab === tab.key
                ? 'text-[#00E0FF] bg-[#00E0FF]/10'
                : 'text-[#8888AA] hover:text-[#EAEAEA] hover:bg-[#2A2A3E]'
            }`}
          >
            <div className="flex items-center justify-center gap-1.5">
              <tab.icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
            </div>
          </button>
        ))}
      </div>

      {/* 内容区域 */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {activeTab === 'info' && (
          <TaskSection
            tasks={tasks}
            expandedTasks={expandedTasks}
            toggleTask={toggleTask}
            onTaskClick={onTaskClick}
            onAgentLoopGisClick={onAgentLoopGisClick}
            activeGisIds={activeGisIds}
          />
        )}
        {/* {activeTab === 'subscription' && (
          <SubscriptionSection
            subscriptions={subscriptions}
            toggleSubscription={toggleSubscription}
          />
        )} */}
        {activeTab === 'custom' && (
          <RequirementSection requirements={requirements} />
        )}
      </div>

      {/* 事件 / AI洞察 常驻区域 */}
      <div className="border-t border-[#3A3A4E] flex-shrink-0 flex flex-col h-[55%]">
        <div className="flex border-b border-[#3A3A4E]">
          <button
            onClick={() => setInfoSubTab('event')}
            className={`flex-1 px-3 py-2 text-xs font-medium transition-colors relative ${
              infoSubTab === 'event'
                ? 'text-[#00E0FF] bg-[#00E0FF]/10'
                : 'text-[#8888AA] hover:text-[#EAEAEA] hover:bg-[#2A2A3E]'
            }`}
          >
            <div className="flex items-center justify-center gap-1.5">
              <Bell className="w-3.5 h-3.5" />
              <span>信息</span>
              {events.filter((e) => !e.read).length > 0 && (
                <span className="ml-0.5 px-1 py-0 text-[10px] rounded-full bg-[#FF4444] text-white min-w-[16px] flex items-center justify-center">
                  {events.filter((e) => !e.read).length}
                </span>
              )}
            </div>
          </button>
          {/* <button
            onClick={() => setInfoSubTab('insight')}
            className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
              infoSubTab === 'insight'
                ? 'text-[#00E0FF] bg-[#00E0FF]/10'
                : 'text-[#8888AA] hover:text-[#EAEAEA] hover:bg-[#2A2A3E]'
            }`}
          >
            <div className="flex items-center justify-center gap-1.5">
              <Eye className="w-3.5 h-3.5" />
              <span>洞察</span>
            </div>
          </button> */}
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {infoSubTab === 'event' && (
            <EventList
              events={events}
              tasks={tasks}
              expandedEvents={expandedEvents}
              toggleEvent={toggleEvent}
              onEventGisClick={onEventGisClick}
              activeEventIds={activeGisIds}
            />
          )}
          {/* {infoSubTab === 'insight' && (
            <InsightList
              insights={insights}
              expandedInsight={expandedInsight}
              setExpandedInsight={setExpandedInsight}
              onInsightClick={onInsightClick}
            />
          )} */}
        </div>
      </div>
    </div>
  );
}
