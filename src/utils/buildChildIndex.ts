import type { WorkspaceNode } from "../stores/workspaceStore";

/** Map from parentId (null for root) to sorted children */
export type ChildIndex = Map<string | null, WorkspaceNode[]>;

/** Build a parent→children index, sorted folders-first then by order_idx */
export function buildChildIndex(nodes: WorkspaceNode[]): ChildIndex {
  const index: ChildIndex = new Map();
  for (const node of nodes) {
    const key = node.parent_id;
    let list = index.get(key);
    if (!list) {
      list = [];
      index.set(key, list);
    }
    list.push(node);
  }
  // Sort each group: folders first, then by order_idx
  for (const children of index.values()) {
    children.sort((a, b) => {
      if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
      return a.order_idx - b.order_idx;
    });
  }
  return index;
}
