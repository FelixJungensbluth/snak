use std::fs;
use std::path::Path;
use std::sync::Mutex;
use tauri::State;
use tauri_plugin_store::StoreExt;
use uuid::Uuid;

use crate::db;

pub struct DbState(pub Mutex<Option<rusqlite::Connection>>);

const WORKSPACE_STORE: &str = "workspace.bin";
const WORKSPACE_PATH_KEY: &str = "workspace_path";

// ── Health / open ────────────────────────────────────────────────────────────

#[derive(Debug, serde::Serialize)]
pub struct DbHealthResponse {
    pub ok: bool,
    pub node_count: i64,
}

/// Open (or create) the workspace database at `db_path` and run schema migrations.
#[tauri::command]
pub fn open_workspace(db_path: String, state: State<'_, DbState>) -> Result<(), String> {
    let conn = db::open_workspace_db(&db_path).map_err(|e| e.to_string())?;
    let mut guard = state.0.lock().unwrap();
    *guard = Some(conn);
    Ok(())
}

/// Return a health report for the currently open workspace database.
#[tauri::command]
pub fn db_health(state: State<'_, DbState>) -> Result<DbHealthResponse, String> {
    let guard = state.0.lock().unwrap();
    let conn = guard.as_ref().ok_or("No workspace open")?;
    let node_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM nodes", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    Ok(DbHealthResponse { ok: true, node_count })
}

// ── Workspace path persistence ───────────────────────────────────────────────

/// Persist the workspace root path to the store so it survives relaunches.
#[tauri::command]
pub fn save_workspace(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let store = app.store(WORKSPACE_STORE).map_err(|e| e.to_string())?;
    store.set(WORKSPACE_PATH_KEY, serde_json::Value::String(path));
    store.save().map_err(|e| e.to_string())?;
    Ok(())
}

/// Retrieve the previously-saved workspace path. Returns `None` on first launch.
#[tauri::command]
pub fn get_saved_workspace(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let store = app.store(WORKSPACE_STORE).map_err(|e| e.to_string())?;
    Ok(store
        .get(WORKSPACE_PATH_KEY)
        .and_then(|v| v.as_str().map(|s| s.to_string())))
}

// ── Node CRUD ────────────────────────────────────────────────────────────────

#[derive(Debug, serde::Serialize)]
pub struct NodeResponse {
    pub id: String,
    #[serde(rename = "type")]
    pub node_type: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub order_idx: i64,
    pub is_archived: bool,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub last_message: Option<String>,
}

/// List all non-archived nodes from the workspace.
#[tauri::command]
pub fn list_nodes(state: State<'_, DbState>) -> Result<Vec<NodeResponse>, String> {
    let guard = state.0.lock().unwrap();
    let conn = guard.as_ref().ok_or("No workspace open")?;
    db::list_nodes(conn)
        .map(|rows| {
            rows.into_iter()
                .map(|r| NodeResponse {
                    id: r.id,
                    node_type: r.node_type,
                    name: r.name,
                    parent_id: r.parent_id,
                    order_idx: r.order_idx,
                    is_archived: r.is_archived,
                    provider: r.provider,
                    model: r.model,
                    last_message: r.last_message,
                })
                .collect()
        })
        .map_err(|e| e.to_string())
}

// ── Low-level insert ─────────────────────────────────────────────────────────

#[derive(Debug, serde::Deserialize)]
pub struct InsertNodePayload {
    pub id: String,
    pub node_type: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub order_idx: i64,
    pub provider: Option<String>,
    pub model: Option<String>,
}

/// Low-level insert a node row (used by integration tests / direct callers).
#[tauri::command]
pub fn insert_node(
    payload: InsertNodePayload,
    state: State<'_, DbState>,
) -> Result<(), String> {
    let guard = state.0.lock().unwrap();
    let conn = guard.as_ref().ok_or("No workspace open")?;
    db::insert_node(
        conn,
        &payload.id,
        &payload.node_type,
        &payload.name,
        payload.parent_id.as_deref(),
        payload.order_idx,
        payload.provider.as_deref(),
        payload.model.as_deref(),
    )
    .map_err(|e| e.to_string())
}

// ── High-level create helpers ────────────────────────────────────────────────

/// Resolve the directory on disk that should contain children of `parent_id`.
fn node_dir_for_parent(
    workspace_root: &str,
    parent_id: Option<&str>,
    conn: &rusqlite::Connection,
) -> Result<std::path::PathBuf, String> {
    match parent_id {
        None => Ok(Path::new(workspace_root).to_path_buf()),
        Some(pid) => {
            let exists: bool = conn
                .query_row(
                    "SELECT COUNT(*) FROM nodes WHERE id = ?1 AND type = 'folder'",
                    rusqlite::params![pid],
                    |row| row.get::<_, i64>(0),
                )
                .map(|c| c > 0)
                .map_err(|e| e.to_string())?;
            if !exists {
                return Err(format!("Parent folder '{pid}' not found"));
            }
            Ok(Path::new(workspace_root).join(pid))
        }
    }
}

/// Create a new chat: writes a `.md` file with YAML frontmatter and inserts a node row.
#[tauri::command]
pub fn create_chat(
    workspace_root: String,
    parent_id: Option<String>,
    name: Option<String>,
    provider: Option<String>,
    model: Option<String>,
    state: State<'_, DbState>,
) -> Result<NodeResponse, String> {
    let guard = state.0.lock().unwrap();
    let conn = guard.as_ref().ok_or("No workspace open")?;

    let id = Uuid::new_v4().to_string();
    let display_name = name.unwrap_or_else(|| "New Chat".to_string());
    let provider_str = provider.as_deref().unwrap_or("anthropic").to_string();
    let model_str = model.as_deref().unwrap_or("claude-sonnet-4-6").to_string();

    let dir = node_dir_for_parent(&workspace_root, parent_id.as_deref(), conn)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let order_idx: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(order_idx), -1) + 1 FROM nodes WHERE parent_id IS ?1",
            rusqlite::params![parent_id],
            |row| row.get(0),
        )
        .unwrap_or(0);

    let file_path = dir.join(format!("{id}.md"));
    let frontmatter = format!(
        "---\nid: {id}\nname: {display_name}\nprovider: {provider_str}\nmodel: {model_str}\n---\n"
    );
    fs::write(&file_path, frontmatter).map_err(|e| e.to_string())?;

    db::insert_node(
        conn,
        &id,
        "chat",
        &display_name,
        parent_id.as_deref(),
        order_idx,
        Some(&provider_str),
        Some(&model_str),
    )
    .map_err(|e| e.to_string())?;

    Ok(NodeResponse {
        id,
        node_type: "chat".to_string(),
        name: display_name,
        parent_id,
        order_idx,
        is_archived: false,
        provider: Some(provider_str),
        model: Some(model_str),
        last_message: None,
    })
}

/// Create a new folder: makes a directory on disk and inserts a node row.
#[tauri::command]
pub fn create_folder(
    workspace_root: String,
    parent_id: Option<String>,
    name: Option<String>,
    state: State<'_, DbState>,
) -> Result<NodeResponse, String> {
    let guard = state.0.lock().unwrap();
    let conn = guard.as_ref().ok_or("No workspace open")?;

    let id = Uuid::new_v4().to_string();
    let display_name = name.unwrap_or_else(|| "New Folder".to_string());

    let parent_dir = node_dir_for_parent(&workspace_root, parent_id.as_deref(), conn)?;
    let dir_path = parent_dir.join(&id);
    fs::create_dir_all(&dir_path).map_err(|e| e.to_string())?;

    let order_idx: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(order_idx), -1) + 1 FROM nodes WHERE parent_id IS ?1",
            rusqlite::params![parent_id],
            |row| row.get(0),
        )
        .unwrap_or(0);

    db::insert_node(conn, &id, "folder", &display_name, parent_id.as_deref(), order_idx, None, None)
        .map_err(|e| e.to_string())?;

    Ok(NodeResponse {
        id,
        node_type: "folder".to_string(),
        name: display_name,
        parent_id,
        order_idx,
        is_archived: false,
        provider: None,
        model: None,
        last_message: None,
    })
}

// ── Rename / Archive / Delete ─────────────────────────────────────────────────

/// Rename a node: updates the SQLite display name and the `.md` file frontmatter (for chats).
#[tauri::command]
pub fn rename_node(
    workspace_root: String,
    id: String,
    new_name: String,
    state: State<'_, DbState>,
) -> Result<(), String> {
    let guard = state.0.lock().unwrap();
    let conn = guard.as_ref().ok_or("No workspace open")?;

    // Update the .md frontmatter for chats
    let node_type: String = conn
        .query_row(
            "SELECT type FROM nodes WHERE id = ?1",
            rusqlite::params![id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    if node_type == "chat" {
        let parent_id: Option<String> = conn
            .query_row(
                "SELECT parent_id FROM nodes WHERE id = ?1",
                rusqlite::params![id],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;

        let dir = node_dir_for_parent(&workspace_root, parent_id.as_deref(), conn)?;
        let file_path = dir.join(format!("{id}.md"));

        if file_path.exists() {
            let raw = fs::read_to_string(&file_path).map_err(|e| e.to_string())?;
            if raw.starts_with("---") {
                if let Some(end) = raw[3..].find("---") {
                    let fm = &raw[3..3 + end];
                    let body = &raw[3 + end + 3..];

                    let mut lines: Vec<String> = Vec::new();
                    let mut has_name = false;
                    for line in fm.lines() {
                        let trimmed = line.trim();
                        if trimmed.is_empty() {
                            continue;
                        }
                        if trimmed.starts_with("name:") {
                            lines.push(format!("name: {new_name}"));
                            has_name = true;
                        } else {
                            lines.push(trimmed.to_string());
                        }
                    }
                    if !has_name {
                        lines.push(format!("name: {new_name}"));
                    }

                    let updated = format!("---\n{}\n---{}", lines.join("\n"), body);
                    fs::write(&file_path, updated).map_err(|e| e.to_string())?;
                }
            }
        }
    }

    db::rename_node(conn, &id, &new_name).map_err(|e| e.to_string())
}

/// Archive a node (hidden from the tree; data is kept on disk).
#[tauri::command]
pub fn archive_node(id: String, state: State<'_, DbState>) -> Result<(), String> {
    let guard = state.0.lock().unwrap();
    let conn = guard.as_ref().ok_or("No workspace open")?;
    db::archive_node(conn, &id).map_err(|e| e.to_string())
}

/// Delete a node: removes the file/folder from disk then deletes the DB row.
/// Child nodes are cascaded by SQLite ON DELETE CASCADE.
#[tauri::command]
pub fn delete_node(
    workspace_root: String,
    id: String,
    state: State<'_, DbState>,
) -> Result<(), String> {
    let guard = state.0.lock().unwrap();
    let conn = guard.as_ref().ok_or("No workspace open")?;

    let node_type: String = conn
        .query_row(
            "SELECT type FROM nodes WHERE id = ?1",
            rusqlite::params![id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    let parent_id: Option<String> = conn
        .query_row(
            "SELECT parent_id FROM nodes WHERE id = ?1",
            rusqlite::params![id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    let dir = node_dir_for_parent(&workspace_root, parent_id.as_deref(), conn)?;

    match node_type.as_str() {
        "chat" => {
            let file = dir.join(format!("{id}.md"));
            if file.exists() {
                fs::remove_file(&file).map_err(|e| e.to_string())?;
            }
        }
        "folder" => {
            let folder = dir.join(&id);
            if folder.exists() {
                fs::remove_dir_all(&folder).map_err(|e| e.to_string())?;
            }
        }
        _ => {}
    }

    db::delete_node(conn, &id).map_err(|e| e.to_string())
}

// ── Read chat file ──────────────────────────────────────────────────────────

#[derive(Debug, serde::Serialize)]
pub struct ChatFileMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, serde::Serialize)]
pub struct ChatFileResponse {
    pub id: String,
    pub name: String,
    pub provider: String,
    pub model: String,
    pub messages: Vec<ChatFileMessage>,
}

/// Read a chat `.md` file and parse its YAML frontmatter + message blocks.
///
/// Message format in the file:
/// ```
/// ## user
/// message content
///
/// ## assistant
/// message content
/// ```
#[tauri::command]
pub fn read_chat_file(
    workspace_root: String,
    chat_id: String,
    state: State<'_, DbState>,
) -> Result<ChatFileResponse, String> {
    let guard = state.0.lock().unwrap();
    let conn = guard.as_ref().ok_or("No workspace open")?;

    // Find parent_id to resolve the directory
    let parent_id: Option<String> = conn
        .query_row(
            "SELECT parent_id FROM nodes WHERE id = ?1",
            rusqlite::params![chat_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    let dir = node_dir_for_parent(&workspace_root, parent_id.as_deref(), conn)?;
    let file_path = dir.join(format!("{chat_id}.md"));
    let raw = fs::read_to_string(&file_path).map_err(|e| e.to_string())?;

    // Parse YAML frontmatter between --- delimiters
    let mut id = String::new();
    let mut name = String::new();
    let mut provider = String::new();
    let mut model = String::new();
    let mut body = raw.as_str();

    if raw.starts_with("---") {
        if let Some(end) = raw[3..].find("---") {
            let fm = &raw[3..3 + end];
            body = &raw[3 + end + 3..];
            for line in fm.lines() {
                let line = line.trim();
                if let Some(val) = line.strip_prefix("id:") {
                    id = val.trim().to_string();
                } else if let Some(val) = line.strip_prefix("name:") {
                    name = val.trim().to_string();
                } else if let Some(val) = line.strip_prefix("provider:") {
                    provider = val.trim().to_string();
                } else if let Some(val) = line.strip_prefix("model:") {
                    model = val.trim().to_string();
                }
            }
        }
    }

    // Parse message blocks: lines starting with "## user" or "## assistant"
    let mut messages: Vec<ChatFileMessage> = Vec::new();
    let mut current_role: Option<String> = None;
    let mut current_content = String::new();

    for line in body.lines() {
        let trimmed = line.trim();
        if trimmed == "## user" || trimmed == "## assistant" || trimmed == "## system" {
            // Flush previous message
            if let Some(role) = current_role.take() {
                let content = current_content.trim().to_string();
                if !content.is_empty() {
                    messages.push(ChatFileMessage { role, content });
                }
            }
            current_role = Some(trimmed[3..].to_string());
            current_content.clear();
        } else if current_role.is_some() {
            current_content.push_str(line);
            current_content.push('\n');
        }
    }
    // Flush last message
    if let Some(role) = current_role {
        let content = current_content.trim().to_string();
        if !content.is_empty() {
            messages.push(ChatFileMessage { role, content });
        }
    }

    if id.is_empty() {
        id = chat_id;
    }

    Ok(ChatFileResponse {
        id,
        name,
        provider,
        model,
        messages,
    })
}

/// Append a message block to the chat `.md` file on disk.
#[tauri::command]
pub fn append_message_to_file(
    workspace_root: String,
    chat_id: String,
    role: String,
    content: String,
    state: State<'_, DbState>,
) -> Result<(), String> {
    let guard = state.0.lock().unwrap();
    let conn = guard.as_ref().ok_or("No workspace open")?;

    let parent_id: Option<String> = conn
        .query_row(
            "SELECT parent_id FROM nodes WHERE id = ?1",
            rusqlite::params![chat_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    let dir = node_dir_for_parent(&workspace_root, parent_id.as_deref(), conn)?;
    let file_path = dir.join(format!("{chat_id}.md"));

    use std::io::Write;
    let mut file = fs::OpenOptions::new()
        .append(true)
        .open(&file_path)
        .map_err(|e| e.to_string())?;

    write!(file, "\n## {role}\n{content}\n").map_err(|e| e.to_string())?;

    Ok(())
}

/// Persist provider/model changes for an existing chat in both file frontmatter and DB.
#[tauri::command]
pub fn update_chat_model_config(
    workspace_root: String,
    chat_id: String,
    provider: String,
    model: String,
    state: State<'_, DbState>,
) -> Result<(), String> {
    let guard = state.0.lock().unwrap();
    let conn = guard.as_ref().ok_or("No workspace open")?;

    let parent_id: Option<String> = conn
        .query_row(
            "SELECT parent_id FROM nodes WHERE id = ?1",
            rusqlite::params![chat_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    let dir = node_dir_for_parent(&workspace_root, parent_id.as_deref(), conn)?;
    let file_path = dir.join(format!("{chat_id}.md"));
    let raw = fs::read_to_string(&file_path).map_err(|e| e.to_string())?;

    if !raw.starts_with("---") {
        return Err("Chat file missing frontmatter".to_string());
    }

    let end = raw[3..]
        .find("---")
        .ok_or("Chat file has invalid frontmatter")?;
    let fm = &raw[3..3 + end];
    let body = &raw[3 + end + 3..];

    let mut lines: Vec<String> = Vec::new();
    let mut has_provider = false;
    let mut has_model = false;
    for line in fm.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if trimmed.starts_with("provider:") {
            lines.push(format!("provider: {provider}"));
            has_provider = true;
        } else if trimmed.starts_with("model:") {
            lines.push(format!("model: {model}"));
            has_model = true;
        } else {
            lines.push(trimmed.to_string());
        }
    }
    if !has_provider {
        lines.push(format!("provider: {provider}"));
    }
    if !has_model {
        lines.push(format!("model: {model}"));
    }

    let updated = format!("---\n{}\n---{}", lines.join("\n"), body);
    fs::write(&file_path, updated).map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE nodes
         SET provider = ?1, model = ?2, updated_at = strftime('%s','now') * 1000
         WHERE id = ?3",
        rusqlite::params![provider, model, chat_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

// ── Session persistence ─────────────────────────────────────────────────────

/// Save session JSON to `<workspace>/.snak/session.json`.
#[tauri::command]
pub fn save_session(workspace_root: String, json: String) -> Result<(), String> {
    let dir = Path::new(&workspace_root).join(".snak");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    fs::write(dir.join("session.json"), json).map_err(|e| e.to_string())
}

/// Load session JSON from `<workspace>/.snak/session.json`. Returns `null` if not found.
#[tauri::command]
pub fn load_session(workspace_root: String) -> Result<Option<String>, String> {
    let file = Path::new(&workspace_root).join(".snak").join("session.json");
    if !file.exists() {
        return Ok(None);
    }
    fs::read_to_string(&file)
        .map(Some)
        .map_err(|e| e.to_string())
}

// ── FTS ──────────────────────────────────────────────────────────────────────

/// Index a message in the FTS table.
#[tauri::command]
pub fn index_message(
    chat_id: String,
    msg_id: String,
    content: String,
    state: State<'_, DbState>,
) -> Result<(), String> {
    let guard = state.0.lock().unwrap();
    let conn = guard.as_ref().ok_or("No workspace open")?;
    db::index_message(conn, &content, &chat_id, &msg_id).map_err(|e| e.to_string())
}

#[derive(Debug, serde::Serialize)]
pub struct SearchResult {
    pub chat_id: String,
    pub msg_id: String,
    pub snippet: String,
}

/// Full-text search across all indexed messages.
#[tauri::command]
pub fn search_messages(
    query: String,
    limit: Option<usize>,
    state: State<'_, DbState>,
) -> Result<Vec<SearchResult>, String> {
    let guard = state.0.lock().unwrap();
    let conn = guard.as_ref().ok_or("No workspace open")?;
    db::search_messages(conn, &query, limit.unwrap_or(20))
        .map(|results| {
            results
                .into_iter()
                .map(|r| SearchResult {
                    chat_id: r.chat_id,
                    msg_id: r.msg_id,
                    snippet: r.snippet,
                })
                .collect()
        })
        .map_err(|e| e.to_string())
}
