import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { Check, Copy } from "lucide-react";

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

export function MarkdownRenderer({ content, className = "" }: MarkdownRendererProps) {
  return (
    <div className={`markdown-content space-y-2.5 text-[12.5px] leading-relaxed text-ink-100 ${className}`}>
      <ReactMarkdown
        components={{
          h1: ({ children }) => (
            <h1 className="mt-3 mb-1.5 text-[15px] font-bold text-white tracking-tight border-b border-base-750 pb-1">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="mt-2.5 mb-1 text-[13.5px] font-semibold text-white tracking-tight">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="mt-2 mb-1 text-[12.5px] font-semibold text-electric">
              {children}
            </h3>
          ),
          p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
          ul: ({ children }) => (
            <ul className="mb-2 ml-4 list-disc space-y-1 text-ink-200">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="mb-2 ml-4 list-decimal space-y-1 text-ink-200">{children}</ol>
          ),
          li: ({ children }) => <li className="pl-0.5">{children}</li>,
          blockquote: ({ children }) => (
            <blockquote className="my-2 border-l-2 border-electric/60 bg-base-900/60 px-3 py-1.5 text-ink-300 italic rounded-r">
              {children}
            </blockquote>
          ),
          strong: ({ children }) => (
            <strong className="font-semibold text-white">{children}</strong>
          ),
          code: ({ inline, className: codeClassName, children, ...props }: any) => {
            const match = /language-(\w+)/.exec(codeClassName || "");
            const language = match ? match[1] : "";
            const codeString = String(children).replace(/\n$/, "");

            if (inline) {
              return (
                <code
                  className="rounded bg-base-800 px-1.5 py-0.5 font-mono text-[11px] text-cyan border border-base-700/60"
                  {...props}
                >
                  {children}
                </code>
              );
            }

            return (
              <CodeBlock code={codeString} language={language} />
            );
          },
          table: ({ children }) => (
            <div className="my-2.5 overflow-x-auto rounded-lg border border-base-700/80">
              <table className="min-w-full divide-y divide-base-700 text-left text-[11.5px]">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-base-900/90 text-ink-300 uppercase tracking-wider text-[10px] font-semibold">
              {children}
            </thead>
          ),
          tbody: ({ children }) => (
            <tbody className="divide-y divide-base-800 bg-base-950/40 text-ink-200">
              {children}
            </tbody>
          ),
          tr: ({ children }) => <tr className="hover:bg-base-900/50">{children}</tr>,
          th: ({ children }) => <th className="px-3 py-2 font-medium">{children}</th>,
          td: ({ children }) => <td className="px-3 py-1.5">{children}</td>,
          hr: () => <hr className="my-3 border-base-750" />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function CodeBlock({ code, language }: { code: string; language: string }) {
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="group relative my-2.5 rounded-lg border border-base-700 bg-base-950 font-mono text-[11px] shadow-panel overflow-hidden">
      <div className="flex items-center justify-between border-b border-base-800 bg-base-900/80 px-3 py-1 text-[10px] text-ink-400">
        <span className="uppercase tracking-wider font-semibold text-ink-400">
          {language || "code"}
        </span>
        <button
          onClick={onCopy}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-ink-400 transition-colors hover:bg-base-800 hover:text-white"
          title="Copy code to clipboard"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3 text-good" />
              <span className="text-good">Copied!</span>
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 text-ink-200 leading-relaxed scrollbar-thin">
        <code>{code}</code>
      </pre>
    </div>
  );
}
