import type { WorkspaceNode } from "../stores/workspaceStore";
import { compareWorkspaceNodes } from "./workspaceIndex";

/** Map from parentId (null for root) to sorted children */
export type ChildIndex = Map<string | null, WorkspaceNode[]>;

/** Build a parent→children index, sorted folders-first then by order_idx */
export function buildChildIndex(nodes: WorkspaceNode[]): ChildIndex {
  const childrenByParent: ChildIndex = new Map();

  for (const node of nodes) {
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

  return childrenByParent;
}
