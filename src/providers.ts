export const PROVIDERS = [
  { id: "anthropic", label: "Anthropic", placeholder: "sk-ant-...", needsKey: true },
  { id: "openai", label: "OpenAI", placeholder: "sk-...", needsKey: true },
  { id: "openrouter", label: "OpenRouter", placeholder: "sk-or-...", needsKey: true },
  { id: "ollama", label: "Ollama", placeholder: "", needsKey: false },
] as const;

export const PROVIDER_MODELS: Record<string, string[]> = {
  anthropic: [
    "claude-opus-4-6",
    "claude-sonnet-4-6",
    "claude-haiku-4-5-20251001",
  ],
  openai: [
    "gpt-4o",
    "gpt-4o-mini",
    "gpt-4-turbo",
    "o3",
    "o4-mini",
  ],
  openrouter: [
    "anthropic/claude-sonnet-4",
    "openai/gpt-4o",
    "google/gemini-2.5-pro",
    "meta-llama/llama-4-maverick",
  ],
  ollama: [
    "llama3.3",
    "llama3.2",
    "mistral",
    "codellama",
    "gemma2",
    "phi3",
    "qwen2.5",
  ],
};

export const PROVIDER_LABELS: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  openrouter: "OpenRouter",
  ollama: "Ollama",
};

/** Approximate context window sizes (in tokens) per model. */
export const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  // Anthropic
  "claude-opus-4-6": 200_000,
  "claude-sonnet-4-6": 200_000,
  "claude-haiku-4-5-20251001": 200_000,
  // OpenAI
  "gpt-4o": 128_000,
  "gpt-4o-mini": 128_000,
  "gpt-4-turbo": 128_000,
  "o3": 200_000,
  "o4-mini": 200_000,
  // OpenRouter (same underlying models)
  "anthropic/claude-sonnet-4": 200_000,
  "openai/gpt-4o": 128_000,
  "google/gemini-2.5-pro": 1_000_000,
  "meta-llama/llama-4-maverick": 128_000,
  // Ollama (local, typical defaults)
  "llama3.3": 128_000,
  "llama3.2": 128_000,
  "mistral": 32_000,
  "codellama": 16_000,
  "gemma2": 8_000,
  "phi3": 128_000,
  "qwen2.5": 128_000,
};

/**
 * Rough token estimate: ~4 characters per token for English text.
 * This is a heuristic — actual tokenization varies by model.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
