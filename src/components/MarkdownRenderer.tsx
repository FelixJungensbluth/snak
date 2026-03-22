import { memo, useCallback, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import remarkGfm from "remark-gfm";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import { Copy, Check } from "lucide-react";
import "katex/dist/katex.min.css";
import "highlight.js/styles/github-dark.min.css";

// Stable plugin arrays — avoids re-creating on every render
const REMARK_PLUGINS = [remarkMath, remarkGfm];
const REHYPE_PLUGINS = [rehypeKatex, rehypeHighlight];

function CopyButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  }, [code]);

  return (
    <button
      onClick={handleCopy}
      className="absolute top-1.5 right-1.5 p-1 rounded bg-surface-hover text-fg-muted hover:text-fg transition-colors opacity-0 group-hover:opacity-100"
      title="Copy code"
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
    </button>
  );
}

function extractText(node: unknown): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (node && typeof node === "object" && "props" in (node as Record<string, unknown>)) {
    const props = (node as { props?: { children?: unknown } }).props;
    return extractText(props?.children);
  }
  return "";
}

// Stable components config — defined once, never recreated
const MD_COMPONENTS = {
  pre({ children }: { children?: React.ReactNode }) {
    const code = extractText(children);
    return (
      <div className="relative group my-3">
        <CopyButton code={code} />
        <pre className="overflow-x-auto rounded-lg bg-bg border border-border p-3.5 text-[12px] leading-[1.6]">
          {children}
        </pre>
      </div>
    );
  },
  code({ className, children, ...props }: React.HTMLAttributes<HTMLElement>) {
    const isBlock = className?.startsWith("hljs") || className?.includes("language-");
    if (isBlock) {
      return (
        <code className={className} {...props}>
          {children}
        </code>
      );
    }
    return (
      <code className="bg-surface-raised px-1.5 py-0.5 rounded text-[12px] border border-border" {...props}>
        {children}
      </code>
    );
  },
  a({ href, children }: { href?: string; children?: React.ReactNode }) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-accent-hover underline"
      >
        {children}
      </a>
    );
  },
  img({ src, alt }: { src?: string; alt?: string }) {
    return (
      <img
        src={src}
        alt={alt ?? ""}
        className="max-w-full rounded my-2"
        loading="lazy"
      />
    );
  },
};

const MarkdownRenderer = memo(function MarkdownRenderer({
  content,
}: {
  content: string;
}) {
  return (
    <ReactMarkdown
      remarkPlugins={REMARK_PLUGINS}
      rehypePlugins={REHYPE_PLUGINS}
      components={MD_COMPONENTS}
    >
      {content}
    </ReactMarkdown>
  );
});

export default MarkdownRenderer;
