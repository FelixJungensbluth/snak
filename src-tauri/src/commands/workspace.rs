use std::sync::Mutex;
use tauri::State;

use crate::db;

pub struct DbState(pub Mutex<Option<rusqlite::Connection>>);

#[derive(Debug, serde::Serialize)]
pub struct DbHealthResponse {
    pub ok: bool,
    pub node_count: i64,
}

/// Open (or create) the workspace database at `db_path` and run schema migrations.
#[tauri::command]
pub fn open_workspace(
    db_path: String,
    state: State<'_, DbState>,
) -> Result<(), String> {
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
    Ok(DbHealthResponse {
        ok: true,
        node_count,
    })
}

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

/// Insert a node (chat or folder) into the workspace database.
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
