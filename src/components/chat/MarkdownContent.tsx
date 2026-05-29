'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MarkdownContentProps {
  content: string;
}

export default function MarkdownContent({ content }: MarkdownContentProps) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children }) => <h1 className="text-lg font-bold text-[#EAEAEA] mt-3 mb-2">{children}</h1>,
        h2: ({ children }) => <h2 className="text-base font-bold text-[#EAEAEA] mt-3 mb-2">{children}</h2>,
        h3: ({ children }) => <h3 className="text-sm font-bold text-[#EAEAEA] mt-2 mb-1">{children}</h3>,
        p: ({ children }) => <p className="text-sm text-[#EAEAEA] leading-relaxed mb-2">{children}</p>,
        strong: ({ children }) => <strong className="font-bold text-[#EAEAEA]">{children}</strong>,
        em: ({ children }) => <em className="italic text-[#EAEAEA]">{children}</em>,
        a: ({ children, href }) => (
          <a href={href} className="text-[#00E0FF] hover:underline" target="_blank" rel="noopener noreferrer">
            {children}
          </a>
        ),
        code: ({ children, className }) => {
          const isInline = !className;
          return isInline ? (
            <code className="bg-[#1A1A28] text-[#FFAA00] px-1 py-0.5 rounded text-xs font-mono">{children}</code>
          ) : (
            <pre className="bg-[#1A1A28] p-3 rounded-md overflow-x-auto my-2">
              <code className={`${className} text-xs font-mono text-[#FFAA00]`}>{children}</code>
            </pre>
          );
        },
        blockquote: ({ children }) => (
          <blockquote className="border-l-2 border-[#00E0FF] pl-3 text-[#8888AA] italic my-2">
            {children}
          </blockquote>
        ),
        ul: ({ children }) => <ul className="list-disc pl-4 my-2">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal pl-4 my-2">{children}</ol>,
        li: ({ children }) => <li className="text-sm text-[#EAEAEA] mb-1">{children}</li>,
        hr: () => <hr className="border-[#3A3A4E] my-3" />,
        table: ({ children }) => (
          <table className="w-full text-sm border-collapse my-2">{children}</table>
        ),
        thead: ({ children }) => <thead className="bg-[#1A1A28]">{children}</thead>,
        th: ({ children }) => (
          <th className="border border-[#3A3A4E] px-2 py-1 text-left text-[#EAEAEA] font-medium">{children}</th>
        ),
        td: ({ children }) => (
          <td className="border border-[#3A3A4E] px-2 py-1 text-[#EAEAEA]">{children}</td>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
