use std::fs;
use std::path::Path;

use tauri::State;
use uuid::Uuid;

use super::workspace::{DbState, NodeResponse};
use crate::db;

/// Extract an ArXiv paper ID from various URL formats.
/// Supports: arxiv.org/abs/XXXX.XXXXX, arxiv.org/pdf/XXXX.XXXXX,
/// with or without version suffix (e.g. v1, v2).
fn parse_arxiv_id(url: &str) -> Option<String> {
    let url = url.trim();

    // Try to extract from URL patterns
    for prefix in &[
        "https://arxiv.org/abs/",
        "http://arxiv.org/abs/",
        "https://arxiv.org/pdf/",
        "http://arxiv.org/pdf/",
        "arxiv.org/abs/",
        "arxiv.org/pdf/",
    ] {
        if let Some(rest) = url.strip_prefix(prefix) {
            // Strip .pdf suffix and version suffix for the ID
            let id = rest.trim_end_matches(".pdf");
            if !id.is_empty() {
                return Some(id.to_string());
            }
        }
    }

    // Also accept bare arxiv IDs like "2301.07041" or "2301.07041v1"
    if url.chars().next().map_or(false, |c| c.is_ascii_digit()) && url.contains('.') && !url.contains('/') {
        return Some(url.to_string());
    }

    None
}

fn pdf_download_url(arxiv_id: &str) -> String {
    format!("https://arxiv.org/pdf/{arxiv_id}.pdf")
}

fn imported_file_dir(workspace_root: &str, node_id: &str) -> std::path::PathBuf {
    Path::new(workspace_root)
        .join(".snak")
        .join("files")
        .join(node_id)
}

fn relative_workspace_path(workspace_root: &str, abs_path: &Path) -> Result<String, String> {
    abs_path
        .strip_prefix(workspace_root)
        .map_err(|_| "Path is outside of the workspace".to_string())
        .map(|path| path.to_string_lossy().replace('\\', "/"))
}

fn node_dir_for_parent(
    _workspace_root: &str,
    parent_id: Option<&str>,
    conn: &rusqlite::Connection,
) -> Result<(), String> {
    if let Some(pid) = parent_id {
        let node_type: String = conn
            .query_row(
                "SELECT node_type FROM nodes WHERE id = ?1 AND is_archived = 0",
                [pid],
                |row| row.get(0),
            )
            .map_err(|_| format!("Parent node not found: {pid}"))?;
        if node_type != "folder" {
            return Err(format!("Parent node {pid} is not a folder"));
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn import_arxiv(
    workspace_root: String,
    parent_id: Option<String>,
    arxiv_url: String,
    state: State<'_, DbState>,
) -> Result<NodeResponse, String> {
    let arxiv_id = parse_arxiv_id(&arxiv_url)
        .ok_or_else(|| format!("Could not parse ArXiv ID from: {arxiv_url}"))?;

    let download_url = pdf_download_url(&arxiv_id);

    // Download the PDF
    let client = reqwest::Client::new();
    let response = client
        .get(&download_url)
        .send()
        .await
        .map_err(|e| format!("Failed to download ArXiv paper: {e}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "ArXiv returned status {}: {}",
            response.status(),
            download_url
        ));
    }

    let pdf_bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read response body: {e}"))?;

    // Now do the DB/filesystem work synchronously
    let guard = state.0.lock().unwrap();
    let conn = guard.as_ref().ok_or("No workspace open")?;

    let _ = node_dir_for_parent(&workspace_root, parent_id.as_deref(), conn)?;

    let id = Uuid::new_v4().to_string();
    let display_name = format!("{arxiv_id}.pdf");

    let dest_dir = imported_file_dir(&workspace_root, &id);
    fs::create_dir_all(&dest_dir).map_err(|e| e.to_string())?;
    let dest_path = dest_dir.join(&display_name);
    fs::write(&dest_path, &pdf_bytes).map_err(|e| e.to_string())?;

    let rel_path = relative_workspace_path(&workspace_root, &dest_path)?;
    let file_size = pdf_bytes.len() as i64;
    let mime_type = "application/pdf".to_string();

    let order_idx: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(order_idx), -1) + 1 FROM nodes WHERE parent_id IS ?1",
            rusqlite::params![parent_id],
            |row| row.get(0),
        )
        .unwrap_or(0);

    db::insert_node(
        conn,
        &id,
        "file",
        &display_name,
        parent_id.as_deref(),
        order_idx,
        None,
        None,
        Some(&rel_path),
        Some(&mime_type),
        Some(file_size),
    )
    .map_err(|e| e.to_string())?;

    Ok(NodeResponse {
        id,
        node_type: "file".to_string(),
        name: display_name,
        parent_id,
        order_idx,
        is_archived: false,
        provider: None,
        model: None,
        last_message: None,
        file_path: Some(rel_path),
        mime_type: Some(mime_type),
        file_size: Some(file_size),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_arxiv_id() {
        assert_eq!(parse_arxiv_id("https://arxiv.org/abs/2301.07041"), Some("2301.07041".into()));
        assert_eq!(parse_arxiv_id("https://arxiv.org/abs/2301.07041v1"), Some("2301.07041v1".into()));
        assert_eq!(parse_arxiv_id("https://arxiv.org/pdf/2301.07041"), Some("2301.07041".into()));
        assert_eq!(parse_arxiv_id("https://arxiv.org/pdf/2301.07041.pdf"), Some("2301.07041".into()));
        assert_eq!(parse_arxiv_id("2301.07041"), Some("2301.07041".into()));
        assert_eq!(parse_arxiv_id("not a url"), None);
    }
}
