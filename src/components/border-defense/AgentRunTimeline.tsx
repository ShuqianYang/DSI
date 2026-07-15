"use client";

import { useState } from "react";
import { AlertCircle, Brain, CheckCircle2, ChevronDown, ChevronUp, Clock3, Loader2 } from "lucide-react";
import MarkdownContent from "@/components/chat/MarkdownContent";
import type { ThinkingStep } from "@/types/prd";
import type { LoopOutcome } from "./types";
import { AgentLoopOutcome } from "./AgentLoopOutcome";

function Icon({ status }: { status: ThinkingStep["status"] }) {
  if (status === "completed") return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[#44FF44]" />;
  if (status === "failed") return <AlertCircle className="h-3.5 w-3.5 shrink-0 text-[#FF4444]" />;
  if (status === "running") return <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[#00E0FF]" />;
  return <Clock3 className="h-3.5 w-3.5 shrink-0 text-[#8888AA]" />;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function stringify(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    const text = JSON.stringify(value, null, 2);
    if (!text) return String(value ?? "");
    return text.length > 12000 ? `${text.slice(0, 12000)}\n… 内容过长，已截断` : text;
  } catch {
    return String(value);
  }
}

function compactMarkdown(value: string): string {
  return value
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/^[>|*-]\s+/gm, "")
    .replace(/\|/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function CodeBlock({ children }: { children: string }) {
  return <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded border border-[#3A3A4E] bg-[#121220] p-2 font-mono text-[11px] leading-5 text-[#D8D8E8]">{children}</pre>;
}

function ResultTable({ output }: { output: Record<string, unknown> }) {
  const rows = Array.isArray(output.rows) ? output.rows.filter((row) => asRecord(row)) as Record<string, unknown>[] : [];
  if (rows.length === 0) return <CodeBlock>{stringify(output)}</CodeBlock>;
  const configuredColumns = Array.isArray(output.columns) ? output.columns.filter((item): item is string => typeof item === "string") : [];
  const columns = configuredColumns.length > 0 ? configuredColumns : Object.keys(rows[0]);
  return (
    <div className="space-y-2">
      <div className="text-[10px] text-[#8888AA]">返回 {String(output.rowCount ?? rows.length)} 行{typeof output.durationMs === "number" ? ` · ${output.durationMs}ms` : ""}</div>
      <div className="max-h-72 overflow-auto rounded border border-[#3A3A4E]">
        <table className="min-w-full border-collapse text-left text-[10px]">
          <thead className="sticky top-0 bg-[#202033] text-[#00E0FF]">
            <tr>{columns.map((column) => <th key={column} className="whitespace-nowrap border-b border-[#3A3A4E] px-2 py-1.5 font-medium">{column}</th>)}</tr>
          </thead>
          <tbody>{rows.slice(0, 20).map((row, index) => <tr key={index} className="odd:bg-[#181826]">
            {columns.map((column) => <td key={column} className="max-w-64 whitespace-pre-wrap break-words border-b border-[#2D2D40] px-2 py-1.5 align-top text-[#D8D8E8]">{typeof row[column] === "object" ? stringify(row[column]) : String(row[column] ?? "-")}</td>)}
          </tr>)}</tbody>
        </table>
      </div>
      {rows.length > 20 && <div className="text-[10px] text-[#8888AA]">仅展示前 20 行</div>}
    </div>
  );
}

function DetailSection({ title, value }: { title: string; value: unknown }) {
  if (value === undefined) return null;
  return <div className="space-y-1"><div className="text-[10px] font-medium text-[#8888AA]">{title}</div><CodeBlock>{stringify(value)}</CodeBlock></div>;
}

function StepDetails({ step }: { step: ThinkingStep }) {
  const input = asRecord(step.input);
  const output = asRecord(step.output);
  const agentMarkdown = step.category === "agent" && typeof step.output === "string" ? step.output : undefined;
  const sql = typeof input?.sql === "string" ? input.sql : undefined;
  const otherInput = agentMarkdown ? undefined : input && sql ? Object.fromEntries(Object.entries(input).filter(([key]) => key !== "sql")) : step.input;
  return <div className="space-y-2 border-t border-[#3A3A4E]/70 px-2 pb-2 pt-2">
    {step.detail && !agentMarkdown && <div className="whitespace-pre-wrap text-[11px] leading-5 text-[#B8B8CA]"><span className="mr-2 text-[10px] text-[#8888AA]">执行说明</span>{step.detail}</div>}
    {agentMarkdown && <div className="rounded border border-[#3A3A4E] bg-[#171725] px-3 py-2"><div className="mb-1 text-[10px] font-medium text-[#8888AA]">本轮输出</div><MarkdownContent content={agentMarkdown} variant="compact" /></div>}
    {sql && <DetailSection title="执行 SQL" value={sql} />}
    {otherInput !== undefined && <DetailSection title={sql ? "调用参数" : "输入参数"} value={otherInput} />}
    {!agentMarkdown && (output ? <div className="space-y-1"><div className="text-[10px] font-medium text-[#8888AA]">执行结果</div>{step.toolName === "MysqlQuery" ? <ResultTable output={output} /> : <CodeBlock>{stringify(output)}</CodeBlock>}</div> : <DetailSection title={step.category === "agent" ? "本轮输出" : "执行结果"} value={step.output} />)}
  </div>;
}

export function AgentRunTimeline({ steps, outcome, expanded, onToggle }: { steps: ThinkingStep[]; outcome?: LoopOutcome; expanded: boolean; onToggle: () => void }) {
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(() => new Set());
  const completed = steps.filter((step) => step.status === "completed").length;
  const toggleStep = (id: string) => setExpandedSteps((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  return (
    <div className="mb-3 overflow-hidden rounded-md border border-[#3A3A4E]">
      <button onClick={onToggle} className="flex w-full items-center justify-between bg-[#1E1E2E] px-3 py-2 hover:bg-[#252536]">
        <span className="flex items-center gap-2 text-xs font-medium text-[#00E0FF]"><Brain className="h-3.5 w-3.5" />执行过程 <span className="text-[#8888AA]">{completed}/{steps.length} 步</span></span>
        {expanded ? <ChevronUp className="h-3.5 w-3.5 text-[#8888AA]" /> : <ChevronDown className="h-3.5 w-3.5 text-[#8888AA]" />}
      </button>
      {expanded && <div className="space-y-2 bg-[#1A1A28] p-3">
        {steps.map((step) => {
          const isOpen = expandedSteps.has(step.id);
          const canExpand = Boolean(step.detail) || step.input !== undefined || step.output !== undefined;
          return <div key={step.id} className="overflow-hidden rounded bg-[#2A2A3E]/60">
            <button type="button" disabled={!canExpand} onClick={() => canExpand && toggleStep(step.id)} className="flex w-full items-start gap-2 p-2 text-left enabled:hover:bg-[#34344A]/70 disabled:cursor-default">
              <Icon status={step.status} />
              <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="rounded border border-[#8888AA]/40 px-1.5 py-0.5 text-[10px] text-[#C8C8DA]">{step.category === "agent" ? "智能体" : step.category === "result" ? "结果" : "工具"}</span><span className="truncate text-xs font-medium">{step.name}</span></div>{step.detail && <div className="mt-1 truncate text-[11px] leading-4 text-[#8888AA]">{step.category === "agent" ? compactMarkdown(step.detail) : step.detail}</div>}</div>
              {canExpand && (isOpen ? <ChevronUp className="h-3.5 w-3.5 shrink-0 text-[#8888AA]" /> : <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[#8888AA]" />)}
            </button>
            {isOpen && <StepDetails step={step} />}
          </div>;
        })}
        {outcome && <AgentLoopOutcome value={outcome} />}
      </div>}
    </div>
  );
}
