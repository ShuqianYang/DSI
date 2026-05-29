'use client';

import { useEffect, useState } from 'react';
import { X, FileText, Eye, MapPin, Clock, ExternalLink } from 'lucide-react';
import { getEventById, getInsightById, getTask, type InfoItem } from '@/lib/api';
import TaskTrace from './TaskTrace';

interface InfoDetailProps {
  item: InfoItem | null;
  onClose: () => void;
}

type DetailData =
  | { itemType: 'event'; data: Awaited<ReturnType<typeof getEventById>> }
  | { itemType: 'insight'; data: Awaited<ReturnType<typeof getInsightById>> };

export default function InfoDetail({ item, onClose }: InfoDetailProps) {
  const [detail, setDetail] = useState<DetailData | null>(null);
  const [taskData, setTaskData] = useState<Awaited<ReturnType<typeof getTask>> | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!item) {
      setDetail(null);
      setTaskData(null);
      return;
    }

    let cancelled = false;
    setLoading(true);

    async function load() {
      try {
        if (item!.itemType === 'event') {
          const data = await getEventById(item!.id);
          if (!cancelled) setDetail({ itemType: 'event', data });
        } else {
          const data = await getInsightById(item!.id);
          if (!cancelled) setDetail({ itemType: 'insight', data });
        }

        if (item!.agentTaskId) {
          const task = await getTask(item!.agentTaskId);
          if (!cancelled) setTaskData(task);
        }
      } catch (err) {
        console.error('[InfoDetail] load error:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [item]);

  if (!item) return null;

  const isEvent = item.itemType === 'event';
  const title = item.title;
  const statusColor =
    item.status === 'success' || item.status === 'safe'
      ? 'text-[#44FF44] bg-[#44FF44]/10 border-[#44FF44]/20'
      : item.status === 'failed' || item.status === 'high'
      ? 'text-[#FF4444] bg-[#FF4444]/10 border-[#FF4444]/20'
      : item.status === 'partial' || item.status === 'medium'
      ? 'text-[#FFAA00] bg-[#FFAA00]/10 border-[#FFAA00]/20'
      : 'text-[#FFFF44] bg-[#FFFF44]/10 border-[#FFFF44]/20';

  const formatTime = (iso: string) => new Date(iso).toLocaleString('zh-CN');

  return (
    <div className="fixed inset-0 z-[100] flex justify-end">
      {/* 遮罩 */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      {/* Drawer */}
      <div className="relative w-full max-w-xl h-full bg-[#121212] border-l border-[#3A3A4E] flex flex-col shadow-2xl animate-in slide-in-from-right duration-300">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#3A3A4E]">
          <div className="flex items-center gap-3">
            {isEvent ? (
              <FileText className="w-5 h-5 text-[#00E0FF]" />
            ) : (
              <Eye className="w-5 h-5 text-[#FFAA00]" />
            )}
            <h2 className="text-base font-medium text-[#EAEAEA]">详情</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-[#2A2A3E] text-[#8888AA] hover:text-[#EAEAEA] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {loading && (
            <div className="flex items-center justify-center py-10 text-[#8888AA]">
              <div className="w-5 h-5 border-2 border-[#00E0FF] border-t-transparent rounded-full animate-spin mr-2" />
              加载详情...
            </div>
          )}

          {/* 元信息 */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className={`px-2.5 py-0.5 rounded text-xs font-medium border ${statusColor}`}>
                {item.status === 'high' ? '高危' : item.status === 'medium' ? '中危' : item.status === 'low' ? '低危' : item.status === 'safe' ? '安全' : item.status === 'success' ? '成功' : item.status === 'partial' ? '部分成功' : item.status === 'failed' ? '失败' : item.status}
              </span>
              {item.category && (
                <span className="text-xs text-[#8888AA] bg-[#2A2A3E] px-2 py-0.5 rounded border border-[#3A3A4E]">
                  {item.category === 'geopolitics' ? '地缘' : item.category === 'military' ? '军事' : '产业'}
                </span>
              )}
            </div>

            <h3 className="text-lg font-semibold text-[#EAEAEA]">{title}</h3>

            <div className="flex items-center gap-4 text-xs text-[#8888AA]">
              <span className="flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" />
                {formatTime(item.timestamp)}
              </span>
              {item.sourceTaskName && (
                <span className="flex items-center gap-1 text-[#00E0FF]">
                  <ExternalLink className="w-3.5 h-3.5" />
                  关联任务：{item.sourceTaskName}
                </span>
              )}
            </div>
          </div>

          {/* 完整内容 */}
          {detail && (
            <div className="bg-[#1E1E2E] rounded-xl border border-[#3A3A4E] p-4">
              <div className="text-xs text-[#8888AA] mb-2">内容</div>
              <div className="text-sm text-[#EAEAEA] leading-relaxed whitespace-pre-wrap">
                {detail.itemType === 'event'
                  ? detail.data.content
                  : `${detail.data.summary}\n\n${detail.data.content}`}
              </div>
            </div>
          )}

          {/* GIS 数据 */}
          {detail?.itemType === 'event' && detail.data.gisData && (
            <div className="bg-[#1E1E2E] rounded-xl border border-[#3A3A4E] p-4">
              <div className="flex items-center gap-2 text-xs text-[#00E0FF] mb-3">
                <MapPin className="w-4 h-4" />
                GIS 数据
              </div>
              <div className="grid grid-cols-3 gap-3">
                {detail.data.gisData.entities && detail.data.gisData.entities.length > 0 && (
                  <div className="bg-[#2A2A3E] rounded-lg p-3 text-center">
                    <div className="text-lg font-semibold text-[#EAEAEA]">{detail.data.gisData.entities.length}</div>
                    <div className="text-xs text-[#8888AA]">实体</div>
                  </div>
                )}
                {detail.data.gisData.trajectories && detail.data.gisData.trajectories.length > 0 && (
                  <div className="bg-[#2A2A3E] rounded-lg p-3 text-center">
                    <div className="text-lg font-semibold text-[#EAEAEA]">{detail.data.gisData.trajectories.length}</div>
                    <div className="text-xs text-[#8888AA]">轨迹</div>
                  </div>
                )}
                {detail.data.gisData.regions && detail.data.gisData.regions.length > 0 && (
                  <div className="bg-[#2A2A3E] rounded-lg p-3 text-center">
                    <div className="text-lg font-semibold text-[#EAEAEA]">{detail.data.gisData.regions.length}</div>
                    <div className="text-xs text-[#8888AA]">区域</div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 来源 */}
          {detail?.itemType === 'insight' && detail.data.sources && detail.data.sources.length > 0 && (
            <div className="bg-[#1E1E2E] rounded-xl border border-[#3A3A4E] p-4">
              <div className="text-xs text-[#8888AA] mb-2">来源</div>
              <div className="flex flex-wrap gap-2">
                {detail.data.sources.map((s, i) => (
                  <span key={i} className="text-xs text-[#EAEAEA] bg-[#2A2A3E] px-2 py-1 rounded border border-[#3A3A4E]">
                    {s}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* 任务执行链路 */}
          {taskData && (
            <TaskTrace task={taskData} />
          )}
        </div>
      </div>
    </div>
  );
}
