use std::collections::HashMap;
use std::sync::Mutex;

use futures::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_store::StoreExt;
use tokio_util::sync::CancellationToken;

// ── State ────────────────────────────────────────────────────────────────────

/// Holds a cancellation token per chat so callers can abort in-flight streams.
pub struct StreamState(pub Mutex<HashMap<String, CancellationToken>>);

// ── Shared types ─────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone)]
pub struct ApiMessage {
    pub role: String,
    pub content: String,
    #[serde(default)]
    pub attachments: Vec<MessageAttachment>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct MessageAttachment {
    /// "image", "pdf", "markdown"
    pub attachment_type: String,
    /// Absolute path to the file on disk
    pub path: String,
    pub name: String,
}

// ── Anthropic types ──────────────────────────────────────────────────────────

/// Anthropic messages use `content` as either a string or array of content blocks.
/// We build them as serde_json::Value to handle both cases.
#[derive(Serialize)]
struct AnthropicRequest {
    model: String,
    max_tokens: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    system: Option<String>,
    messages: Vec<serde_json::Value>,
    stream: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f64>,
}

// ── OpenAI types ─────────────────────────────────────────────────────────────

/// OpenAI messages use `content` as either a string or array of content parts.
#[derive(Serialize)]
struct OpenAIRequest {
    model: String,
    messages: Vec<serde_json::Value>,
    stream: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_tokens: Option<u32>,
}

// ── Ollama types ─────────────────────────────────────────────────────────────

#[derive(Serialize)]
struct OllamaRequest {
    model: String,
    messages: Vec<serde_json::Value>,
    stream: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    options: Option<OllamaOptions>,
}

#[derive(Serialize)]
struct OllamaOptions {
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    num_predict: Option<u32>,
}

#[derive(Deserialize)]
struct OllamaStreamChunk {
    message: Option<OllamaChunkMessage>,
    done: bool,
}

#[derive(Deserialize)]
struct OllamaChunkMessage {
    content: String,
}

// ── Event payloads ───────────────────────────────────────────────────────────

#[derive(Clone, Serialize)]
struct StreamTokenPayload {
    chat_id: String,
    token: String,
}

#[derive(Clone, Serialize)]
struct StreamDonePayload {
    chat_id: String,
    full_text: String,
}

#[derive(Clone, Serialize)]
struct StreamErrorPayload {
    chat_id: String,
    error: String,
}

// ── Command input ────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct StreamChatInput {
    pub chat_id: String,
    pub provider: String,
    pub model: String,
    pub messages: Vec<ApiMessage>,
    pub system_prompt: Option<String>,
    pub temperature: Option<f64>,
    pub max_tokens: Option<u32>,
    /// Ollama base URL override (default: http://localhost:11434)
    pub base_url: Option<String>,
}

// ── Commands ─────────────────────────────────────────────────────────────────

/// Start streaming a chat response. Returns immediately; tokens arrive via events.
#[tauri::command]
pub async fn stream_chat(
    app: AppHandle,
    input: StreamChatInput,
    stream_state: State<'_, StreamState>,
) -> Result<(), String> {
    let chat_id = input.chat_id.clone();

    // Create a cancellation token for this chat
    let cancel = CancellationToken::new();
    {
        let mut map = stream_state.0.lock().unwrap();
        if let Some(old) = map.remove(&chat_id) {
            old.cancel();
        }
        map.insert(chat_id.clone(), cancel.clone());
    }

    // Retrieve the API key (not needed for ollama)
    let api_key = if input.provider != "ollama" {
        let store = app.store("keys.bin").map_err(|e| e.to_string())?;
        let key_name = format!("api_key:{}", input.provider);
        let key = store
            .get(&key_name)
            .and_then(|v| v.as_str().map(|s| s.to_string()));
        match key {
            Some(k) if !k.is_empty() => k,
            _ => {
                return Err(format!(
                    "No API key configured for provider '{}'",
                    input.provider
                ))
            }
        }
    } else {
        String::new()
    };

    let provider = input.provider.clone();
    let model = input.model.clone();
    let messages = input.messages.clone();
    let system_prompt = input.system_prompt.clone();
    let temperature = input.temperature;
    let max_tokens = input.max_tokens.unwrap_or(4096);
    let base_url = input.base_url.clone();

    // Spawn the streaming task
    tauri::async_runtime::spawn(async move {
        let result = match provider.as_str() {
            "ollama" => {
                let url = base_url
                    .as_deref()
                    .unwrap_or("http://localhost:11434");
                stream_ollama(
                    &app, &chat_id, &cancel, url, &model, messages,
                    system_prompt, temperature, max_tokens,
                )
                .await
            }
            "openai" | "openrouter" => {
                stream_openai(
                    &app, &chat_id, &cancel, &api_key, &provider, &model,
                    messages, system_prompt, temperature, max_tokens,
                )
                .await
            }
            _ => {
                // Default: Anthropic
                stream_anthropic(
                    &app, &chat_id, &cancel, &api_key, &model, messages,
                    system_prompt, temperature, max_tokens,
                )
                .await
            }
        };

        if let Err(e) = result {
            let _ = app.emit(
                "stream-error",
                StreamErrorPayload {
                    chat_id: chat_id.clone(),
                    error: e,
                },
            );
        }
    });

    Ok(())
}

/// Cancel an in-progress stream.
#[tauri::command]
pub fn abort_stream(chat_id: String, stream_state: State<'_, StreamState>) -> Result<(), String> {
    let mut map = stream_state.0.lock().unwrap();
    if let Some(token) = map.remove(&chat_id) {
        token.cancel();
    }
    Ok(())
}

// ── Auto-title ──────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct AutoTitleInput {
    pub provider: String,
    pub model: String,
    pub messages: Vec<ApiMessage>,
    /// Ollama base URL override
    pub base_url: Option<String>,
}

/// Generate a short title (3–5 words) for a chat based on its messages.
/// Returns the title string. Failures return Err (caller should treat silently).
#[tauri::command]
pub async fn auto_title_chat(
    app: AppHandle,
    input: AutoTitleInput,
) -> Result<String, String> {
    let api_key = if input.provider != "ollama" {
        let store = app.store("keys.bin").map_err(|e| e.to_string())?;
        let key_name = format!("api_key:{}", input.provider);
        store
            .get(&key_name)
            .and_then(|v| v.as_str().map(|s| s.to_string()))
            .ok_or_else(|| format!("No API key for '{}'", input.provider))?
    } else {
        String::new()
    };

    let system = "Generate a concise title (3-5 words) for this conversation. Reply with ONLY the title, no quotes or punctuation.".to_string();

    // Take at most the first 2 messages (user + assistant) to keep it cheap
    let msgs: Vec<ApiMessage> = input.messages.into_iter().take(2).collect();

    let client = Client::new();

    // Convert to simple JSON messages (no attachments for title generation)
    let to_json = |m: &ApiMessage| serde_json::json!({"role": m.role, "content": m.content});

    let body_text = match input.provider.as_str() {
        "ollama" => {
            let url = input.base_url.as_deref().unwrap_or("http://localhost:11434");
            let sys_msg = ApiMessage { role: "system".to_string(), content: system, attachments: vec![] };
            let mut all_json = vec![to_json(&sys_msg)];
            all_json.extend(msgs.iter().map(|m| to_json(m)));
            let body = OllamaRequest {
                model: input.model,
                messages: all_json,
                stream: false,
                options: Some(OllamaOptions { temperature: Some(0.3), num_predict: Some(20) }),
            };
            let resp = client.post(format!("{url}/api/chat")).json(&body).send().await.map_err(|e| e.to_string())?;
            let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
            json.get("message")
                .and_then(|m| m.get("content"))
                .and_then(|c| c.as_str())
                .unwrap_or("New Chat")
                .trim()
                .to_string()
        }
        "openai" | "openrouter" => {
            let base_url = match input.provider.as_str() {
                "openrouter" => "https://openrouter.ai/api/v1",
                _ => "https://api.openai.com/v1",
            };
            let sys_msg = ApiMessage { role: "system".to_string(), content: system, attachments: vec![] };
            let mut all_json = vec![to_json(&sys_msg)];
            all_json.extend(msgs.iter().map(|m| to_json(m)));
            let body = OpenAIRequest {
                model: input.model,
                messages: all_json,
                stream: false,
                temperature: Some(0.3),
                max_tokens: Some(20),
            };
            let resp = client
                .post(format!("{base_url}/chat/completions"))
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {api_key}"))
                .json(&body)
                .send().await.map_err(|e| e.to_string())?;
            let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
            json.get("choices")
                .and_then(|c| c.as_array())
                .and_then(|a| a.first())
                .and_then(|c| c.get("message"))
                .and_then(|m| m.get("content"))
                .and_then(|c| c.as_str())
                .unwrap_or("New Chat")
                .trim()
                .to_string()
        }
        _ => {
            // Anthropic
            let json_msgs: Vec<serde_json::Value> = msgs.iter().map(|m| to_json(m)).collect();
            let body = AnthropicRequest {
                model: input.model,
                max_tokens: 30,
                system: Some(system),
                messages: json_msgs,
                stream: false,
                temperature: Some(0.3),
            };
            let resp = client
                .post("https://api.anthropic.com/v1/messages")
                .header("content-type", "application/json")
                .header("anthropic-version", "2023-06-01")
                .header("x-api-key", &api_key)
                .json(&body)
                .send().await.map_err(|e| e.to_string())?;
            let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
            json.get("content")
                .and_then(|c| c.as_array())
                .and_then(|a| a.first())
                .and_then(|b| b.get("text"))
                .and_then(|t| t.as_str())
                .unwrap_or("New Chat")
                .trim()
                .to_string()
        }
    };

    Ok(body_text)
}

// ── Ollama model listing ─────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct OllamaModel {
    pub name: String,
    pub size: u64,
    pub modified_at: String,
}

/// Fetch the list of locally available Ollama models via `GET /api/tags`.
#[tauri::command]
pub async fn list_ollama_models(base_url: Option<String>) -> Result<Vec<OllamaModel>, String> {
    let url = base_url.as_deref().unwrap_or("http://localhost:11434");
    let client = Client::new();

    let resp = client
        .get(format!("{url}/api/tags"))
        .send()
        .await
        .map_err(|e| format!("Failed to connect to Ollama at {url}: {e}. Is Ollama running?"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Ollama error {status}: {body}"));
    }

    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;

    let models = json
        .get("models")
        .and_then(|m| m.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|m| {
                    let name = m.get("name")?.as_str()?.to_string();
                    let size = m.get("size").and_then(|s| s.as_u64()).unwrap_or(0);
                    let modified_at = m
                        .get("modified_at")
                        .and_then(|s| s.as_str())
                        .unwrap_or("")
                        .to_string();
                    Some(OllamaModel { name, size, modified_at })
                })
                .collect()
        })
        .unwrap_or_default();

    Ok(models)
}

// ── Multimodal message builders ──────────────────────────────────────────────

/// Read a file and return (base64_data, mime_type).
fn read_image_base64(path: &str) -> Result<(String, String), String> {
    use base64::Engine;
    let p = std::path::Path::new(path);
    let bytes = std::fs::read(p).map_err(|e| format!("Failed to read image {path}: {e}"))?;
    let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    let mime = match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        _ => "image/png",
    };
    let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok((encoded, mime.to_string()))
}

/// Build Anthropic-format message (content as array when attachments present).
fn build_anthropic_message(msg: &ApiMessage) -> Result<serde_json::Value, String> {
    if msg.attachments.is_empty() {
        return Ok(serde_json::json!({
            "role": msg.role,
            "content": msg.content,
        }));
    }

    let mut content_blocks = Vec::new();

    for att in &msg.attachments {
        match att.attachment_type.as_str() {
            "image" => {
                let (data, media_type) = read_image_base64(&att.path)?;
                content_blocks.push(serde_json::json!({
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": media_type,
                        "data": data,
                    }
                }));
            }
            "pdf" => {
                let bytes = std::fs::read(&att.path)
                    .map_err(|e| format!("Failed to read PDF: {e}"))?;
                let text = pdf_extract::extract_text_from_mem(&bytes)
                    .map_err(|e| format!("Failed to extract PDF text: {e}"))?;
                content_blocks.push(serde_json::json!({
                    "type": "text",
                    "text": format!("[PDF: {}]\n{}", att.name, text),
                }));
            }
            "markdown" => {
                let text = std::fs::read_to_string(&att.path)
                    .map_err(|e| format!("Failed to read markdown file: {e}"))?;
                content_blocks.push(serde_json::json!({
                    "type": "text",
                    "text": format!("[File: {}]\n{}", att.name, text),
                }));
            }
            _ => {}
        }
    }

    // Add the user's text message last
    if !msg.content.is_empty() {
        content_blocks.push(serde_json::json!({
            "type": "text",
            "text": msg.content,
        }));
    }

    Ok(serde_json::json!({
        "role": msg.role,
        "content": content_blocks,
    }))
}

/// Build OpenAI-format message (content as array when attachments present).
fn build_openai_message(msg: &ApiMessage) -> Result<serde_json::Value, String> {
    if msg.attachments.is_empty() {
        return Ok(serde_json::json!({
            "role": msg.role,
            "content": msg.content,
        }));
    }

    let mut content_parts = Vec::new();

    for att in &msg.attachments {
        match att.attachment_type.as_str() {
            "image" => {
                let (data, media_type) = read_image_base64(&att.path)?;
                content_parts.push(serde_json::json!({
                    "type": "image_url",
                    "image_url": {
                        "url": format!("data:{media_type};base64,{data}"),
                    }
                }));
            }
            "pdf" => {
                let bytes = std::fs::read(&att.path)
                    .map_err(|e| format!("Failed to read PDF: {e}"))?;
                let text = pdf_extract::extract_text_from_mem(&bytes)
                    .map_err(|e| format!("Failed to extract PDF text: {e}"))?;
                content_parts.push(serde_json::json!({
                    "type": "text",
                    "text": format!("[PDF: {}]\n{}", att.name, text),
                }));
            }
            "markdown" => {
                let text = std::fs::read_to_string(&att.path)
                    .map_err(|e| format!("Failed to read markdown file: {e}"))?;
                content_parts.push(serde_json::json!({
                    "type": "text",
                    "text": format!("[File: {}]\n{}", att.name, text),
                }));
            }
            _ => {}
        }
    }

    if !msg.content.is_empty() {
        content_parts.push(serde_json::json!({
            "type": "text",
            "text": msg.content,
        }));
    }

    Ok(serde_json::json!({
        "role": msg.role,
        "content": content_parts,
    }))
}

/// Build Ollama-format message. Images go in a separate `images` field as base64.
/// Text attachments (PDF, markdown) are prepended to the content.
fn build_ollama_message(msg: &ApiMessage) -> Result<serde_json::Value, String> {
    if msg.attachments.is_empty() {
        return Ok(serde_json::json!({
            "role": msg.role,
            "content": msg.content,
        }));
    }

    let mut images: Vec<String> = Vec::new();
    let mut extra_text = String::new();

    for att in &msg.attachments {
        match att.attachment_type.as_str() {
            "image" => {
                let (data, _mime) = read_image_base64(&att.path)?;
                images.push(data);
            }
            "pdf" => {
                let bytes = std::fs::read(&att.path)
                    .map_err(|e| format!("Failed to read PDF: {e}"))?;
                let text = pdf_extract::extract_text_from_mem(&bytes)
                    .map_err(|e| format!("Failed to extract PDF text: {e}"))?;
                extra_text.push_str(&format!("[PDF: {}]\n{}\n\n", att.name, text));
            }
            "markdown" => {
                let text = std::fs::read_to_string(&att.path)
                    .map_err(|e| format!("Failed to read markdown file: {e}"))?;
                extra_text.push_str(&format!("[File: {}]\n{}\n\n", att.name, text));
            }
            _ => {}
        }
    }

    let content = if extra_text.is_empty() {
        msg.content.clone()
    } else {
        format!("{extra_text}{}", msg.content)
    };

    let mut val = serde_json::json!({
        "role": msg.role,
        "content": content,
    });

    if !images.is_empty() {
        val["images"] = serde_json::json!(images);
    }

    Ok(val)
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/// Shared SSE streaming loop: reads byte chunks, splits on newlines, calls
/// `handle_line` for each `data: ...` payload. Returns the accumulated text.
async fn sse_stream_loop(
    app: &AppHandle,
    chat_id: &str,
    cancel: &CancellationToken,
    response: reqwest::Response,
    mut handle_data: impl FnMut(&str, &mut String, &AppHandle, &str),
) -> Result<(), String> {
    let mut full_text = String::new();
    let mut stream = response.bytes_stream();
    let mut buf = String::new();

    loop {
        tokio::select! {
            _ = cancel.cancelled() => {
                let _ = app.emit("stream-done", StreamDonePayload {
                    chat_id: chat_id.to_string(),
                    full_text: full_text.clone(),
                });
                return Ok(());
            }
            chunk = stream.next() => {
                match chunk {
                    Some(Ok(bytes)) => {
                        buf.push_str(&String::from_utf8_lossy(&bytes));
                        while let Some(pos) = buf.find('\n') {
                            let line = buf[..pos].trim_end().to_string();
                            buf = buf[pos + 1..].to_string();

                            if let Some(data) = line.strip_prefix("data: ") {
                                if data == "[DONE]" {
                                    let _ = app.emit("stream-done", StreamDonePayload {
                                        chat_id: chat_id.to_string(),
                                        full_text: full_text.clone(),
                                    });
                                    return Ok(());
                                }
                                handle_data(data, &mut full_text, app, chat_id);
                            }
                        }
                    }
                    Some(Err(e)) => return Err(e.to_string()),
                    None => {
                        let _ = app.emit("stream-done", StreamDonePayload {
                            chat_id: chat_id.to_string(),
                            full_text: full_text.clone(),
                        });
                        return Ok(());
                    }
                }
            }
        }
    }
}

fn emit_token(app: &AppHandle, chat_id: &str, token: &str) {
    let _ = app.emit(
        "stream-token",
        StreamTokenPayload {
            chat_id: chat_id.to_string(),
            token: token.to_string(),
        },
    );
}

// ── Anthropic streaming ──────────────────────────────────────────────────────

async fn stream_anthropic(
    app: &AppHandle,
    chat_id: &str,
    cancel: &CancellationToken,
    api_key: &str,
    model: &str,
    messages: Vec<ApiMessage>,
    system_prompt: Option<String>,
    temperature: Option<f64>,
    max_tokens: u32,
) -> Result<(), String> {
    let client = Client::new();

    let json_messages: Vec<serde_json::Value> = messages
        .iter()
        .map(|m| build_anthropic_message(m))
        .collect::<Result<_, _>>()?;

    let body = AnthropicRequest {
        model: model.to_string(),
        max_tokens,
        system: system_prompt.filter(|s| !s.is_empty()),
        messages: json_messages,
        stream: true,
        temperature,
    };

    let response = client
        .post("https://api.anthropic.com/v1/messages")
        .header("content-type", "application/json")
        .header("anthropic-version", "2023-06-01")
        .header("x-api-key", api_key)
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        let status = response.status();
        let body_text = response.text().await.unwrap_or_default();
        return Err(format!("Anthropic API error {status}: {body_text}"));
    }

    sse_stream_loop(app, chat_id, cancel, response, |data, full_text, app, cid| {
        if let Ok(event) = serde_json::from_str::<serde_json::Value>(data) {
            // content_block_delta → delta.text
            if let Some(delta) = event.get("delta") {
                if let Some(text) = delta.get("text").and_then(|t| t.as_str()) {
                    full_text.push_str(text);
                    emit_token(app, cid, text);
                }
            }
            // message_stop triggers done via the SSE loop detecting end-of-stream
        }
    })
    .await
}

// ── OpenAI-compatible streaming (OpenAI, OpenRouter) ─────────────────────────

async fn stream_openai(
    app: &AppHandle,
    chat_id: &str,
    cancel: &CancellationToken,
    api_key: &str,
    provider: &str,
    model: &str,
    mut messages: Vec<ApiMessage>,
    system_prompt: Option<String>,
    temperature: Option<f64>,
    max_tokens: u32,
) -> Result<(), String> {
    // Prepend system prompt as a system message
    if let Some(sys) = system_prompt.filter(|s| !s.is_empty()) {
        messages.insert(0, ApiMessage {
            role: "system".to_string(),
            content: sys,
            attachments: vec![],
        });
    }

    let json_messages: Vec<serde_json::Value> = messages
        .iter()
        .map(|m| build_openai_message(m))
        .collect::<Result<_, _>>()?;

    let base_url = match provider {
        "openrouter" => "https://openrouter.ai/api/v1",
        _ => "https://api.openai.com/v1",
    };

    let client = Client::new();

    let body = OpenAIRequest {
        model: model.to_string(),
        messages: json_messages,
        stream: true,
        temperature,
        max_tokens: Some(max_tokens),
    };

    let response = client
        .post(format!("{base_url}/chat/completions"))
        .header("content-type", "application/json")
        .header("authorization", format!("Bearer {api_key}"))
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        let status = response.status();
        let body_text = response.text().await.unwrap_or_default();
        return Err(format!("{provider} API error {status}: {body_text}"));
    }

    sse_stream_loop(app, chat_id, cancel, response, |data, full_text, app, cid| {
        if let Ok(event) = serde_json::from_str::<serde_json::Value>(data) {
            // OpenAI SSE: choices[0].delta.content
            if let Some(choices) = event.get("choices").and_then(|c| c.as_array()) {
                if let Some(first) = choices.first() {
                    if let Some(delta) = first.get("delta") {
                        if let Some(text) = delta.get("content").and_then(|t| t.as_str()) {
                            full_text.push_str(text);
                            emit_token(app, cid, text);
                        }
                    }
                }
            }
        }
    })
    .await
}

// ── Ollama streaming ─────────────────────────────────────────────────────────

async fn stream_ollama(
    app: &AppHandle,
    chat_id: &str,
    cancel: &CancellationToken,
    base_url: &str,
    model: &str,
    mut messages: Vec<ApiMessage>,
    system_prompt: Option<String>,
    temperature: Option<f64>,
    max_tokens: u32,
) -> Result<(), String> {
    if let Some(sys) = system_prompt.filter(|s| !s.is_empty()) {
        messages.insert(0, ApiMessage {
            role: "system".to_string(),
            content: sys,
            attachments: vec![],
        });
    }

    let json_messages: Vec<serde_json::Value> = messages
        .iter()
        .map(|m| build_ollama_message(m))
        .collect::<Result<_, _>>()?;

    let client = Client::new();

    let body = OllamaRequest {
        model: model.to_string(),
        messages: json_messages,
        stream: true,
        options: Some(OllamaOptions {
            temperature,
            num_predict: Some(max_tokens),
        }),
    };

    let response = client
        .post(format!("{base_url}/api/chat"))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Ollama connection failed: {e}. Is Ollama running?"))?;

    if !response.status().is_success() {
        let status = response.status();
        let body_text = response.text().await.unwrap_or_default();
        return Err(format!("Ollama error {status}: {body_text}"));
    }

    let mut full_text = String::new();
    let mut stream = response.bytes_stream();
    let mut buf = String::new();

    loop {
        tokio::select! {
            _ = cancel.cancelled() => {
                let _ = app.emit("stream-done", StreamDonePayload {
                    chat_id: chat_id.to_string(),
                    full_text: full_text.clone(),
                });
                return Ok(());
            }
            chunk = stream.next() => {
                match chunk {
                    Some(Ok(bytes)) => {
                        buf.push_str(&String::from_utf8_lossy(&bytes));
                        while let Some(pos) = buf.find('\n') {
                            let line = buf[..pos].trim().to_string();
                            buf = buf[pos + 1..].to_string();
                            if line.is_empty() { continue; }

                            match serde_json::from_str::<OllamaStreamChunk>(&line) {
                                Ok(chunk) => {
                                    if let Some(msg) = &chunk.message {
                                        if !msg.content.is_empty() {
                                            full_text.push_str(&msg.content);
                                            emit_token(app, chat_id, &msg.content);
                                        }
                                    }
                                    if chunk.done {
                                        let _ = app.emit("stream-done", StreamDonePayload {
                                            chat_id: chat_id.to_string(),
                                            full_text: full_text.clone(),
                                        });
                                        return Ok(());
                                    }
                                }
                                Err(e) => {
                                    eprintln!("Failed to parse Ollama chunk: {e}: {line}");
                                }
                            }
                        }
                    }
                    Some(Err(e)) => return Err(e.to_string()),
                    None => {
                        let _ = app.emit("stream-done", StreamDonePayload {
                            chat_id: chat_id.to_string(),
                            full_text: full_text.clone(),
                        });
                        return Ok(());
                    }
                }
            }
        }
    }
}
