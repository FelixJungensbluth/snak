import { memo, useCallback, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import remarkGfm from "remark-gfm";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import { Copy, Check } from "lucide-react";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useTabStore } from "../stores/tabStore";
import { usePaneStore } from "../stores/paneStore";
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

const MENTION_PREFIX = "snak-mention://";

/** Convert @[filename] and @{filename} to markdown links with a special protocol */
function preprocessMentions(content: string): string {
  return content
    .replace(/@\[([^\]]+)\]/g, (_, name) => {
      return `[@${name.trim()}](${MENTION_PREFIX}${encodeURIComponent(name.trim())})`;
    })
    .replace(/@\{([^}]+)\}/g, (_, name) => {
      return `[@${name.trim()}](${MENTION_PREFIX}${encodeURIComponent(name.trim())})`;
    });
}

function MentionLink({ href, children }: { href?: string; children?: React.ReactNode }) {
  const fileNodes = useWorkspaceStore((s) => s.index.fileNodes);
  const openTab = useTabStore((s) => s.openTab);
  const focusedPaneId = usePaneStore((s) => s.focusedPaneId);

  if (href?.startsWith(MENTION_PREFIX)) {
    const name = decodeURIComponent(href.slice(MENTION_PREFIX.length));
    const node = fileNodes.find((n) => n.name === name);
    return (
      <button
        className="inline text-accent-hover underline decoration-accent-hover/40 hover:decoration-accent-hover cursor-pointer bg-transparent border-none p-0 font-inherit text-inherit"
        onClick={() => {
          if (node) openTab(focusedPaneId, node.id);
        }}
        title={node ? `Open ${name}` : `${name} (not found)`}
      >
        {children}
      </button>
    );
  }

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
  a: MentionLink,
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
  const processed = preprocessMentions(content);
  return (
    <ReactMarkdown
      remarkPlugins={REMARK_PLUGINS}
      rehypePlugins={REHYPE_PLUGINS}
      components={MD_COMPONENTS}
    >
      {processed}
    </ReactMarkdown>
  );
});

export default MarkdownRenderer;
