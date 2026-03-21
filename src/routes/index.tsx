import { createFileRoute } from "@tanstack/react-router";
import { usePaneStore, type PaneNode } from "../stores/paneStore";
import PaneView from "../components/PaneView";

export const Route = createFileRoute("/")({
  component: WorkspaceHome,
});

function WorkspaceHome() {
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

  const isHorizontal = node.direction === "horizontal";
  const firstPercent = node.ratio * 100;

  return (
    <div
      className={`flex h-full w-full ${isHorizontal ? "flex-row" : "flex-col"}`}
    >
      <div style={{ [isHorizontal ? "width" : "height"]: `${firstPercent}%` }}>
        <PaneLayout node={node.first} />
      </div>
      <div
        className={`${isHorizontal ? "w-px" : "h-px"} bg-border shrink-0`}
      />
      <div style={{ [isHorizontal ? "width" : "height"]: `${100 - firstPercent}%` }}>
        <PaneLayout node={node.second} />
      </div>
    </div>
  );
}
