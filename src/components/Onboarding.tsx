import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, KeyRound, ArrowRight, SkipForward } from "lucide-react";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useSettingsStore } from "../stores/settingsStore";
import type { WorkspaceNode } from "../stores/workspaceStore";

type Step = "pick" | "apikey";

export default function Onboarding() {
  const [step, setStep] = useState<Step>("pick");
  const [pendingPath, setPendingPath] = useState<string | null>(null);
  const [provider, setProvider] = useState("anthropic");
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const { setRootPath, setNodes } = useWorkspaceStore();
  const { setProviderConfig } = useSettingsStore();

  async function handlePickFolder() {
    setError(null);
    const dir = await open({ directory: true, multiple: false });
    if (!dir || typeof dir !== "string") return;
    setPendingPath(dir);
  }

  async function handleConfirmWorkspace() {
    if (!pendingPath) return;
    setLoading(true);
    setError(null);
    try {
      await invoke("save_workspace", { path: pendingPath });
      await invoke("open_workspace", { dbPath: pendingPath + "/snak.db" });
      const nodes = await invoke<WorkspaceNode[]>("list_nodes");
      setNodes(nodes);
      setStep("apikey");
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveApiKey() {
    setLoading(true);
    setError(null);
    try {
      if (apiKey.trim()) {
        await invoke("set_api_key", { provider, apiKey: apiKey.trim() });
        setProviderConfig(provider, { hasApiKey: true });
      }
      setRootPath(pendingPath!);
    } catch (e) {
      setError(String(e));
      setLoading(false);
    }
  }

  if (step === "pick") {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-6">
        <div className="text-center space-y-1.5">
          <h1 className="text-lg font-medium text-fg">Open a workspace</h1>
          <p className="text-xs text-fg-muted">
            Choose a folder to store your chats.
          </p>
        </div>

        <div className="w-72 space-y-2">
          <button
            onClick={handlePickFolder}
            className="w-full py-2 px-3 bg-surface-raised hover:bg-surface-hover border border-border-strong rounded text-left flex items-center gap-2.5 transition-colors cursor-pointer text-xs"
          >
            <FolderOpen size={14} className="text-fg-muted flex-shrink-0" />
            <span className={pendingPath ? "text-fg truncate" : "text-fg-muted"}>
              {pendingPath ?? "Select folder…"}
            </span>
          </button>

          {error && (
            <p className="text-[11px] text-fg-error px-1">{error}</p>
          )}

          <button
            onClick={handleConfirmWorkspace}
            disabled={!pendingPath || loading}
            className="w-full py-1.5 px-3 bg-accent hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed rounded text-xs font-medium text-white transition-colors flex items-center justify-center gap-1.5"
          >
            {loading ? "Opening…" : "Continue"}
            {!loading && <ArrowRight size={12} />}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center h-screen gap-6">
      <div className="text-center space-y-1.5">
        <h1 className="text-lg font-medium text-fg">Add an API key</h1>
        <p className="text-xs text-fg-muted">
          Optional — you can add keys later in settings.
        </p>
      </div>

      <div className="w-72 space-y-3">
        <div>
          <label className="block text-[11px] text-fg-muted mb-1">Provider</label>
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            className="w-full py-1.5 px-2.5 bg-surface-raised border border-border-strong rounded text-xs text-fg outline-none focus:border-accent"
          >
            <option value="anthropic">Anthropic</option>
            <option value="openai">OpenAI</option>
            <option value="openrouter">OpenRouter</option>
          </select>
        </div>

        <div>
          <label className="block text-[11px] text-fg-muted mb-1">Key</label>
          <div className="relative">
            <KeyRound size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" />
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSaveApiKey()}
              placeholder="sk-…"
              className="w-full py-1.5 pl-7 pr-2.5 bg-surface-raised border border-border-strong rounded text-xs text-fg placeholder-fg-dim outline-none focus:border-accent"
            />
          </div>
        </div>

        {error && (
          <p className="text-[11px] text-fg-error px-1">{error}</p>
        )}

        <div className="flex gap-2 pt-0.5">
          <button
            onClick={() => setRootPath(pendingPath!)}
            className="flex-1 py-1.5 px-3 bg-surface-raised hover:bg-surface-hover border border-border-strong rounded text-xs text-fg-muted transition-colors flex items-center justify-center gap-1"
          >
            <SkipForward size={11} />
            Skip
          </button>
          <button
            onClick={handleSaveApiKey}
            disabled={loading}
            className="flex-1 py-1.5 px-3 bg-accent hover:bg-accent-hover disabled:opacity-40 rounded text-xs font-medium text-white transition-colors flex items-center justify-center gap-1.5"
          >
            {loading ? "Saving…" : "Save"}
            {!loading && <ArrowRight size={12} />}
          </button>
        </div>
      </div>
    </div>
  );
}
