import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Send, Square } from "lucide-react";
import { type Chat, type Message } from "../stores/chatStore";
import { useSessionStore } from "../stores/sessionStore";
import { useUiStore } from "../stores/uiStore";
import { useChatEngine } from "../hooks/useChatEngine";

import ModelSelector from "./ModelSelector";
import MarkdownRenderer from "./MarkdownRenderer";
import { MODEL_CONTEXT_LIMITS, estimateTokens } from "../providers";

interface ChatViewProps {
  chatId: string;
}

export default function ChatView({ chatId }: ChatViewProps) {
  const { chat, loading, error, streamError, sendMessage, abort } = useChatEngine(chatId);

  const setScrollPosition = useSessionStore((s) => s.setScrollPosition);
  const scrollPositions = useSessionStore((s) => s.scrollPositions);
  const scrollToMessageId = useUiStore((s) => s.scrollToMessageId);
  const setScrollToMessageId = useUiStore((s) => s.setScrollToMessageId);

  const [input, setInput] = useState("");

  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const isInitialLoad = useRef(true);
  const prevMessageCount = useRef(0);

  // Restore saved scroll position when switching chats; scroll to bottom on load
  useEffect(() => {
    isInitialLoad.current = true;
    prevMessageCount.current = 0;
  }, [chatId]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !chat) return;

    if (isInitialLoad.current) {
      isInitialLoad.current = false;
      const saved = scrollPositions[chatId];
      if (saved != null) {
        el.scrollTop = saved;
      } else {
        // First time opening this chat — jump to bottom instantly
        el.scrollTop = el.scrollHeight;
      }
      prevMessageCount.current = chat.messages.length;
      return;
    }

    // Auto-scroll to bottom only when new messages are added (user sent or streaming)
    if (chat.messages.length > prevMessageCount.current || chat.streaming) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
    prevMessageCount.current = chat.messages.length;
  }, [chatId, chat?.messages.length, chat?.streaming, chat?.streamBuffer]);

  // Scroll to a specific message when navigating from search
  useEffect(() => {
    if (!scrollToMessageId || !chat || !scrollRef.current) return;
    // Defer to next frame so messages are rendered
    const frame = requestAnimationFrame(() => {
      const el = scrollRef.current?.querySelector(
        `[data-msg-id="${scrollToMessageId}"]`
      ) as HTMLElement | null;
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        // Flash highlight
        el.classList.add("search-highlight");
        setTimeout(() => el.classList.remove("search-highlight"), 2000);
      }
      setScrollToMessageId(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [scrollToMessageId, chat, setScrollToMessageId]);

  // Save scroll position on scroll (throttled) and before unmount / chat switch
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    let scrollTimer: ReturnType<typeof setTimeout> | null = null;
    const onScroll = () => {
      if (scrollTimer) return;
      scrollTimer = setTimeout(() => {
        scrollTimer = null;
        setScrollPosition(chatId, el.scrollTop);
      }, 150);
    };
    el.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      el.removeEventListener("scroll", onScroll);
      if (scrollTimer) clearTimeout(scrollTimer);
      setScrollPosition(chatId, el.scrollTop);
    };
  }, [chatId, setScrollPosition]);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text) return;
    setInput("");
    sendMessage(text);
  }, [input, sendMessage]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-fg-dim text-xs">
        Loading chat…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-fg-error text-xs">
        {error}
      </div>
    );
  }

  if (!chat) return null;

  return (
    <div className="flex flex-col h-full">
      {/* Message list */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {chat.messages.length === 0 && (
          <p className="text-xs text-fg-dim text-center mt-8">
            No messages yet. Start the conversation below.
          </p>
        )}
        {chat.messages.map((msg, i) => (
          <div key={msg.id} data-msg-id={msg.id}>
            <MessageBubble
              message={msg}
              isStreaming={
                chat.streaming &&
                i === chat.messages.length - 1 &&
                msg.role === "assistant"
              }
            />
          </div>
        ))}
        {streamError && (
          <div className="flex justify-start">
            <div className="max-w-[75%] px-3 py-2 text-xs leading-relaxed bg-surface-raised text-fg-error">
              Error: {streamError}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Token counter */}
      {chat.messages.length > 0 && <TokenCounter chat={chat} />}

      {/* Input area */}
      <div className="border-t border-border bg-surface relative">
        <div className="flex items-center gap-2 px-3 pt-2">
          <ModelSelector chatId={chatId} />
        </div>
        <div className="flex items-end">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message…"
            rows={1}
            disabled={chat.streaming}
            className="flex-1 resize-none bg-transparent text-fg text-xs px-3 py-3 outline-none min-h-[80px] max-h-[200px] disabled:opacity-50"
          />
          {chat.streaming ? (
            <button
              onClick={abort}
              className="border-l border-border px-3 text-fg-error hover:text-fg transition-colors self-stretch flex items-end pb-3"
              title="Stop generation"
            >
              <Square size={14} />
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!input.trim()}
              className="border-l border-border px-3 text-fg-muted hover:text-fg disabled:opacity-30 disabled:cursor-not-allowed transition-colors self-stretch flex items-end pb-3"
            >
              <Send size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const MessageBubble = memo(function MessageBubble({
  message,
  isStreaming,
}: {
  message: Message;
  isStreaming?: boolean;
}) {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";

  const isAssistant = message.role === "assistant";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[75%] px-3 py-2 text-xs leading-relaxed ${
          isUser
            ? "bg-accent text-fg whitespace-pre-wrap"
            : isSystem
              ? "bg-surface-raised text-fg-muted italic whitespace-pre-wrap"
              : "bg-surface-raised text-fg markdown-body"
        }`}
      >
        {isAssistant ? (
          <>
            <MarkdownRenderer content={message.content} />
            {isStreaming && <StreamingCursor />}
          </>
        ) : (
          <>
            {message.content}
            {isStreaming && <StreamingCursor />}
          </>
        )}
      </div>
    </div>
  );
});

function StreamingCursor() {
  return (
    <span className="inline-block w-[6px] h-[14px] bg-fg-muted ml-0.5 align-text-bottom animate-pulse" />
  );
}

const TokenCounter = memo(function TokenCounter({ chat }: { chat: Chat }) {
  const contextLimit = MODEL_CONTEXT_LIMITS[chat.model] ?? 128_000;

  const totalTokens = useMemo(
    () => chat.messages.reduce((sum, m) => sum + estimateTokens(m.content), 0),
    [chat.messages],
  );

  const pct = Math.min((totalTokens / contextLimit) * 100, 100);
  const isWarning = pct >= 80;

  const formatTokens = (n: number) =>
    n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);

  return (
    <div className="px-4 py-1.5 flex items-center gap-2" title={`~${formatTokens(totalTokens)} / ${formatTokens(contextLimit)} tokens`}>
      <div className="flex-1 h-1 bg-surface-raised rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${
            isWarning ? "bg-fg-error" : "bg-accent"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={`text-[10px] tabular-nums shrink-0 ${isWarning ? "text-fg-error" : "text-fg-dim"}`}>
        {formatTokens(totalTokens)} / {formatTokens(contextLimit)}
      </span>
    </div>
  );
});
