import { create } from "zustand";
import { immer } from "zustand/middleware/immer";

/** Pane layout is modeled as a binary split tree */
export type SplitDirection = "horizontal" | "vertical";

export interface PaneLeaf {
  kind: "leaf";
  id: string;
}

export interface PaneSplit {
  kind: "split";
  id: string;
  direction: SplitDirection;
  /** 0–1 ratio for the first child */
  ratio: number;
  first: PaneNode;
  second: PaneNode;
}

export type PaneNode = PaneLeaf | PaneSplit;

export interface PaneState {
  /** Root of the binary split tree */
  root: PaneNode;
  /** ID of the currently focused pane */
  focusedPaneId: string;
}

export interface PaneActions {
  splitPane: (
    paneId: string,
    direction: SplitDirection,
    newPaneId: string
  ) => void;
  closePane: (paneId: string) => void;
  setRatio: (splitId: string, ratio: number) => void;
  setFocusedPane: (paneId: string) => void;
  setRoot: (root: PaneNode) => void;
}

function generateId(): string {
  return Math.random().toString(36).slice(2, 10);
}

const initialPaneId = generateId();

function splitNode(
  node: PaneNode,
  targetId: string,
  direction: SplitDirection,
  newPaneId: string
): PaneNode {
  if (node.kind === "leaf") {
    if (node.id !== targetId) return node;
    return {
      kind: "split",
      id: generateId(),
      direction,
      ratio: 0.5,
      first: node,
      second: { kind: "leaf", id: newPaneId },
    };
  }
  return {
    ...node,
    first: splitNode(node.first, targetId, direction, newPaneId),
    second: splitNode(node.second, targetId, direction, newPaneId),
  };
}

function removeNode(node: PaneNode, targetId: string): PaneNode | null {
  if (node.kind === "leaf") {
    return node.id === targetId ? null : node;
  }
  const newFirst = removeNode(node.first, targetId);
  const newSecond = removeNode(node.second, targetId);
  if (newFirst === null) return newSecond;
  if (newSecond === null) return newFirst;
  return { ...node, first: newFirst, second: newSecond };
}

function setSplitRatio(
  node: PaneNode,
  splitId: string,
  ratio: number
): PaneNode {
  if (node.kind === "leaf") return node;
  if (node.id === splitId) return { ...node, ratio };
  return {
    ...node,
    first: setSplitRatio(node.first, splitId, ratio),
    second: setSplitRatio(node.second, splitId, ratio),
  };
}

export const usePaneStore = create<PaneState & PaneActions>()(
  immer((set) => ({
    root: { kind: "leaf", id: initialPaneId },
    focusedPaneId: initialPaneId,

    splitPane: (paneId, direction, newPaneId) =>
      set((state) => {
        state.root = splitNode(state.root, paneId, direction, newPaneId);
        state.focusedPaneId = newPaneId;
      }),

    closePane: (paneId) =>
      set((state) => {
        const newRoot = removeNode(state.root, paneId);
        if (newRoot === null) {
          // Never remove the last pane — reset to a single leaf
          const id = generateId();
          state.root = { kind: "leaf", id };
          state.focusedPaneId = id;
        } else {
          state.root = newRoot;
          if (state.focusedPaneId === paneId) {
            // Focus first available leaf
            let cursor: PaneNode = newRoot;
            while (cursor.kind === "split") cursor = cursor.first;
            state.focusedPaneId = cursor.id;
          }
        }
      }),

    setRatio: (splitId, ratio) =>
      set((state) => {
        state.root = setSplitRatio(state.root, splitId, ratio);
      }),

    setFocusedPane: (paneId) =>
      set((state) => {
        state.focusedPaneId = paneId;
      }),

    setRoot: (root) =>
      set((state) => {
        state.root = root;
      }),
  }))
);
