'use client';

import { Children, isValidElement } from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ChartRenderer, type ChartRenderData } from './ChartRenderer';

interface MarkdownContentProps {
  content: string;
  charts?: ChartRenderData[];
  variant?: 'default' | 'compact';
}

function findChartById(charts: ChartRenderData[] | undefined, chartId: string): ChartRenderData | undefined {
  if (!charts || charts.length === 0) return undefined;
  return charts.find((chart) => chart.chart_id === chartId);
}

export default function MarkdownContent({ content, charts, variant = 'default' }: MarkdownContentProps) {
  const compact = variant === 'compact';
  const referencedChartIds = new Set(
    Array.from(content.matchAll(/chart:\/\/([^\s)]+)/g), (match) => match[1])
  );
  const unreferencedCharts = charts?.filter((chart) => !referencedChartIds.has(chart.chart_id)) ?? [];

  return (
    <>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={(url) => url.startsWith('chart://') ? url : defaultUrlTransform(url)}
        components={{
        h1: ({ children }) => <h1 className={`font-bold text-[#EAEAEA] first:mt-0 ${compact ? 'mt-2 mb-1 text-xs' : 'mt-3 mb-2 border-b border-[#3A3A4E] pb-1.5 text-lg'}`}>{children}</h1>,
        h2: ({ children }) => <h2 className={`font-bold text-[#EAEAEA] first:mt-0 ${compact ? 'mt-2 mb-1 text-xs' : 'mt-3 mb-2 border-l-2 border-[#00E0FF] pl-2 text-base'}`}>{children}</h2>,
        h3: ({ children }) => <h3 className={`font-bold text-[#DDEAF2] first:mt-0 ${compact ? 'mt-2 mb-1 text-[11px]' : 'mt-2 mb-1 text-sm'}`}>{children}</h3>,
        p: ({ children }) => {
          const containsChart = Children.toArray(children).some((child) => {
            if (!isValidElement<{ src?: unknown }>(child)) return false;
            return typeof child.props.src === 'string' && child.props.src.startsWith('chart://');
          });

          // 图表会渲染为块级 div，不能嵌套在 Markdown 默认生成的 p 中。
          const className = compact
            ? "mb-1 break-words font-mono text-[11px] leading-5 text-[#D8D8E8] last:mb-0"
            : "mb-2 break-words text-sm leading-7 text-[#EAEAEA] last:mb-0";
          return containsChart
            ? <div className={className}>{children}</div>
            : <p className={className}>{children}</p>;
        },
        strong: ({ children }) => <strong className="font-bold text-[#EAEAEA]">{children}</strong>,
        em: ({ children }) => <em className="italic text-[#EAEAEA]">{children}</em>,
        a: ({ children, href }) => (
          <a href={href} className="text-[#00E0FF] hover:underline" target="_blank" rel="noopener noreferrer">
            {children}
          </a>
        ),
        code: ({ children, className }) => {
          const block = Boolean(className) || String(children).includes('\n');
          return block
            ? <code className={`${className || ''} font-mono ${compact ? 'text-[11px]' : 'text-xs'} leading-5 text-[#FFD080]`}>{children}</code>
            : <code className={`rounded bg-[#1A1A28] px-1 py-0.5 font-mono text-[#FFAA00] ${compact ? 'text-[11px]' : 'text-xs'}`}>{children}</code>;
        },
        pre: ({ children }) => <pre className="my-2 max-h-96 overflow-auto rounded-md border border-[#3A3A4E] bg-[#10101C] p-3">{children}</pre>,
        blockquote: ({ children }) => (
          <blockquote className="border-l-2 border-[#00E0FF] pl-3 text-[#8888AA] italic my-2">
            {children}
          </blockquote>
        ),
        ul: ({ children }) => <ul className="list-disc pl-4 my-2">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal pl-4 my-2">{children}</ol>,
        li: ({ children }) => <li className={`mb-1 text-[#EAEAEA] ${compact ? 'font-mono text-[11px] leading-5' : 'text-sm'}`}>{children}</li>,
        hr: () => <hr className="border-[#3A3A4E] my-3" />,
        img: ({ src, alt }) => {
          if (typeof src === 'string' && src.startsWith('chart://')) {
            const chartId = src.slice('chart://'.length);
            const chartData = findChartById(charts, chartId);
            if (chartData) {
              return <ChartRenderer chartData={chartData} />;
            }
            return (
              <div className="text-sm text-[#8888AA] italic my-2">
                [图表 {chartId} 暂无数据]
              </div>
            );
          }
          return <img src={src} alt={alt} className="max-w-full rounded" />;
        },
        table: ({ children }) => <div className={`${compact ? 'my-2' : 'my-3'} max-w-full overflow-x-auto rounded border border-[#3A3A4E]`}><table className={`min-w-full border-collapse ${compact ? 'font-mono text-[11px]' : 'text-sm'}`}>{children}</table></div>,
        thead: ({ children }) => <thead className="bg-[#1A1A28]">{children}</thead>,
        th: ({ children }) => (
          <th className="whitespace-nowrap border-b border-r border-[#3A3A4E] px-3 py-2 text-left font-medium text-[#DDF8FF] last:border-r-0">{children}</th>
        ),
        td: ({ children }) => (
          <td className="border-b border-r border-[#3A3A4E] px-3 py-2 align-top text-[#EAEAEA] last:border-r-0">{children}</td>
        ),
        }}
      >
        {content}
      </ReactMarkdown>
      {unreferencedCharts.map((chart) => (
        <ChartRenderer key={chart.chart_id} chartData={chart} />
      ))}
    </>
  );
}
