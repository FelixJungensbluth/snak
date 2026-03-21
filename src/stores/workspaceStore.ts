import { create } from "zustand";
import { immer } from "zustand/middleware/immer";

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
  /** True while the workspace is being loaded from disk */
  loading: boolean;
  error: string | null;
}

export interface WorkspaceActions {
  setRootPath: (path: string | null) => void;
  setNodes: (nodes: WorkspaceNode[]) => void;
  upsertNode: (node: WorkspaceNode) => void;
  removeNode: (id: string) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

export const useWorkspaceStore = create<WorkspaceState & WorkspaceActions>()(
  immer((set) => ({
    rootPath: null,
    nodes: [],
    loading: false,
    error: null,

    setRootPath: (path) =>
      set((state) => {
        state.rootPath = path;
      }),

    setNodes: (nodes) =>
      set((state) => {
        state.nodes = nodes;
      }),

    upsertNode: (node) =>
      set((state) => {
        const idx = state.nodes.findIndex((n) => n.id === node.id);
        if (idx >= 0) {
          state.nodes[idx] = node;
        } else {
          state.nodes.push(node);
        }
      }),

    removeNode: (id) =>
      set((state) => {
        state.nodes = state.nodes.filter((n) => n.id !== id);
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
