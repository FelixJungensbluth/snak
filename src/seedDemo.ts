import { invoke } from "@tauri-apps/api/core";

const USER_PROMPT = `Show me examples of:
1. Markdown formatting (headings, bold, italic, lists)
2. A code block with syntax highlighting
3. A math equation
4. A table
5. A blockquote`;

const ASSISTANT_RESPONSE = `# Rich Content Demo

Here's a tour of everything I can render!

## Text Formatting

You can use **bold text**, *italic text*, and \`inline code\` seamlessly in any message. Links like [Anthropic](https://anthropic.com) are rendered as clickable.

---

## Lists

**Unordered list:**
- First item
- Second item with **bold**
- Third with \`code\`

**Ordered list:**
1. Step one
2. Step two
3. Step three

---

## Code Blocks

Here's a TypeScript function with full syntax highlighting:

\`\`\`typescript
interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

function streamTokens(messages: ChatMessage[]): AsyncGenerator<string> {
  const encoder = new TextEncoder();
  return async function* () {
    for (const msg of messages) {
      for (const char of msg.content) {
        yield char;
        await new Promise((r) => setTimeout(r, 15));
      }
    }
  }();
}
\`\`\`

And a Python example:

\`\`\`python
import asyncio
from dataclasses import dataclass

@dataclass
class Config:
    model: str = "claude-sonnet-4-6"
    temperature: float = 0.7
    max_tokens: int = 4096

async def main():
    config = Config()
    print(f"Using {config.model} at temp {config.temperature}")

asyncio.run(main())
\`\`\`

A Rust snippet:

\`\`\`rust
use tokio::sync::CancellationToken;

async fn stream_chat(token: CancellationToken) -> Result<String, Box<dyn std::error::Error>> {
    let mut output = String::new();
    loop {
        tokio::select! {
            _ = token.cancelled() => break,
            chunk = fetch_next_chunk() => {
                output.push_str(&chunk?);
            }
        }
    }
    Ok(output)
}
\`\`\`

---

## Math (LaTeX)

Inline math: The quadratic formula is $x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$.

Block equation:

$$
\\nabla \\times \\mathbf{E} = -\\frac{\\partial \\mathbf{B}}{\\partial t}
$$

Euler's identity:

$$
e^{i\\pi} + 1 = 0
$$

A summation:

$$
\\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6}
$$

---

## Tables

| Provider | Streaming | Auth |
|----------|-----------|------|
| Anthropic | SSE | API Key |
| OpenAI | SSE | API Key |
| OpenRouter | SSE | API Key |
| Ollama | JSON stream | None (local) |

---

## Blockquotes

> "Any sufficiently advanced technology is indistinguishable from magic."
> — Arthur C. Clarke

> **Note:** Blockquotes can contain **formatting**, \`code\`, and even math like $E = mc^2$.

---

That covers headings, bold, italic, inline code, code blocks with syntax highlighting, LaTeX math (inline & block), tables, blockquotes, horizontal rules, and links!`;

export interface SeedResult {
  id: string;
  node_type: string;
  name: string;
  parent_id: string | null;
  order_idx: number;
  is_archived: boolean;
  provider: string | null;
  model: string | null;
  last_message: string | null;
}

export async function seedDemoChat(workspaceRoot: string): Promise<SeedResult> {
  const node = await invoke<SeedResult>("create_chat", {
    workspaceRoot,
    parentId: null,
    name: "Rich Content Demo",
    provider: "anthropic",
    model: "claude-sonnet-4-6",
  });

  await invoke("append_message_to_file", {
    workspaceRoot,
    chatId: node.id,
    role: "user",
    content: USER_PROMPT,
  });

  await invoke("append_message_to_file", {
    workspaceRoot,
    chatId: node.id,
    role: "assistant",
    content: ASSISTANT_RESPONSE,
  });

  return node;
}
