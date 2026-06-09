'use client';

import { Brain, CheckCircle2, Loader2, AlertCircle, Lightbulb, Clock3, ChevronDown, ChevronUp } from 'lucide-react';
import { ChatMessage as ChatMessageType, ThinkingStep } from '@/types/prd';

interface ThinkingProcessProps {
  msg: ChatMessageType;
  onToggle: () => void;
}

function StepIcon({ status }: { status: ThinkingStep['status'] }) {
  switch (status) {
    case 'completed':
      return <CheckCircle2 className="w-3.5 h-3.5 text-[#44FF44] shrink-0" />;
    case 'running':
      return <Loader2 className="w-3.5 h-3.5 text-[#00E0FF] shrink-0 animate-spin" />;
    case 'failed':
      return <AlertCircle className="w-3.5 h-3.5 text-[#FF4444] shrink-0" />;
    default:
      return <Clock3 className="w-3.5 h-3.5 text-[#8888AA] shrink-0" />;
  }
}

function StepBadge({ step }: { step: ThinkingStep }) {
  const label =
    step.category === 'gis'
      ? 'GIS'
      : step.category === 'result'
        ? 'Result'
        : step.category === 'agent'
          ? 'Agent'
          : step.category === 'tool'
            ? 'Tool'
            : step.eventType;

  if (!label) return null;

  const colorClass =
    step.category === 'gis'
      ? 'border-[#00E0FF]/40 text-[#00E0FF]'
      : step.category === 'result'
        ? 'border-[#44FF44]/40 text-[#44FF44]'
        : step.category === 'agent'
          ? 'border-[#FFAA00]/40 text-[#FFAA00]'
          : 'border-[#8888AA]/40 text-[#C8C8DA]';

  return (
    <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] leading-none ${colorClass}`}>
      {label}
    </span>
  );
}

export default function ThinkingProcess({ msg, onToggle }: ThinkingProcessProps) {
  if (!msg.thinking && !msg.thinkingSteps && !msg.agentLoopLogFilePath) return null;

  return (
    <div className="mb-3 border border-[#3A3A4E] rounded-md overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-3 py-2 bg-[#1E1E2E] hover:bg-[#252536] transition-colors"
      >
        <div className="flex items-center gap-2">
          <Brain className="w-3.5 h-3.5 text-[#00E0FF]" />
          <span className="text-xs text-[#00E0FF] font-medium">思考过程</span>
          {msg.thinkingSteps && (
            <span className="text-xs text-[#8888AA]">
              {msg.thinkingSteps.filter((s) => s.status === 'completed').length}/
              {msg.thinkingSteps.length} 步
            </span>
          )}
        </div>
        {msg.isThinkingExpanded ? (
          <ChevronUp className="w-3.5 h-3.5 text-[#8888AA]" />
        ) : (
          <ChevronDown className="w-3.5 h-3.5 text-[#8888AA]" />
        )}
      </button>

      {msg.isThinkingExpanded && (
        <div className="px-3 py-2.5 space-y-2 bg-[#1A1A28]">
          {msg.agentLoopLogFilePath && (
            <div className="rounded border border-[#3A3A4E] bg-[#121220] px-2 py-1.5">
              <div className="text-[10px] uppercase tracking-normal text-[#8888AA]">
                Agent Loop Log
              </div>
              <div className="mt-0.5 break-all font-mono text-[11px] leading-relaxed text-[#C8C8DA]">
                {msg.agentLoopLogFilePath}
              </div>
            </div>
          )}

          {msg.thinking && (
            <div className="flex gap-2 text-xs text-[#8888AA] leading-relaxed">
              <Lightbulb className="w-3.5 h-3.5 text-[#FFAA00] shrink-0 mt-0.5" />
              <div className="whitespace-pre-wrap">{msg.thinking}</div>
            </div>
          )}

          {msg.thinkingSteps && msg.thinkingSteps.length > 0 && (
            <div className="space-y-1.5 mt-2">
              <div className="text-xs text-[#8888AA] mb-1">执行步骤</div>
              {msg.thinkingSteps.map((step) => (
                <div
                  key={step.id}
                  className="flex items-start gap-2 p-1.5 rounded bg-[#2A2A3E]/60"
                >
                  <StepIcon status={step.status} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <StepBadge step={step} />
                        <span className="text-xs text-[#EAEAEA] font-medium truncate">
                          {step.name}
                        </span>
                        {step.toolName && step.toolName !== step.name && (
                          <span className="text-[10px] text-[#8888AA] truncate">
                            {step.toolName}
                          </span>
                        )}
                      </div>
                      {step.duration && (
                        <span className="text-[10px] text-[#8888AA] tabular-nums">
                          {step.duration}ms
                        </span>
                      )}
                    </div>
                    {step.detail && (
                      <div className="text-[11px] text-[#8888AA] mt-0.5 truncate">
                        {step.detail}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
