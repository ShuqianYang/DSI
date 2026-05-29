'use client';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useState } from 'react';
import { AlertCircle, Eye, FileText, MapPin, Terminal, Copy, Check } from 'lucide-react';
import type { InfoItem } from '@/lib/api';

interface InfoTableProps {
  items: InfoItem[];
  loading?: boolean;
  onViewDetail?: (item: InfoItem) => void;
}

function ApiModal({ item, onClose }: { item: InfoItem; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
  const detailUrl = item.itemType === 'event'
    ? `${apiBase}/events/${item.id}`
    : `${apiBase}/insights/${item.id}`;
  const taskUrl = item.agentTaskId ? `${apiBase}/tasks/${item.agentTaskId}` : null;

  const copy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-md bg-[#1E1E2E] border border-[#3A3A4E] rounded-xl shadow-2xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 text-[#EAEAEA] font-medium">
            <Terminal className="w-4 h-4 text-[#00E0FF]" />
            API 接口
          </div>
          <button onClick={onClose} className="text-[#8888AA] hover:text-[#EAEAEA]">✕</button>
        </div>

        <div className="space-y-4">
          {/* 详情接口 */}
          <div>
            <div className="text-xs text-[#8888AA] mb-1.5">{item.itemType === 'event' ? '事件' : '洞察'}详情接口</div>
            <div className="bg-[#121212] rounded-lg border border-[#3A3A4E] p-3 flex items-center justify-between gap-2">
              <code className="text-xs text-[#00E0FF] font-mono break-all">GET {detailUrl}</code>
              <button
                onClick={() => copy(`GET ${detailUrl}`)}
                className="shrink-0 p-1.5 rounded hover:bg-[#2A2A3E] text-[#8888AA] hover:text-[#EAEAEA] transition-colors"
                title="复制"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-[#44FF44]" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>

          {/* 任务链路接口 */}
          {taskUrl && (
            <div>
              <div className="text-xs text-[#8888AA] mb-1.5">任务执行链路接口</div>
              <div className="bg-[#121212] rounded-lg border border-[#3A3A4E] p-3 flex items-center justify-between gap-2">
                <code className="text-xs text-[#00E0FF] font-mono break-all">GET {taskUrl}</code>
                <button
                  onClick={() => copy(`GET ${taskUrl}`)}
                  className="shrink-0 p-1.5 rounded hover:bg-[#2A2A3E] text-[#8888AA] hover:text-[#EAEAEA] transition-colors"
                  title="复制"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-[#44FF44]" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
          )}

          {/* 聚合列表接口 */}
          <div>
            <div className="text-xs text-[#8888AA] mb-1.5">信息中心聚合列表接口</div>
            <div className="bg-[#121212] rounded-lg border border-[#3A3A4E] p-3 flex items-center justify-between gap-2">
              <code className="text-xs text-[#00E0FF] font-mono break-all">GET {apiBase}/info-center</code>
              <button
                onClick={() => copy(`GET ${apiBase}/info-center`)}
                className="shrink-0 p-1.5 rounded hover:bg-[#2A2A3E] text-[#8888AA] hover:text-[#EAEAEA] transition-colors"
                title="复制"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-[#44FF44]" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  success: { label: '成功', color: 'text-[#44FF44]', bg: 'bg-[#44FF44]/10' },
  partial: { label: '部分成功', color: 'text-[#FFAA00]', bg: 'bg-[#FFAA00]/10' },
  failed: { label: '失败', color: 'text-[#FF4444]', bg: 'bg-[#FF4444]/10' },
  high: { label: '高危', color: 'text-[#FF4444]', bg: 'bg-[#FF4444]/10' },
  medium: { label: '中危', color: 'text-[#FFAA00]', bg: 'bg-[#FFAA00]/10' },
  low: { label: '低危', color: 'text-[#FFFF44]', bg: 'bg-[#FFFF44]/10' },
  safe: { label: '安全', color: 'text-[#44FF44]', bg: 'bg-[#44FF44]/10' },
};

function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status] || { label: status, color: 'text-[#8888AA]', bg: 'bg-[#8888AA]/10' };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${meta.color} ${meta.bg} border border-current/20`}>
      {meta.label}
    </span>
  );
}

function TypeBadge({ type }: { type: string }) {
  if (type === 'event') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-[#00E0FF]">
        <FileText className="w-3.5 h-3.5" />
        事件
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-[#FFAA00]">
      <Eye className="w-3.5 h-3.5" />
      洞察
    </span>
  );
}

function SourceBadge({ source }: { source?: string }) {
  if (source === 'instant') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium text-[#00E0FF] bg-[#00E0FF]/10 border border-[#00E0FF]/20">
        即时
      </span>
    );
  }
  if (source === 'subscription') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium text-[#FFAA00] bg-[#FFAA00]/10 border border-[#FFAA00]/20">
        订阅
      </span>
    );
  }
  return <span className="text-xs text-[#8888AA]">—</span>;
}

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function InfoTable({ items, loading, onViewDetail }: InfoTableProps) {
  const [apiItem, setApiItem] = useState<InfoItem | null>(null);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 text-[#8888AA]">
        <div className="w-5 h-5 border-2 border-[#00E0FF] border-t-transparent rounded-full animate-spin mr-2" />
        加载中...
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-[#8888AA]">
        <AlertCircle className="w-10 h-10 mb-3 opacity-30" />
        <div className="text-sm">暂无数据</div>
      </div>
    );
  }

  return (
    <div className="w-full overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="border-b border-[#3A3A4E] hover:bg-transparent">
            <TableHead className="text-[#8888AA] text-xs font-medium w-[80px]">类型</TableHead>
            <TableHead className="text-[#8888AA] text-xs font-medium">标题</TableHead>
            <TableHead className="text-[#8888AA] text-xs font-medium w-[160px]">关联任务</TableHead>
            <TableHead className="text-[#8888AA] text-xs font-medium w-[100px]">状态</TableHead>
            <TableHead className="text-[#8888AA] text-xs font-medium w-[80px]">来源</TableHead>
            <TableHead className="text-[#8888AA] text-xs font-medium w-[100px]">分类</TableHead>
            <TableHead className="text-[#8888AA] text-xs font-medium w-[140px]">时间</TableHead>
            <TableHead className="text-[#8888AA] text-xs font-medium w-[80px] text-right">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <TableRow
              key={`${item.itemType}-${item.id}`}
              className="border-b border-[#3A3A4E]/50 hover:bg-[#2A2A3E]/50 transition-colors cursor-pointer"
              onClick={() => onViewDetail?.(item)}
            >
              <TableCell>
                <TypeBadge type={item.itemType} />
              </TableCell>
              <TableCell>
                <div className="text-sm text-[#EAEAEA] font-medium truncate max-w-[280px]">
                  {item.title}
                </div>
                <div className="text-xs text-[#8888AA] truncate max-w-[280px] mt-0.5">
                  {item.summary}
                </div>
              </TableCell>
              <TableCell>
                {item.sourceTaskName ? (
                  <span className="text-xs text-[#00E0FF] bg-[#00E0FF]/10 px-2 py-0.5 rounded-full border border-[#00E0FF]/20 truncate max-w-[140px] inline-block">
                    {item.sourceTaskName}
                  </span>
                ) : (
                  <span className="text-xs text-[#8888AA]">—</span>
                )}
              </TableCell>
              <TableCell>
                <StatusBadge status={item.status} />
              </TableCell>
              <TableCell>
                <SourceBadge source={item.sourceTaskType} />
              </TableCell>
              <TableCell>
                {item.category ? (
                  <span className="text-xs text-[#EAEAEA]">
                    {item.category === 'geopolitics' ? '地缘' : item.category === 'military' ? '军事' : '产业'}
                  </span>
                ) : (
                  <span className="text-xs text-[#8888AA]">—</span>
                )}
              </TableCell>
              <TableCell>
                <span className="text-xs text-[#8888AA]">{formatTime(item.timestamp)}</span>
              </TableCell>
              <TableCell className="text-right">
                <div className="flex items-center justify-end gap-2">
                  {item.meta?.gisEnabled && (
                    <span title="含 GIS 数据">
                      <MapPin className="w-3.5 h-3.5 text-[#00E0FF]" />
                    </span>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setApiItem(item);
                    }}
                    className="text-xs text-[#8888AA] hover:text-[#EAEAEA] transition-colors"
                  >
                    API
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onViewDetail?.(item);
                    }}
                    className="text-xs text-[#00E0FF] hover:underline"
                  >
                    详情
                  </button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {apiItem && <ApiModal item={apiItem} onClose={() => setApiItem(null)} />}
    </div>
  );
}
