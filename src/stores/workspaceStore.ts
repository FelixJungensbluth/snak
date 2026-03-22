import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import {
  buildWorkspaceIndex,
  collectDescendantIds,
  updateWorkspaceIndexLastMessage,
  type WorkspaceIndex,
} from "../utils/workspaceIndex";

export type NodeType = "chat" | "folder";

export interface WorkspaceNode {
  id: string;
  type: NodeType;
  name: string;
  parent_id: string | null;
  order_idx: number;
  is_archived: boolean;
  // chat-specific fields
  provider: string | null;
  model: string | null;
  last_message: string | null;
}

export interface WorkspaceState {
  /** Absolute path to the open workspace directory */
  rootPath: string | null;
  /** Flat list of all nodes (chats + folders) */
  nodes: WorkspaceNode[];
  /** Derived workspace index for fast lookup/navigation */
  index: WorkspaceIndex;
  /** True while the workspace is being loaded from disk */
  loading: boolean;
  error: string | null;
}

export interface WorkspaceActions {
  setRootPath: (path: string | null) => void;
  setNodes: (nodes: WorkspaceNode[]) => void;
  upsertNode: (node: WorkspaceNode) => void;
  removeNode: (id: string) => void;
  updateLastMessage: (id: string, lastMessage: string | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

const emptyNodes: WorkspaceNode[] = [];

export const useWorkspaceStore = create<WorkspaceState & WorkspaceActions>()(
  immer((set) => ({
    rootPath: null,
    nodes: emptyNodes,
    index: buildWorkspaceIndex(emptyNodes),
    loading: false,
    error: null,

    setRootPath: (path) =>
      set((state) => {
        state.rootPath = path;
      }),

    setNodes: (nodes) =>
      set((state) => {
        state.nodes = nodes;
        state.index = buildWorkspaceIndex(nodes);
      }),

    upsertNode: (node) =>
      set((state) => {
        const idx = state.nodes.findIndex((n) => n.id === node.id);
        const nextNodes = [...state.nodes];
        if (idx >= 0) {
          nextNodes[idx] = node;
        } else {
          nextNodes.push(node);
        }
        state.nodes = nextNodes;
        state.index = buildWorkspaceIndex(nextNodes);
      }),

    removeNode: (id) =>
      set((state) => {
        const idsToRemove = new Set([id, ...collectDescendantIds(state.index, id)]);
        const nextNodes = state.nodes.filter((node) => !idsToRemove.has(node.id));
        state.nodes = nextNodes;
        state.index = buildWorkspaceIndex(nextNodes);
      }),

    updateLastMessage: (id, lastMessage) =>
      set((state) => {
        const nextIndex = updateWorkspaceIndexLastMessage(
          state.index,
          id,
          lastMessage,
        );
        if (nextIndex === state.index) return;
        state.index = nextIndex;
        state.nodes = nextIndex.allNodes;
      }),

    setLoading: (loading) =>
      set((state) => {
        state.loading = loading;
      }),

    setError: (error) =>
      set((state) => {
        state.error = error;
      }),
  }))
);
