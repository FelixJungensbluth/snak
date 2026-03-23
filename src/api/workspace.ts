import { invoke } from "@tauri-apps/api/core";
import { useWorkspaceStore } from "../stores/workspaceStore";
import type { WorkspaceNode } from "../stores/workspaceStore";

/**
 * Centralized Tauri API layer for workspace-bound commands.
 * Reads rootPath from the store so callers don't need to thread it manually.
 */

function getRootPath(): string {
  const rootPath = useWorkspaceStore.getState().rootPath;
  if (!rootPath) throw new Error("No workspace root path set");
  return rootPath;
}

// ── Chat file operations ────────────────────────────────────────────────────

export interface RawChatFile {
  id: string;
  name: string;
  provider: string;
  model: string;
  messages: { role: string; content: string }[];
}

export function readChatFile(chatId: string) {
  return invoke<RawChatFile>("read_chat_file", {
    workspaceRoot: getRootPath(),
    chatId,
  });
}

export function appendMessageToFile(chatId: string, role: string, content: string) {
  return invoke("append_message_to_file", {
    workspaceRoot: getRootPath(),
    chatId,
    role,
    content,
  });
}

// ── FTS indexing ─────────────────────────────────────────────────────────────

export function indexMessage(chatId: string, msgId: string, content: string) {
  return invoke("index_message", { chatId, msgId, content });
}

export function searchMessages(query: string, limit: number) {
  return invoke<{ chat_id: string; msg_id: string; snippet: string }[]>(
    "search_messages",
    { query, limit },
  );
}

// ── Streaming ───────────────────────────────────────────────────────────────

export interface MessageAttachmentInput {
  attachment_type: string;
  path: string;
  name: string;
}

export interface StreamChatInput {
  chat_id: string;
  provider: string;
  model: string;
  messages: { role: string; content: string; attachments?: MessageAttachmentInput[] }[];
  system_prompt: string | null;
  temperature: number | null;
  max_tokens: number | null;
  base_url: string | null;
}

export function streamChat(input: StreamChatInput) {
  return invoke("stream_chat", { input });
}

export function abortStream(chatId: string) {
  return invoke("abort_stream", { chatId });
}

// ── Auto-title ──────────────────────────────────────────────────────────────

export interface AutoTitleInput {
  provider: string;
  model: string;
  messages: { role: string; content: string }[];
  base_url: string | null;
}

export function autoTitleChat(input: AutoTitleInput) {
  return invoke<string>("auto_title_chat", { input });
}

// ── Node CRUD ───────────────────────────────────────────────────────────────

export function createChat(provider: string, model: string, parentId: string | null = null) {
  return invoke<WorkspaceNode>("create_chat", {
    workspaceRoot: getRootPath(),
    parentId,
    provider,
    model,
  });
}

export function createFolder(parentId: string | null = null) {
  return invoke<WorkspaceNode>("create_folder", {
    workspaceRoot: getRootPath(),
    parentId,
  });
}

export function importFile(sourcePath: string, parentId: string | null = null) {
  return invoke<WorkspaceNode>("import_file", {
    workspaceRoot: getRootPath(),
    parentId,
    sourcePath,
  });
}

export function renameNode(id: string, newName: string) {
  return invoke("rename_node", {
    workspaceRoot: getRootPath(),
    id,
    newName,
  });
}

export function archiveNode(id: string) {
  return invoke("archive_node", { id });
}

export function deleteNode(id: string) {
  return invoke("delete_node", {
    workspaceRoot: getRootPath(),
    id,
  });
}

export function moveNode(
  id: string,
  newParentId: string | null,
  siblingIds: string[],
) {
  return invoke("move_node", {
    workspaceRoot: getRootPath(),
    id,
    newParentId,
    siblingIds,
  });
}

export function updateChatModelConfig(
  chatId: string,
  provider: string,
  model: string,
) {
  return invoke("update_chat_model_config", {
    workspaceRoot: getRootPath(),
    chatId,
    provider,
    model,
  });
}

// ── Session ─────────────────────────────────────────────────────────────────

export function loadSession() {
  return invoke<string | null>("load_session", {
    workspaceRoot: getRootPath(),
  });
}

export function saveSession(json: string) {
  return invoke("save_session", {
    workspaceRoot: getRootPath(),
    json,
  });
}

// ── Workspace lifecycle (these don't need rootPath from store) ──────────────

export function getSavedWorkspace() {
  return invoke<string | null>("get_saved_workspace");
}

export function saveWorkspace(path: string) {
  return invoke("save_workspace", { path });
}

export function openWorkspace(dbPath: string) {
  return invoke("open_workspace", { dbPath });
}

export function listNodes() {
  return invoke<WorkspaceNode[]>("list_nodes");
}

export interface FileContentResponse {
  id: string;
  name: string;
  file_path: string;
  mime_type: string;
  file_size: number;
  content_kind: "markdown" | "pdf" | "image" | "code" | "text" | "binary";
  content: string | null;
}

export function getFileContent(nodeId: string) {
  return invoke<FileContentResponse>("get_file_content", {
    workspaceRoot: getRootPath(),
    nodeId,
  });
}

export function getRecentWorkspaces() {
  return invoke<string[]>("get_recent_workspaces");
}

export function removeRecentWorkspace(path: string) {
  return invoke("remove_recent_workspace", { path });
}

export function reindexAllChats(workspaceRoot: string) {
  return invoke("reindex_all_chats", { workspaceRoot });
}

// ── API keys ────────────────────────────────────────────────────────────────

export function getApiKey(provider: string) {
  return invoke<string | null>("get_api_key", { provider });
}

export function setApiKey(provider: string, apiKey: string) {
  return invoke("set_api_key", { provider, apiKey });
}

export function deleteApiKey(provider: string) {
  return invoke("delete_api_key", { provider });
}

// ── Ollama ───────────────────────────────────────────────────────────────────

export interface OllamaModel {
  name: string;
  size: number;
  modified_at: string;
}

export function listOllamaModels(baseUrl?: string | null) {
  return invoke<OllamaModel[]>("list_ollama_models", {
    baseUrl: baseUrl ?? null,
  });
}

// ── Attachments ──────────────────────────────────────────────────────────────

export function saveAttachment(chatId: string, sourcePath: string) {
  return invoke<string>("save_attachment", {
    workspaceRoot: getRootPath(),
    chatId,
    sourcePath,
  });
}

export function extractPdfText(filePath: string) {
  return invoke<string>("extract_pdf_text", { filePath });
}

export function readFileText(filePath: string) {
  return invoke<string>("read_file_text", { filePath });
}

export function readFileBase64(filePath: string) {
  return invoke<[string, string]>("read_file_base64", { filePath });
}

// ── Skills ───────────────────────────────────────────────────────────────────

export interface Skill {
  name: string;
  content: string;
}

export function listSkills() {
  return invoke<Skill[]>("list_skills", {
    workspaceRoot: getRootPath(),
  });
}

export function saveSkill(name: string, content: string) {
  return invoke("save_skill", {
    workspaceRoot: getRootPath(),
    name,
    content,
  });
}

export function deleteSkill(name: string) {
  return invoke("delete_skill", {
    workspaceRoot: getRootPath(),
    name,
  });
}

// ── ArXiv ────────────────────────────────────────────────────────────────────

export function importArxiv(arxivUrl: string, parentId: string | null = null) {
  return invoke<WorkspaceNode>("import_arxiv", {
    workspaceRoot: getRootPath(),
    parentId,
    arxivUrl,
  });
}

export function ensureDefaultSkills() {
  return invoke("ensure_default_skills", {
    workspaceRoot: getRootPath(),
  });
}
