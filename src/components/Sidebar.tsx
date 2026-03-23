import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus, FolderPlus, FilePlus2, Settings, FolderOpen, X, Zap, ChevronRight, Trash2 } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useSkillStore } from "../stores/skillStore";
import * as api from "../api/workspace";
import { useSettingsStore } from "../stores/settingsStore";
import { useTabStore } from "../stores/tabStore";
import { usePaneStore } from "../stores/paneStore";
import { useUiStore } from "../stores/uiStore";
import FileTree from "./FileTree";
import { filterWorkspaceNodes } from "../utils/workspaceIndex";


const MIN_WIDTH = 140;
const MAX_WIDTH = 480;

export default function Sidebar() {
  const workspaceIndex = useWorkspaceStore((s) => s.index);
  const rootPath = useWorkspaceStore((s) => s.rootPath);
  const upsertNode = useWorkspaceStore((s) => s.upsertNode);
  const defaultProvider = useSettingsStore((s) => s.defaultProvider);
  const defaultModel = useSettingsStore((s) => s.defaultModel);
  const openTab = useTabStore((s) => s.openTab);
  const focusedPaneId = usePaneStore((s) => s.focusedPaneId);
  const sidebarFilter = useUiStore((s) => s.sidebarFilter);
  const settingsOpen = useUiStore((s) => s.settingsOpen);
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);
  const [width, setWidth] = useState(208);
  const [dragOverSidebar, setDragOverSidebar] = useState(false);
  const [externalDropFolderId, setExternalDropFolderId] = useState<string | null>(null);
  const sidebarRef = useRef<HTMLElement>(null);

  // Filter nodes by chat name when sidebar filter is active
  const filteredNodes = useMemo(() => {
    return filterWorkspaceNodes(workspaceIndex, sidebarFilter);
  }, [workspaceIndex, sidebarFilter]);
  const [creating, setCreating] = useState(false);
  const [bgCtxMenu, setBgCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const bgCtxRef = useRef<HTMLDivElement>(null);

  // Recent workspaces
  const [recentMenuOpen, setRecentMenuOpen] = useState(false);
  const [recentPaths, setRecentPaths] = useState<string[]>([]);
  const recentMenuRef = useRef<HTMLDivElement>(null);
  const recentBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!recentMenuOpen) return;
    api.getRecentWorkspaces().then(setRecentPaths).catch(console.error);
    const handler = (e: MouseEvent) => {
      if (
        !recentMenuRef.current?.contains(e.target as Node) &&
        !recentBtnRef.current?.contains(e.target as Node)
      ) {
        setRecentMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [recentMenuOpen]);

  async function switchWorkspace(path: string) {
    setRecentMenuOpen(false);
    try {
      await api.saveWorkspace(path);
      await api.openWorkspace(path + "/snak.db");
      const nodes = await api.listNodes();
      useWorkspaceStore.getState().setNodes(nodes);
      useWorkspaceStore.getState().setRootPath(path);
      useSkillStore.getState().loadSkills();
      void api.reindexAllChats(path)
        .then(() => api.listNodes())
        .then((reindexedNodes) => {
          if (useWorkspaceStore.getState().rootPath === path) {
            useWorkspaceStore.getState().setNodes(reindexedNodes);
          }
        })
        .catch((e) => console.error("FTS reindex failed:", e));
    } catch (e) {
      console.error("Failed to switch workspace:", e);
    }
  }

  async function openNewWorkspace() {
    setRecentMenuOpen(false);
    const dir = await open({ directory: true, multiple: false });
    if (!dir || typeof dir !== "string") return;
    await switchWorkspace(dir);
  }

  async function removeRecent(e: React.MouseEvent, path: string) {
    e.stopPropagation();
    await api.removeRecentWorkspace(path);
    setRecentPaths((prev) => prev.filter((p) => p !== path));
  }

  // ── resize logic ────────────────────────────────────────────────────────

  const widthRef = useRef(width);
  widthRef.current = width;

  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = widthRef.current;

    const onMove = (ev: MouseEvent) => {
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startW + ev.clientX - startX));
      setWidth(next);
    };

    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, []);

  // ── create node via backend (server generates id + order_idx) ───────────

  async function createNode(nodeType: "chat" | "folder") {
    if (!rootPath || creating) return;
    setBgCtxMenu(null);
    setCreating(true);
    try {
      const node =
        nodeType === "chat"
          ? await api.createChat(defaultProvider, defaultModel)
          : await api.createFolder();
      upsertNode(node);
      if (nodeType === "chat") {
        openTab(focusedPaneId, node.id);
      }
    } catch (e) {
      console.error(`create ${nodeType} failed:`, e);
    } finally {
      setCreating(false);
    }
  }

  async function importFiles(parentId: string | null = null) {
    setBgCtxMenu(null);
    const selected = await open({ multiple: true, directory: false });
    if (!selected) return;

    const paths = Array.isArray(selected) ? selected : [selected];
    await importFilesFromPaths(paths, parentId);
  }

  async function importFilesFromPaths(paths: string[], parentId: string | null = null) {
    await Promise.all(
      paths.map(async (path) => {
        try {
          const node = await api.importFile(path, parentId);
          upsertNode(node);
        } catch (e) {
          console.error("import file failed:", e);
        }
      }),
    );
  }

  useEffect(() => {
    const webview = getCurrentWebview();
    const unlisten = webview.onDragDropEvent((event) => {
      if (event.payload.type === "over") {
        const x = event.payload.position.x / (window.devicePixelRatio || 1);
        const y = event.payload.position.y / (window.devicePixelRatio || 1);
        const target = document.elementFromPoint(x, y);
        const isInsideSidebar = !!target && !!sidebarRef.current?.contains(target);
        const folderTarget = target?.closest("[data-folder-drop-id]") as HTMLElement | null;
        const folderId = folderTarget?.dataset.folderDropId ?? null;
        setDragOverSidebar(isInsideSidebar);
        setExternalDropFolderId(isInsideSidebar ? folderId : null);
      } else if (event.payload.type === "leave") {
        setDragOverSidebar(false);
        setExternalDropFolderId(null);
      } else if (event.payload.type === "drop") {
        const x = event.payload.position.x / (window.devicePixelRatio || 1);
        const y = event.payload.position.y / (window.devicePixelRatio || 1);
        const target = document.elementFromPoint(x, y);
        const isInsideSidebar = !!target && !!sidebarRef.current?.contains(target);
        const folderTarget = target?.closest("[data-folder-drop-id]") as HTMLElement | null;
        const folderId = folderTarget?.dataset.folderDropId ?? null;
        setDragOverSidebar(false);
        setExternalDropFolderId(null);
        if (!isInsideSidebar) return;
        const paths = event.payload.paths;
        if (paths.length > 0) {
          void importFilesFromPaths(paths, folderId);
        }
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // ── background right-click (empty area) ─────────────────────────────────

  function handleBgContext(e: React.MouseEvent) {
    e.preventDefault();
    setBgCtxMenu({ x: e.clientX, y: e.clientY });

    const close = (ev: MouseEvent) => {
      if (!bgCtxRef.current?.contains(ev.target as Node)) {
        setBgCtxMenu(null);
        document.removeEventListener("mousedown", close);
      }
    };
    setTimeout(() => document.addEventListener("mousedown", close), 0);
  }

  // ── render ──────────────────────────────────────────────────────────────

  return (
    <aside
      ref={sidebarRef}
      className="flex-shrink-0 bg-surface flex flex-col h-screen relative border-r border-border"
      style={{ width: `${width}px` }}
    >
      {/* section header */}
      <div className="px-3 pt-3 pb-2">
        <span className="text-[10px] text-fg-dim/70 uppercase tracking-wider font-medium">Workspace</span>
      </div>

      {/* scrollable tree area */}
      <div
        className={`flex-1 overflow-y-auto pb-2 ${dragOverSidebar ? "ring-2 ring-inset ring-accent" : ""}`}
        onContextMenu={handleBgContext}
      >
        {filteredNodes.length === 0 && sidebarFilter.trim() ? (
          <p className="text-[10px] text-fg-dim/60 text-center mt-6 px-4">
            No files or chats matching "{sidebarFilter}"
          </p>
        ) : filteredNodes.length === 0 ? (
          <p className="text-[10px] text-fg-dim/60 text-center mt-6 px-4">
            Right-click to add chats, folders, or files
          </p>
        ) : (
          <FileTree
            nodes={filteredNodes}
            parentId={null}
            externalDropFolderId={externalDropFolderId}
          />
        )}
      </div>

      {/* Skills section */}
      <SkillsSection />

      {/* footer buttons */}
      <div className="border-t border-border px-2 py-1.5 relative">
        <button
          ref={recentBtnRef}
          onClick={() => setRecentMenuOpen(!recentMenuOpen)}
          className={`w-full flex items-center gap-2 px-2 py-1.5 text-[11px] rounded-md transition-colors ${
            recentMenuOpen
              ? "text-fg bg-surface-hover"
              : "text-fg-dim hover:text-fg hover:bg-surface-hover/70"
          }`}
        >
          <FolderOpen size={13} />
          <span>Recent Workspaces</span>
        </button>

        {/* recent workspaces dropdown */}
        {recentMenuOpen && (
          <div
            ref={recentMenuRef}
            className="absolute bottom-full left-2 right-2 mb-1 bg-surface-raised border border-border-strong rounded-lg shadow-2xl py-1 max-h-[240px] overflow-y-auto z-50"
          >
            <button
              className="w-full text-left px-2.5 py-1.5 text-[11px] flex items-center gap-2 text-fg hover:bg-surface-hover rounded-md mx-0.5 transition-colors"
              style={{ width: "calc(100% - 4px)" }}
              onClick={openNewWorkspace}
            >
              <Plus size={11} className="text-fg-muted shrink-0" />
              <span>Open Workspace…</span>
            </button>
            {recentPaths.filter((p) => p !== rootPath).length > 0 && (
              <div className="border-t border-border mx-2 my-1" />
            )}
            {recentPaths
                .filter((p) => p !== rootPath)
                .map((path) => (
                  <button
                    key={path}
                    className="w-full text-left px-2.5 py-1.5 text-[11px] flex items-center gap-2 text-fg hover:bg-surface-hover rounded-md mx-0.5 transition-colors group/recent"
                    style={{ width: "calc(100% - 4px)" }}
                    onClick={() => switchWorkspace(path)}
                  >
                    <FolderOpen size={11} className="text-fg-muted shrink-0" />
                    <span className="truncate flex-1" title={path}>
                      {path.split("/").pop() || path}
                    </span>
                    <span
                      className="shrink-0 text-transparent group-hover/recent:text-fg-muted hover:!text-fg p-0.5 rounded"
                      onMouseDown={(e) => removeRecent(e, path)}
                    >
                      <X size={10} />
                    </span>
                  </button>
                ))}
          </div>
        )}

        <button
          onClick={() => setSettingsOpen(!settingsOpen)}
          className={`w-full flex items-center gap-2 px-2 py-1.5 text-[11px] rounded-md transition-colors ${
            settingsOpen
              ? "text-fg bg-surface-hover"
              : "text-fg-dim hover:text-fg hover:bg-surface-hover/70"
          }`}
        >
          <Settings size={13} />
          <span>Settings</span>
        </button>
      </div>

      {/* resize handle */}
      <div
        className="absolute top-0 right-[-2px] w-[5px] h-full cursor-col-resize hover:bg-accent/50 transition-colors z-10"
        onMouseDown={onResizeStart}
      />

      {/* background context menu */}
      {bgCtxMenu && (
        <div
          ref={bgCtxRef}
          className="fixed z-50 bg-surface-raised border border-border-strong rounded-lg shadow-2xl py-1 min-w-[150px]"
          style={{ left: bgCtxMenu.x, top: bgCtxMenu.y }}
        >
          <BgCtxItem
            icon={<Plus size={12} />}
            label="New Chat"
            onClick={() => createNode("chat")}
          />
          <BgCtxItem
            icon={<FolderPlus size={12} />}
            label="New Folder"
            onClick={() => createNode("folder")}
          />
          <BgCtxItem
            icon={<FilePlus2 size={12} />}
            label="Import Files"
            onClick={() => importFiles(null)}
          />
        </div>
      )}
    </aside>
  );
}

function SkillsSection() {
  const skills = useSkillStore((s) => s.skills);
  const saveSkill = useSkillStore((s) => s.saveSkill);
  const deleteSkill = useSkillStore((s) => s.deleteSkill);
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const newNameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (creating) {
      requestAnimationFrame(() => newNameRef.current?.focus());
    }
  }, [creating]);

  function startEdit(name: string, content: string) {
    setEditing(name);
    setEditContent(content);
  }

  async function commitEdit() {
    if (editing && editContent.trim()) {
      await saveSkill(editing, editContent);
    }
    setEditing(null);
    setEditContent("");
  }

  async function handleCreate() {
    const name = newName.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
    if (!name) {
      setCreating(false);
      setNewName("");
      return;
    }
    await saveSkill(name, `Instructions for /${name} skill.\n\nDescribe what this skill should do.`);
    setCreating(false);
    setNewName("");
    startEdit(name, `Instructions for /${name} skill.\n\nDescribe what this skill should do.`);
  }

  async function handleDelete(name: string) {
    await deleteSkill(name);
    if (editing === name) {
      setEditing(null);
      setEditContent("");
    }
  }

  return (
    <div className="border-t border-border">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-1 px-3 py-2 text-[10px] text-fg-dim/70 uppercase tracking-wider font-medium hover:text-fg-dim transition-colors"
      >
        <ChevronRight
          size={10}
          className={`transition-transform ${expanded ? "rotate-90" : ""}`}
        />
        <Zap size={10} />
        <span>Skills</span>
        <span className="ml-auto text-[9px] normal-case tracking-normal opacity-60">
          {skills.length}
        </span>
      </button>

      {expanded && (
        <div className="pb-2">
          {skills.map((skill) => (
            <div key={skill.name} className="group/skill">
              {editing === skill.name ? (
                <div className="px-3 py-1">
                  <div className="text-[11px] text-fg-muted font-medium mb-1">/{skill.name}</div>
                  <textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    className="w-full bg-bg border border-border rounded text-[11px] text-fg px-2 py-1.5 resize-none outline-none focus:border-accent min-h-[80px]"
                    autoFocus
                  />
                  <div className="flex justify-end gap-1 mt-1">
                    <button
                      onClick={() => { setEditing(null); setEditContent(""); }}
                      className="text-[10px] text-fg-dim hover:text-fg px-2 py-0.5 rounded transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={commitEdit}
                      className="text-[10px] text-accent hover:text-accent-hover px-2 py-0.5 rounded transition-colors"
                    >
                      Save
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  className="w-full flex items-center gap-2 px-3 py-1 text-[11px] text-fg-muted hover:text-fg hover:bg-surface-hover/70 transition-colors"
                  onClick={() => startEdit(skill.name, skill.content)}
                  title={skill.content.slice(0, 100)}
                >
                  <Zap size={10} className="shrink-0 opacity-50" />
                  <span className="truncate">/{skill.name}</span>
                  <span className="ml-auto flex gap-0.5 opacity-0 group-hover/skill:opacity-100 transition-opacity">
                    <span
                      className="p-0.5 hover:text-fg-error"
                      onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
                      onClick={(e) => { e.stopPropagation(); handleDelete(skill.name); }}
                    >
                      <Trash2 size={10} />
                    </span>
                  </span>
                </button>
              )}
            </div>
          ))}

          {creating ? (
            <div className="px-3 py-1">
              <input
                ref={newNameRef}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreate();
                  if (e.key === "Escape") { setCreating(false); setNewName(""); }
                }}
                onBlur={handleCreate}
                placeholder="skill-name"
                className="w-full bg-bg border border-border rounded text-[11px] text-fg px-2 py-1 outline-none focus:border-accent"
              />
            </div>
          ) : (
            <button
              onClick={() => setCreating(true)}
              className="w-full flex items-center gap-2 px-3 py-1 text-[11px] text-fg-dim hover:text-fg hover:bg-surface-hover/70 transition-colors"
            >
              <Plus size={10} />
              <span>New Skill</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function BgCtxItem({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className="w-full text-left px-2.5 py-1.5 text-xs flex items-center gap-2.5 text-fg hover:bg-surface-hover rounded-md mx-0.5 transition-colors"
      style={{ width: "calc(100% - 4px)" }}
      onMouseDown={(e) => {
        e.preventDefault();
        onClick();
      }}
    >
      <span className="text-fg-muted">{icon}</span>
      {label}
    </button>
  );
}
