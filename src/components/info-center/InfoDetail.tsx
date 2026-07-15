'use client';

import { useEffect, useState } from 'react';
import { X, Clock, MessageSquare, AlertCircle } from 'lucide-react';
import { getTask, type InfoItem } from '@/lib/api';
import TaskTrace from './TaskTrace';

interface InfoDetailProps {
  item: InfoItem | null;
  onClose: () => void;
}

export default function InfoDetail({ item, onClose }: InfoDetailProps) {
  const [taskData, setTaskData] = useState<Awaited<ReturnType<typeof getTask>> | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!item) {
      setTaskData(null);
      return;
    }

    let cancelled = false;
    setLoading(true);

    async function load() {
      try {
        const task = await getTask(item!.id);
        if (!cancelled) setTaskData(task);
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

  const statusColor =
    item.status === 'completed'
      ? 'text-[#44FF44] bg-[#44FF44]/10 border-[#44FF44]/20'
      : item.status === 'failed'
        ? 'text-[#FF4444] bg-[#FF4444]/10 border-[#FF4444]/20'
        : 'text-[#8888AA] bg-[#8888AA]/10 border-[#8888AA]/20';

  const formatTime = (iso: string) => new Date(iso).toLocaleString('zh-CN');

  const finalAnswer =
    item.status === 'failed'
      ? item.error || '任务执行失败'
      : typeof item.result?.finalAnswer === 'string'
        ? item.result.finalAnswer
        : typeof item.result?.content === 'string'
          ? item.result.content
          : item.result
            ? JSON.stringify(item.result, null, 2)
            : '无最终结果';

  return (
    <div className="fixed inset-0 z-[100] flex justify-end">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      <div className="relative w-full max-w-xl h-full bg-[#121212] border-l border-[#3A3A4E] flex flex-col shadow-2xl animate-in slide-in-from-right duration-300">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#3A3A4E]">
          <div className="flex items-center gap-3">
            <MessageSquare className="w-5 h-5 text-[#00E0FF]" />
            <h2 className="text-base font-medium text-[#EAEAEA]">对话结果</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-[#2A2A3E] text-[#8888AA] hover:text-[#EAEAEA] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {loading && (
            <div className="flex items-center justify-center py-10 text-[#8888AA]">
              <div className="w-5 h-5 border-2 border-[#00E0FF] border-t-transparent rounded-full animate-spin mr-2" />
              加载详情...
            </div>
          )}

          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className={`px-2.5 py-0.5 rounded text-xs font-medium border ${statusColor}`}>
                {item.status === 'completed' ? '成功' : item.status === 'failed' ? '失败' : item.status}
              </span>
            </div>

            <h3 className="text-lg font-semibold text-[#EAEAEA]">{item.query}</h3>

            <div className="flex items-center gap-4 text-xs text-[#8888AA]">
              <span className="flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" />
                {formatTime(item.createdAt)}
              </span>
            </div>
          </div>

          <div className="bg-[#1E1E2E] rounded-xl border border-[#3A3A4E] p-4">
            <div className="flex items-center gap-2 text-xs text-[#8888AA] mb-2">
              {item.status === 'failed' ? (
                <>
                  <AlertCircle className="w-3.5 h-3.5 text-[#FF4444]" />
                  错误信息
                </>
              ) : (
                '最终结果'
              )}
            </div>
            <div className={`text-sm leading-relaxed whitespace-pre-wrap ${item.status === 'failed' ? 'text-[#FF4444]' : 'text-[#EAEAEA]'}`}>
              {finalAnswer}
            </div>
          </div>

          {taskData && <TaskTrace task={taskData} />}
        </div>
      </div>
    </div>
  );
}
