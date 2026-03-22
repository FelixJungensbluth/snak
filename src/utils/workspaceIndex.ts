import type { WorkspaceNode } from "../stores/workspaceStore";

export interface WorkspaceIndex {
  allNodes: WorkspaceNode[];
  byId: Map<string, WorkspaceNode>;
  childrenByParent: Map<string | null, WorkspaceNode[]>;
  chatNodes: WorkspaceNode[];
  fileNodes: WorkspaceNode[];
}

export function compareWorkspaceNodes(a: WorkspaceNode, b: WorkspaceNode): number {
  const rank: Record<WorkspaceNode["type"], number> = {
    folder: 0,
    file: 1,
    chat: 2,
  };
  if (a.type !== b.type) return rank[a.type] - rank[b.type];
  return a.order_idx - b.order_idx || a.name.localeCompare(b.name);
}

export function buildWorkspaceIndex(nodes: WorkspaceNode[]): WorkspaceIndex {
  const byId = new Map<string, WorkspaceNode>();
  const childrenByParent = new Map<string | null, WorkspaceNode[]>();
  const chatNodes: WorkspaceNode[] = [];
  const fileNodes: WorkspaceNode[] = [];

  for (const node of nodes) {
    byId.set(node.id, node);
    if (node.type === "chat") {
      chatNodes.push(node);
    } else if (node.type === "file") {
      fileNodes.push(node);
    }

    const siblings = childrenByParent.get(node.parent_id);
    if (siblings) {
      siblings.push(node);
    } else {
      childrenByParent.set(node.parent_id, [node]);
    }
  }

  for (const siblings of childrenByParent.values()) {
    siblings.sort(compareWorkspaceNodes);
  }

  return {
    allNodes: nodes,
    byId,
    childrenByParent,
    chatNodes,
    fileNodes,
  };
}

export function updateWorkspaceIndexLastMessage(
  index: WorkspaceIndex,
  nodeId: string,
  lastMessage: string | null,
): WorkspaceIndex {
  const current = index.byId.get(nodeId);
  if (!current || current.last_message === lastMessage) {
    return index;
  }

  const updatedNode: WorkspaceNode = {
    ...current,
    last_message: lastMessage,
  };

  const allNodes = index.allNodes.map((node) =>
    node.id === nodeId ? updatedNode : node,
  );

  const byId = new Map(index.byId);
  byId.set(nodeId, updatedNode);

  const childrenByParent = new Map(index.childrenByParent);
  const siblings = childrenByParent.get(current.parent_id);
  if (siblings) {
    childrenByParent.set(
      current.parent_id,
      siblings.map((node) => (node.id === nodeId ? updatedNode : node)),
    );
  }

  const chatNodes =
    current.type === "chat"
      ? index.chatNodes.map((node) => (node.id === nodeId ? updatedNode : node))
      : index.chatNodes;
  const fileNodes =
    current.type === "file"
      ? index.fileNodes.map((node) => (node.id === nodeId ? updatedNode : node))
      : index.fileNodes;

  return {
    allNodes,
    byId,
    childrenByParent,
    chatNodes,
    fileNodes,
  };
}

export function collectAncestorIds(index: WorkspaceIndex, nodeId: string): string[] {
  const ancestors: string[] = [];
  let cursor = index.byId.get(nodeId);

  while (cursor?.parent_id) {
    ancestors.push(cursor.parent_id);
    cursor = index.byId.get(cursor.parent_id);
  }

  return ancestors;
}

export function collectDescendantIds(index: WorkspaceIndex, nodeId: string): string[] {
  const descendantIds: string[] = [];
  const stack = [nodeId];

  while (stack.length > 0) {
    const currentId = stack.pop()!;
    const children = index.childrenByParent.get(currentId) ?? [];

    for (const child of children) {
      descendantIds.push(child.id);
      stack.push(child.id);
    }
  }

  return descendantIds;
}

export function filterWorkspaceNodes(index: WorkspaceIndex, query: string): WorkspaceNode[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return index.allNodes;

  const keepIds = new Set<string>();

  for (const node of [...index.chatNodes, ...index.fileNodes]) {
    if (!node.name.toLowerCase().includes(trimmed)) continue;

    keepIds.add(node.id);
    for (const ancestorId of collectAncestorIds(index, node.id)) {
      keepIds.add(ancestorId);
    }
  }

  return index.allNodes.filter((node) => keepIds.has(node.id));
}
