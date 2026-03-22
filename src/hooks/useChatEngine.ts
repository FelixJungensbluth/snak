import { useCallback, useEffect, useRef, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useChatStore, type Chat, type Message } from "../stores/chatStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useSettingsStore } from "../stores/settingsStore";
import * as api from "../api/workspace";

/**
 * Chat engine hook — encapsulates chat loading, message sending,
 * streaming orchestration, persistence, and auto-titling.
 *
 * Returns a clean interface that ChatView can bind to its UI.
 */
export function useChatEngine(chatId: string) {
  const chat = useChatStore((s) => s.chats[chatId]);
  const loadChat = useChatStore((s) => s.loadChat);
  const addMessage = useChatStore((s) => s.addMessage);
  const appendToken = useChatStore((s) => s.appendToken);
  const finalizeStream = useChatStore((s) => s.finalizeStream);
  const setStreaming = useChatStore((s) => s.setStreaming);
  const renameChat = useChatStore((s) => s.renameChat);
  const rootPath = useWorkspaceStore((s) => s.rootPath);
  const upsertNode = useWorkspaceStore((s) => s.upsertNode);

  // Keep a ref to the latest chat so sendMessage doesn't depend on `chat` directly.
  // This prevents sendMessage from being recreated on every stream token.
  const chatRef = useRef(chat);
  chatRef.current = chat;

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);

  // ── Load chat from disk if not in store ──────────────────────────────────
  useEffect(() => {
    if (chat || !rootPath) return;
    setLoading(true);
    setError(null);
    api.readChatFile(chatId)
      .then((data) => {
        const messages: Message[] = data.messages.map((m, i) => ({
          id: `${chatId}-${i}`,
          role: m.role as Message["role"],
          content: m.content,
          attachments: [],
          created_at: Date.now(),
        }));
        const chatObj: Chat = {
          id: data.id,
          name: data.name,
          provider: data.provider,
          model: data.model,
          system_prompt: "",
          messages,
          streaming: false,
          streamBuffer: "",
          temperature: null,
          max_tokens: null,
          created_at: Date.now(),
          updated_at: Date.now(),
        };
        loadChat(chatObj);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [chatId, chat, rootPath, loadChat]);

  // ── Send message + start streaming ───────────────────────────────────────
  const sendMessage = useCallback(
    async (text: string) => {
      const currentChat = chatRef.current;
      if (!text.trim() || !rootPath || !currentChat || currentChat.streaming) return;

      setStreamError(null);

      const userMsg: Message = {
        id: `${chatId}-${Date.now()}`,
        role: "user",
        content: text.trim(),
        attachments: [],
        created_at: Date.now(),
      };
      addMessage(chatId, userMsg);

      // Persist user message
      try {
        await api.appendMessageToFile(chatId, "user", text.trim());
        await api.indexMessage(chatId, userMsg.id, text.trim());
      } catch (e) {
        console.error("Failed to persist message:", e);
      }

      // Placeholder for streaming response
      const assistantMsg: Message = {
        id: `${chatId}-${Date.now()}-streaming`,
        role: "assistant",
        content: "",
        attachments: [],
        created_at: Date.now(),
      };
      addMessage(chatId, assistantMsg);
      setStreaming(chatId, true);

      const apiMessages = [...currentChat.messages, userMsg].map((m) => ({
        role: m.role,
        content: m.content,
      }));

      // Event listeners
      const unlisteners: UnlistenFn[] = [];

      const onToken = await listen<{ chat_id: string; token: string }>(
        "stream-token",
        (event) => {
          if (event.payload.chat_id === chatId) {
            appendToken(chatId, event.payload.token);
          }
        },
      );
      unlisteners.push(onToken);

      const isFirstExchange = currentChat.messages.length === 0;

      const onDone = await listen<{ chat_id: string; full_text: string }>(
        "stream-done",
        async (event) => {
          if (event.payload.chat_id !== chatId) return;
          const msgId = `${chatId}-${Date.now()}-assistant`;
          finalizeStream(chatId, event.payload.full_text, msgId);

          if (event.payload.full_text) {
            try {
              await api.appendMessageToFile(chatId, "assistant", event.payload.full_text);
              await api.indexMessage(chatId, msgId, event.payload.full_text);
            } catch (e) {
              console.error("Failed to persist assistant message:", e);
            }
          }

          // Auto-title after first exchange
          if (isFirstExchange && event.payload.full_text) {
            const titleSettings = useSettingsStore.getState();
            const ollamaBaseUrl = titleSettings.providers.ollama?.baseUrl || null;
            api.autoTitleChat({
              provider: currentChat.provider,
              model: currentChat.model,
              messages: [
                { role: "user", content: text.trim() },
                { role: "assistant", content: event.payload.full_text },
              ],
              base_url: currentChat.provider === "ollama" ? ollamaBaseUrl : null,
            })
              .then(async (title) => {
                if (!title || title === "New Chat") return;
                renameChat(chatId, title);
                const nodes = useWorkspaceStore.getState().nodes;
                const node = nodes.find((n) => n.id === chatId);
                if (node) upsertNode({ ...node, name: title });
                try {
                  await api.renameNode(chatId, title);
                } catch (e) {
                  console.error("Failed to persist chat title:", e);
                }
              })
              .catch((e) => console.error("Auto-title failed:", e));
          }

          unlisteners.forEach((fn) => fn());
        },
      );
      unlisteners.push(onDone);

      const onError = await listen<{ chat_id: string; error: string }>(
        "stream-error",
        (event) => {
          if (event.payload.chat_id !== chatId) return;
          setStreamError(event.payload.error);
          setStreaming(chatId, false);
          // Remove empty placeholder
          const errChat = useChatStore.getState().chats[chatId];
          if (errChat) {
            const last = errChat.messages[errChat.messages.length - 1];
            if (last && last.role === "assistant" && !last.content) {
              useChatStore.setState((state) => {
                const c = state.chats[chatId];
                if (c) {
                  c.messages = c.messages.filter((m) => m.id !== last.id);
                }
              });
            }
          }
          unlisteners.forEach((fn) => fn());
        },
      );
      unlisteners.push(onError);

      // Start streaming
      const settings = useSettingsStore.getState();
      const ollamaUrl = settings.providers.ollama?.baseUrl || null;
      const systemPrompt = settings.defaultSystemPrompt || null;
      try {
        await api.streamChat({
          chat_id: chatId,
          provider: currentChat.provider,
          model: currentChat.model,
          messages: apiMessages,
          system_prompt: systemPrompt,
          temperature: currentChat.temperature,
          max_tokens: currentChat.max_tokens,
          base_url: currentChat.provider === "ollama" ? ollamaUrl : null,
        });
      } catch (e) {
        setStreamError(String(e));
        setStreaming(chatId, false);
        unlisteners.forEach((fn) => fn());
      }
    },
    [chatId, rootPath, addMessage, appendToken, finalizeStream, setStreaming, renameChat, upsertNode],
  );

  // ── Abort streaming ──────────────────────────────────────────────────────
  const abort = useCallback(async () => {
    try {
      await api.abortStream(chatId);
    } catch (e) {
      console.error("Failed to abort stream:", e);
    }
  }, [chatId]);

  return { chat, loading, error, streamError, sendMessage, abort };
}
