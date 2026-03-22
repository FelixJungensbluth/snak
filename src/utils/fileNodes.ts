import type { Attachment } from "../stores/chatStore";
import type { WorkspaceNode } from "../stores/workspaceStore";

const MARKDOWN_EXTS = new Set(["md", "markdown", "mdx"]);
const TEXT_EXTS = new Set(["txt", "log", "csv", "tsv", "ini", "cfg", "conf", "env"]);
const CODE_EXTS = new Set([
  "c",
  "cc",
  "cpp",
  "cs",
  "css",
  "go",
  "h",
  "hpp",
  "html",
  "java",
  "js",
  "json",
  "jsx",
  "kt",
  "lua",
  "php",
  "py",
  "rb",
  "rs",
  "scss",
  "sh",
  "sql",
  "swift",
  "toml",
  "ts",
  "tsx",
  "xml",
  "yaml",
  "yml",
  "zsh",
]);

export type FileViewKind = "markdown" | "pdf" | "image" | "code" | "text" | "binary";

export function getFileExtension(name: string): string {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

export function getFileViewKind(
  file: Pick<WorkspaceNode, "name" | "mime_type">,
): FileViewKind {
  const ext = getFileExtension(file.name);
  const mimeType = file.mime_type ?? "";

  if (mimeType === "application/pdf" || ext === "pdf") return "pdf";
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType === "text/markdown" || MARKDOWN_EXTS.has(ext)) return "markdown";
  if (mimeType === "text/x-source" || CODE_EXTS.has(ext)) return "code";
  if (
    mimeType.startsWith("text/") ||
    mimeType === "application/json" ||
    mimeType === "application/toml" ||
    mimeType === "application/yaml" ||
    TEXT_EXTS.has(ext)
  ) {
    return "text";
  }
  return "binary";
}

export function getMentionAttachmentType(
  file: Pick<WorkspaceNode, "name" | "mime_type">,
): Attachment["type"] | null {
  const viewKind = getFileViewKind(file);
  if (viewKind === "image") return "image";
  if (viewKind === "pdf") return "pdf";
  if (viewKind === "markdown" || viewKind === "code" || viewKind === "text") return "markdown";
  return null;
}

export function formatFileMention(name: string): string {
  return `@{${name}}`;
}

export function extractMentionedFileNames(content: string): string[] {
  const names = new Set<string>();
  const pattern = /@\{([^}]+)\}/g;

  let match: RegExpExecArray | null = null;
  while ((match = pattern.exec(content)) !== null) {
    const name = match[1]?.trim();
    if (name) names.add(name);
  }

  return [...names];
}

export function getActiveMentionQuery(
  content: string,
  cursor: number,
): { start: number; end: number; query: string } | null {
  const beforeCursor = content.slice(0, cursor);
  const atIndex = beforeCursor.lastIndexOf("@");
  if (atIndex < 0) return null;

  const prevChar = atIndex === 0 ? "" : beforeCursor[atIndex - 1];
  if (prevChar && !/\s/.test(prevChar)) return null;

  const segment = beforeCursor.slice(atIndex);
  if (segment.startsWith("@{")) {
    if (segment.includes("}")) return null;
    return {
      start: atIndex,
      end: cursor,
      query: segment.slice(2),
    };
  }

  if (/\s/.test(segment)) return null;

  return {
    start: atIndex,
    end: cursor,
    query: segment.slice(1),
  };
}

export function replaceMentionAtRange(
  content: string,
  start: number,
  end: number,
  fileName: string,
): { nextValue: string; nextCursor: number } {
  const mention = `${formatFileMention(fileName)} `;
  const nextValue = `${content.slice(0, start)}${mention}${content.slice(end)}`;
  return {
    nextValue,
    nextCursor: start + mention.length,
  };
}

