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
import {
  extractMentionedFileNames,
  getMentionAttachmentType,
} from "../utils/fileNodes";
import { estimateTokens } from "../providers";

function resolveWorkspaceAttachmentPath(rootPath: string, path: string): string {
  if (path.startsWith("/")) return path;
  return `${rootPath}/${path}`;
}

function dedupeAttachments(attachments: MessageAttachmentInput[]): MessageAttachmentInput[] {
  const seen = new Set<string>();
  return attachments.filter((attachment) => {
    const key = `${attachment.attachment_type}:${attachment.path}:${attachment.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function resolveMentionAttachments(
  content: string,
  rootPath: string,
): Promise<MessageAttachmentInput[]> {
  const mentionedNames = extractMentionedFileNames(content);
  if (mentionedNames.length === 0) return [];

  const fileNodes = useWorkspaceStore.getState().index.fileNodes;
  const attachments: MessageAttachmentInput[] = [];

  for (const name of mentionedNames) {
    const node = fileNodes.find((fileNode) => fileNode.name === name);
    if (!node || !node.file_path) continue;

    const attachmentType = getMentionAttachmentType(node);
    if (!attachmentType) continue;

    attachments.push({
      attachment_type: attachmentType,
      path: resolveWorkspaceAttachmentPath(rootPath, node.file_path),
      name: node.name,
    });
  }

  return dedupeAttachments(attachments);
}

async function findOversizedMentionedFiles(content: string) {
  const mentionedNames = extractMentionedFileNames(content);
  if (mentionedNames.length === 0) return [];

  const fileNodes = useWorkspaceStore.getState().index.fileNodes;
  const oversized: { name: string; tokens: number }[] = [];

  for (const name of mentionedNames) {
    const node = fileNodes.find((fileNode) => fileNode.name === name);
    if (!node) continue;

    try {
      const file = await api.getFileContent(node.id);
      if (!file.content) continue;
      const tokens = estimateTokens(file.content);
      if (tokens > 50_000) {
        oversized.push({ name: file.name, tokens });
      }
    } catch (e) {
      console.error("Failed to inspect mentioned file:", e);
    }
  }

  return oversized;
}

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
      const trimmedText = text.trim();
      if ((!trimmedText && attachments.length === 0) || !rootPath || !currentChat || currentChat.streaming) return;

      setStreamError(null);

      const oversizedMentions = await findOversizedMentionedFiles(trimmedText);
      if (oversizedMentions.length > 0) {
        const details = oversizedMentions
          .map((file) => `${file.name} (~${Math.round(file.tokens / 1000)}k tokens)`)
          .join("\n");
        const shouldContinue = window.confirm(
          `These mentioned files are large and may consume a lot of context:\n\n${details}\n\nContinue anyway?`,
        );
        if (!shouldContinue) return;
      }

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
      let storedContent = trimmedText;
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
      // so Rust can build multimodal content blocks.
      const apiMessages = await Promise.all([...currentChat.messages, userMsg].map(async (m) => {
        const uploadedAttachments: MessageAttachmentInput[] = m.id === userMsg.id
          ? attachments.map((attachment) => ({
              attachment_type: attachment.type,
              path: attachment.path,
              name: attachment.name,
            }))
          : m.attachments.map((attachment) => ({
              attachment_type: attachment.type,
              path: resolveWorkspaceAttachmentPath(rootPath, attachment.path),
              name: attachment.name,
            }));
        const mentionAttachments = await resolveMentionAttachments(m.content, rootPath);
        const mergedAttachments = dedupeAttachments([
          ...uploadedAttachments,
          ...mentionAttachments,
        ]);
        const apiMsg: { role: string; content: string; attachments?: MessageAttachmentInput[] } = {
          role: m.role,
          content: m.content,
        };
        if (mergedAttachments.length > 0) {
          apiMsg.attachments = mergedAttachments;
        }
        return apiMsg;
      }));

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
                { role: "user", content: trimmedText },
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
