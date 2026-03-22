export function buildMessagePreview(content: string, maxLength = 140): string | null {
  const collapsed = content.replace(/\s+/g, " ").trim();
  if (!collapsed) return null;
  if (collapsed.length <= maxLength) return collapsed;
  return `${collapsed.slice(0, maxLength - 1).trimEnd()}…`;
}
