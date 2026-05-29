'use client';

import { useRef, useEffect, useState } from 'react';
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
  onToggleThinking: (msgId: string) => void;
  formatTime: (timestamp: number) => string;
  onSuggestion: (text: string) => void;
}

const SUGGESTIONS: Array<{ label: string; prompt: string }> = [
  /* 暂时注释
  { label: '分析东海近期态势', prompt: '分析东海近期态势' },
  { label: '查询商船 Voyager 01', prompt: '查询商船 Voyager 01' },
  { label: '订阅每日日报', prompt: '订阅每日日报' },
  { label: '生成专项报告', prompt: '生成专项报告' },
  */
  {
    label: '排查漏油',
    prompt:
      '查询中国东海区域海面疑似油污痕迹，调用天基信息服务系统获取相关影像及油膜信息，结合气象数据反推排污时间，匹配AIS轨迹筛选疑似肇事船舶并完成排序研判。',
  },
  // {
  //   label: '订阅火情',
  //   prompt: '订阅新疆边境与哈萨克斯坦接壤管段火情智能研判服务',
  // },
  {
    label: '火情研判',
    prompt: '火情研判·新疆-哈萨克斯坦接壤段',
  },
  {
    label: '地震评估',
    prompt:
      '对柳州柳南区 5.2 级地震做灾后评估，先查询中国地震台网中心、广西地震局官网获取地震基础信息，先获取震前最新历史影像，再提交天基信息服务需求获取震后最新影像，自动对比识别损毁情况并完成灾后评估。',
  },
  {
    label: '洪水评估',
    prompt:
      '对湖南石门县暴雨洪涝做灾后评估，先查询国家气象信息中心、湖南省气象局、水利部水文信息官网获取暴雨权威信息，先获取暴雨前最新历史影像，再提交天基信息服务需求获取暴雨后最新影像，自动对比识别淹没情况并完成洪涝灾后评估。',
  },
  // {
  //   label: '定制',
  //   prompt:
  //     '定制南海海域船舶追踪智能研判服务，需要接入多源AIS数据、雷达回波和卫星遥感影像，实现异常航行行为自动识别与预警推送。',
  // },
];

function SuggestionButtons({ onSuggestion }: { onSuggestion: (text: string) => void }) {
  const [selected, setSelected] = useState<{ label: string; prompt: string } | null>(null);

  const handleConfirm = () => {
    if (selected) {
      onSuggestion(selected.prompt);
      setSelected(null);
    }
  };

  return (
    <>
      <div className="flex flex-wrap justify-center gap-2">
        {SUGGESTIONS.map(({ label, prompt }) => (
          <button
            key={label}
            onClick={() => setSelected({ label, prompt })}
            className="px-3 py-1.5 text-xs rounded-full bg-[#2A2A3E] text-[#00E0FF] hover:bg-[#00E0FF]/20 transition-colors"
          >
            {label}
          </button>
        ))}
      </div>

      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="bg-[#2A2A3E] border-[#3A3A4E] text-[#EAEAEA] sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-[#EAEAEA]">{selected?.label}</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <p className="text-sm text-[#8888AA] leading-relaxed">{selected?.prompt}</p>
          </div>
          <DialogFooter className="gap-2">
            <DialogClose asChild>
              <button
                onClick={() => setSelected(null)}
                className="px-4 py-2 rounded-lg bg-[#3A3A4E] text-[#EAEAEA] hover:bg-[#4A4A5E] transition-colors text-sm"
              >
                取消
              </button>
            </DialogClose>
            <button
              onClick={handleConfirm}
              className="px-4 py-2 rounded-lg bg-[#00E0FF] text-[#121212] hover:bg-[#00E0FF]/80 transition-colors text-sm font-medium"
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
    <div ref={containerRef} className="flex-1 overflow-y-auto p-4 space-y-4">
      {messages.length === 0 && (
        <div className="text-center py-8">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-[#00E0FF]/10 flex items-center justify-center">
            <span className="text-3xl">🔍</span>
          </div>
          <div className="text-[#EAEAEA] font-medium mb-2">您好，我是天元，您的信息服务智能助手</div>
          <div className="text-sm text-[#8888AA] max-w-xs mx-auto">
            我可以帮您分析海域态势、查询实体信息、订阅定时任务、生成态势报告
          </div>
          <div className="mt-6">
            <SuggestionButtons onSuggestion={onSuggestion} />
          </div>
        </div>
      )}

      {messages.map((msg) => (
        <ChatMessage
          key={msg.id}
          msg={msg}
          onToggleThinking={onToggleThinking}
          formatTime={formatTime}
        />
      ))}

      {showSuggestionsAfterMsg && <SuggestionButtons onSuggestion={onSuggestion} />}

      {isLoading && (
        <div className="flex justify-start">
          <div className="bg-[#2A2A3E] rounded-lg p-4">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-[#00E0FF] rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
              <div className="w-2 h-2 bg-[#00E0FF] rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <div className="w-2 h-2 bg-[#00E0FF] rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          </div>
        </div>
      )}
      <div ref={messagesEndRef} />
    </div>
  );
}

