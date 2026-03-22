import { useCallback, useEffect, useRef, useState } from "react";
import {
  useChatStore,
  type Chat,
  type Message,
  type Attachment,
} from "../stores/chatStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useSettingsStore } from "../stores/settingsStore";
import * as api from "../api/workspace";
import type { MessageAttachmentInput } from "../api/workspace";
import { createChatStreamSession } from "../utils/chatStreamSession";
import { buildMessagePreview } from "../utils/messagePreview";

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
  const updateLastMessage = useWorkspaceStore((s) => s.updateLastMessage);

  // Keep a ref to the latest chat so sendMessage doesn't depend on `chat` directly.
  // This prevents sendMessage from being recreated on every stream token.
  const chatRef = useRef(chat);
  chatRef.current = chat;

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);

  const removeEmptyAssistantPlaceholder = useCallback(() => {
    const errChat = useChatStore.getState().chats[chatId];
    if (!errChat) return;

    const last = errChat.messages[errChat.messages.length - 1];
    if (last && last.role === "assistant" && !last.content) {
      useChatStore.setState((state) => {
        const current = state.chats[chatId];
        if (current) {
          current.messages = current.messages.filter((message) => message.id !== last.id);
        }
      });
    }
  }, [chatId]);

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
    async (text: string, attachments: Attachment[] = []) => {
      const currentChat = chatRef.current;
      if ((!text.trim() && attachments.length === 0) || !rootPath || !currentChat || currentChat.streaming) return;

      setStreamError(null);

      // Save attachments to workspace and get relative paths
      const savedAttachments = await Promise.all(
        attachments.map(async (att) => {
          try {
            const relPath = await api.saveAttachment(chatId, att.path);
            return { ...att, path: relPath };
          } catch (e) {
            console.error("Failed to save attachment:", e);
            return att;
          }
        }),
      );

      // Build the content text. For images, add markdown image references.
      // For PDF/markdown, note the attachment in the stored content.
      let storedContent = text.trim();
      for (const att of savedAttachments) {
        if (att.type === "image") {
          storedContent += `\n\n![${att.name}](${att.path})`;
        } else if (att.type === "pdf") {
          storedContent += `\n\n📎 ${att.name}`;
        } else if (att.type === "markdown") {
          storedContent += `\n\n📎 ${att.name}`;
        }
      }

      const userMsg: Message = {
        id: `${chatId}-${Date.now()}`,
        role: "user",
        content: storedContent,
        attachments: savedAttachments,
        created_at: Date.now(),
      };
      addMessage(chatId, userMsg);

      // Persist user message
      try {
        await api.appendMessageToFile(chatId, "user", storedContent);
        await api.indexMessage(chatId, userMsg.id, storedContent);
        updateLastMessage(chatId, buildMessagePreview(storedContent));
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

      // Build API messages — include attachment info for the current user message
      // so Rust can build multimodal content blocks
      const apiMessages = [...currentChat.messages, userMsg].map((m) => {
        const apiMsg: { role: string; content: string; attachments?: MessageAttachmentInput[] } = {
          role: m.role,
          content: m.content,
        };
        // Only attach files for the message being sent (current user message)
        if (m.id === userMsg.id && attachments.length > 0) {
          apiMsg.attachments = attachments.map((a) => ({
            attachment_type: a.type,
            path: a.path, // original absolute path — Rust reads the file from here
            name: a.name,
          }));
        }
        return apiMsg;
      });

      const isFirstExchange = currentChat.messages.length === 0;
      const session = await createChatStreamSession({
        chatId,
        onToken: (token) => {
          appendToken(chatId, token);
        },
        onDone: async (fullText) => {
          const msgId = `${chatId}-${Date.now()}-assistant`;
          finalizeStream(chatId, fullText, msgId);

          if (fullText) {
            try {
              await api.appendMessageToFile(chatId, "assistant", fullText);
              await api.indexMessage(chatId, msgId, fullText);
              updateLastMessage(chatId, buildMessagePreview(fullText));
            } catch (e) {
              console.error("Failed to persist assistant message:", e);
            }
          }

          if (isFirstExchange && fullText) {
            const titleSettings = useSettingsStore.getState();
            const ollamaBaseUrl = titleSettings.providers.ollama?.baseUrl || null;
            api.autoTitleChat({
              provider: currentChat.provider,
              model: currentChat.model,
              messages: [
                { role: "user", content: text.trim() },
                { role: "assistant", content: fullText },
              ],
              base_url: currentChat.provider === "ollama" ? ollamaBaseUrl : null,
            })
              .then(async (title) => {
                if (!title || title === "New Chat") return;
                renameChat(chatId, title);
                const node = useWorkspaceStore.getState().index.byId.get(chatId);
                if (node) upsertNode({ ...node, name: title });
                try {
                  await api.renameNode(chatId, title);
                } catch (e) {
                  console.error("Failed to persist chat title:", e);
                }
              })
              .catch((e) => console.error("Auto-title failed:", e));
          }
        },
        onError: (errorMessage) => {
          setStreamError(errorMessage);
          setStreaming(chatId, false);
          removeEmptyAssistantPlaceholder();
        },
      });

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
        session.dispose();
        removeEmptyAssistantPlaceholder();
      }
    },
    [
      chatId,
      rootPath,
      addMessage,
      appendToken,
      finalizeStream,
      setStreaming,
      renameChat,
      upsertNode,
      updateLastMessage,
      removeEmptyAssistantPlaceholder,
    ],
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
