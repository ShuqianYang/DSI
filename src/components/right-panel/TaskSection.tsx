'use client';

import { useState } from 'react';
import { FileText, ChevronRight, RefreshCw, Download, MapPin, Terminal } from 'lucide-react';
import { Task, GisData } from '@/types/prd';
import { buildAgentLoopGisOutputLinkId } from '@/lib/agentLoopGisLink';
import {
  formatTime,
  getTaskStatusStyle,
  getTaskStatusLabel,
  getSubTaskStatusLabel,
} from '@/lib/styleMaps';
import { SubTaskStatusIcon } from './StatusIcons';

interface TaskSectionProps {
  tasks: Task[];
  expandedTasks: Set<string>;
  toggleTask: (id: string) => void;
  onTaskClick?: (task: Task) => void;
  onAgentLoopGisClick?: (linkId: string, gisData: GisData) => void;
  activeGisIds?: Set<string>;
}

type TaskFilterType = 'all' | 'running' | 'completed' | 'failed';

export default function TaskSection({
  tasks,
  expandedTasks,
  toggleTask,
  onTaskClick,
  onAgentLoopGisClick,
  activeGisIds,
}: TaskSectionProps) {
  const [taskFilter, setTaskFilter] = useState<TaskFilterType>('all');

  const filteredTasks = tasks.filter((task) => {
    if (taskFilter === 'all') return true;
    if (taskFilter === 'running') return task.status === 'running' || task.status === 'partial';
    return task.status === taskFilter;
  });

  return (
    <div className="p-3 space-y-3">
      <div>
        <div className="text-xs text-[#8888AA] mb-2 flex items-center justify-between">
          <span>可执行任务</span>
          <span className="text-[10px] text-[#8888AA]">{filteredTasks.length} 个任务</span>
        </div>
        <div className="flex gap-1 mb-2">
          {[
            { key: 'all' as TaskFilterType, label: '全部' },
            { key: 'running' as TaskFilterType, label: '进行中' },
            { key: 'completed' as TaskFilterType, label: '已完成' },
            { key: 'failed' as TaskFilterType, label: '失败' },
          ].map((f) => (
            <button
              key={f.key}
              onClick={() => setTaskFilter(f.key)}
              className={`px-2 py-1 text-[10px] rounded transition-colors ${
                taskFilter === f.key
                  ? 'bg-[#00E0FF]/20 text-[#00E0FF]'
                  : 'bg-[#2A2A3E] text-[#8888AA] hover:text-[#EAEAEA]'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="space-y-2 max-h-72 overflow-y-auto">
          {filteredTasks.map((task) => {
            const isExpanded = expandedTasks.has(task.id);
            return (
              <div
                key={task.id}
                className="p-2.5 rounded-lg bg-[#2A2A3E] border border-[#3A3A4E] hover:border-[#00E0FF]/30 transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div
                    className="flex items-start gap-2 cursor-pointer flex-1 min-w-0"
                    onClick={() => onTaskClick?.(task)}
                  >
                    <FileText className="w-4 h-4 mt-0.5 text-[#00E0FF] flex-shrink-0" />
                    <div className="min-w-0">
                      <div className="text-sm text-[#EAEAEA] truncate">{task.name}</div>
                      <div className="text-xs text-[#8888AA] mt-0.5">
                        {task.type === 'daily' ? '日报' : task.type === 'weekly' ? '周报' : '实时监测'}
                        {task.agentLoop ? (
                          <span className="ml-2 text-[#00E0FF]">
                            {task.agentLoop.toolSummaries.filter((s) => s.ok).length}/{task.agentLoop.toolSummaries.length}
                          </span>
                        ) : task.subTasks && (
                          <span className="ml-2 text-[#00E0FF]">
                            {task.subTasks.filter((s) => s.status === 'completed').length}/{task.subTasks.length}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${getTaskStatusStyle(task.status)}`}>
                      {getTaskStatusLabel(task.status)}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleTask(task.id);
                      }}
                      className="p-0.5 hover:bg-[#3A3A4E] rounded transition-colors"
                    >
                      <ChevronRight
                        className={`w-4 h-4 text-[#8888AA] transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                      />
                    </button>
                  </div>
                </div>
                {isExpanded && task.agentLoop && (
                  <div className="mt-2 pt-2 border-t border-[#3A3A4E] space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 text-[10px] text-[#00E0FF]">
                        <Terminal className="w-3 h-3" />
                        <span>Agent Loop</span>
                        {task.agentLoop.turns !== undefined && (
                          <span className="text-[#8888AA]">turns={task.agentLoop.turns}</span>
                        )}
                      </div>
                      <span className="text-[10px] text-[#8888AA] truncate">
                        stoppedBy={task.agentLoop.stoppedBy}
                      </span>
                    </div>
                    {task.agentLoop.message && (
                      <div className="text-xs text-[#EAEAEA] leading-relaxed line-clamp-3">
                        {task.agentLoop.message}
                      </div>
                    )}
                    {task.agentLoop.toolSummaries.length > 0 && (
                      <div className="space-y-1.5">
                        {task.agentLoop.toolSummaries.map((tool) => (
                          <div
                            key={tool.toolCallId}
                            className="flex items-start gap-2 px-1.5 py-1 rounded bg-[#1E1E2E]/60"
                          >
                            <span
                              className={`mt-1 h-1.5 w-1.5 rounded-full flex-shrink-0 ${
                                tool.ok ? 'bg-[#44FF44]' : 'bg-[#FF4444]'
                              }`}
                            />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs text-[#EAEAEA] truncate">{tool.displayName || tool.toolName}</span>
                                {tool.gisDataType && (
                                  <span className="inline-flex items-center gap-1 text-[10px] text-[#00E0FF]">
                                    <MapPin className="w-2.5 h-2.5" />
                                    {tool.gisDataType}
                                  </span>
                                )}
                              </div>
                              <div className="text-[10px] text-[#8888AA] truncate">{tool.summary}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    {task.agentLoop.gisDataItems.length > 0 && (
                      <div className="space-y-1.5">
                        {task.agentLoop.gisDataItems.map((item, index) => {
                          const linkId = buildAgentLoopGisOutputLinkId({
                            taskId: task.id,
                            toolCallId: item.toolCallId,
                            index,
                          });
                          const isActive = activeGisIds?.has(linkId);
                          return (
                            <button
                              key={linkId}
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onAgentLoopGisClick?.(linkId, {
                                  ...item.gisData,
                                  eventName: `${item.displayName || item.toolName} · ${item.gisData.type}`,
                                });
                              }}
                              className={`w-full flex items-center justify-between gap-2 rounded px-2 py-1 text-left transition-colors ${
                                isActive
                                  ? 'bg-[#FF44FF]/20 text-[#FF44FF] border border-[#FF44FF]/30'
                                  : 'bg-[#00E0FF]/10 text-[#00E0FF] hover:bg-[#00E0FF]/20'
                              }`}
                            >
                              <span className="min-w-0 flex items-center gap-1.5">
                                <MapPin className="w-3 h-3 flex-shrink-0" />
                                <span className="text-[10px] truncate">{item.displayName || item.toolName}</span>
                              </span>
                              <span className="text-[10px] text-[#8888AA] flex-shrink-0">
                                {item.gisData.type}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                    {task.agentLoop.logFilePath && (
                      <div className="text-[10px] font-mono text-[#8888AA] truncate">
                        {task.agentLoop.logFilePath}
                      </div>
                    )}
                  </div>
                )}
                {/* 暂时关闭：任务下拉进度展开块
                {isExpanded && (
                  <div className="mt-2 pt-2 border-t border-[#3A3A4E]">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-[#8888AA]">{formatTime(task.executeTime)}</span>
                        <span className="text-xs text-[#00E0FF]">{task.dataCount} 条数据</span>
                      </div>
                      <div className="flex items-center gap-1">
                        {task.status === 'completed' && (
                          <>
                            <button className="p-1 hover:bg-[#3A3A4E] rounded text-[#8888AA] transition-colors">
                              <RefreshCw className="w-3 h-3" />
                            </button>
                            <button className="p-1 hover:bg-[#3A3A4E] rounded text-[#8888AA] transition-colors">
                              <Download className="w-3 h-3" />
                            </button>
                          </>
                        )}
                        {task.status === 'failed' && (
                          <button className="p-1 hover:bg-[#FF4444]/10 rounded text-[#FF4444] transition-colors">
                            <RefreshCw className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>
                    {task.subTasks && task.subTasks.length > 0 && (
                      <div className="mt-2 space-y-1.5">
                        {task.subTasks.map((sub) => (
                          <div key={sub.id} className="flex items-center gap-2 px-1.5 py-1 rounded bg-[#1E1E2E]/60">
                            <SubTaskStatusIcon status={sub.status} />
                            <span className="text-xs text-[#EAEAEA] flex-1 truncate">{sub.name}</span>
                            <span className="text-[10px] text-[#8888AA] whitespace-nowrap">{getSubTaskStatusLabel(sub.status)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                */}
              </div>
            );
          })}
          {filteredTasks.length === 0 && (
            <div className="text-center py-4 text-[#8888AA] text-xs">暂无任务</div>
          )}
        </div>
      </div>
    </div>
  );
}
