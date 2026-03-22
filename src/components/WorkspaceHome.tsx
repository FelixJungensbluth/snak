import { useCallback, useRef } from "react";
import { usePaneStore, type PaneNode } from "../stores/paneStore";
import PaneView from "./PaneView";

export default function WorkspaceHome() {
  const root = usePaneStore((s) => s.root);
  return (
    <div className="h-full w-full">
      <PaneLayout node={root} />
    </div>
  );
}

function PaneLayout({ node }: { node: PaneNode }) {
  if (node.kind === "leaf") {
    return <PaneView paneId={node.id} />;
  }

  return <SplitLayout node={node} />;
}

function SplitLayout({ node }: { node: Extract<PaneNode, { kind: "split" }> }) {
  const setRatio = usePaneStore((s) => s.setRatio);
  const containerRef = useRef<HTMLDivElement>(null);

  const isHorizontal = node.direction === "horizontal";
  const firstPercent = node.ratio * 100;

  const onDividerMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const container = containerRef.current;
      if (!container) return;

      document.body.style.cursor = isHorizontal ? "col-resize" : "row-resize";
      document.body.style.userSelect = "none";

      const onMove = (ev: MouseEvent) => {
        const rect = container.getBoundingClientRect();
        const pos = isHorizontal
          ? (ev.clientX - rect.left) / rect.width
          : (ev.clientY - rect.top) / rect.height;
        const clamped = Math.min(0.9, Math.max(0.1, pos));
        setRatio(node.id, clamped);
      };

      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [isHorizontal, node.id, setRatio]
  );

  return (
    <div
      ref={containerRef}
      className={`flex h-full w-full ${isHorizontal ? "flex-row" : "flex-col"}`}
    >
      <div
        className="overflow-hidden"
        style={{ [isHorizontal ? "width" : "height"]: `${firstPercent}%` }}
      >
        <PaneLayout node={node.first} />
      </div>
      <div
        className={`${isHorizontal ? "w-1 cursor-col-resize" : "h-1 cursor-row-resize"} bg-border shrink-0 hover:bg-accent transition-colors`}
        onMouseDown={onDividerMouseDown}
      />
      <div
        className="overflow-hidden"
        style={{ [isHorizontal ? "width" : "height"]: `${100 - firstPercent}%` }}
      >
        <PaneLayout node={node.second} />
      </div>
    </div>
  );
}
