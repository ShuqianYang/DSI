export const riskStyleMap: Record<string, string> = {
  high: 'border-[#FF4444] text-[#FF4444]',
  medium: 'border-[#FFAA00] text-[#FFAA00]',
  low: 'border-[#FFFF44] text-[#FFFF44]',
  safe: 'border-[#44FF44] text-[#44FF44]',
};

export function getRiskStyle(level: string): string {
  return riskStyleMap[level] ?? riskStyleMap.safe;
}

export const categoryLabelMap: Record<string, string> = {
  geopolitics: '地缘政治',
  military: '军事动态',
  industry: '行业风险',
};

export function getCategoryLabel(category: string): string {
  return categoryLabelMap[category] ?? category;
}

export const taskStatusStyleMap: Record<string, string> = {
  running: 'text-[#FFAA00] bg-[#FFAA00]/10 border-[#FFAA00]/30',
  partial: 'text-[#FFAA00] bg-[#FFAA00]/10 border-[#FFAA00]/30',
  completed: 'text-[#44FF44] bg-[#44FF44]/10 border-[#44FF44]/30',
  failed: 'text-[#FF4444] bg-[#FF4444]/10 border-[#FF4444]/30',
  default: 'text-[#8888AA] bg-[#8888AA]/10 border-[#8888AA]/30',
};

export function getTaskStatusStyle(status: string): string {
  return taskStatusStyleMap[status] ?? taskStatusStyleMap.default;
}

export const taskStatusLabelMap: Record<string, string> = {
  running: '进行中',
  completed: '已完成',
  partial: '进行中',
  failed: '失败',
};

export function getTaskStatusLabel(status: string): string {
  return taskStatusLabelMap[status] ?? status;
}

export const subTaskStatusLabelMap: Record<string, string> = {
  running: '执行中',
  completed: '已完成',
  failed: '失败',
};

export function getSubTaskStatusLabel(status: string): string {
  return subTaskStatusLabelMap[status] ?? '等待中';
}

export const eventStatusStyleMap: Record<string, string> = {
  success: 'border-l-[#44FF44] bg-[#44FF44]/5',
  partial: 'border-l-[#FFAA00] bg-[#FFAA00]/5',
  failed: 'border-l-[#FF4444] bg-[#FF4444]/5',
  default: 'border-l-[#8888AA] bg-[#8888AA]/5',
};

export function getEventStatusStyle(status: string): string {
  return eventStatusStyleMap[status] ?? eventStatusStyleMap.default;
}

export function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now.getTime() - timestamp;

  if (diff < 3600000) {
    return Math.floor(diff / 60000) + '分钟前';
  }
  if (diff < 86400000) {
    return Math.floor(diff / 3600000) + '小时前';
  }
  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

export function formatFullTime(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (n: number) => String(n).padStart(2, '0');
  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const h = pad(date.getHours());
  const min = pad(date.getMinutes());
  const s = pad(date.getSeconds());
  return `${y}-${m}-${d} ${h}:${min}:${s}`;
}
