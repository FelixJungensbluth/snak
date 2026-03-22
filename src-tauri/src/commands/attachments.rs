use std::fs;
use std::path::Path;

/// Copy a file into `.snak/attachments/{chat_id}/` and return the relative path
/// (relative to workspace root) so it can be stored in the `.md` file.
#[tauri::command]
pub fn save_attachment(
    workspace_root: String,
    chat_id: String,
    source_path: String,
) -> Result<String, String> {
    let src = Path::new(&source_path);
    if !src.exists() {
        return Err(format!("Source file not found: {source_path}"));
    }

    let filename = src
        .file_name()
        .ok_or("Invalid source file name")?
        .to_string_lossy()
        .to_string();

    let dest_dir = Path::new(&workspace_root)
        .join(".snak")
        .join("attachments")
        .join(&chat_id);
    fs::create_dir_all(&dest_dir).map_err(|e| e.to_string())?;

    // Avoid name collisions by prepending a timestamp
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let dest_name = format!("{ts}-{filename}");
    let dest_path = dest_dir.join(&dest_name);

    fs::copy(src, &dest_path).map_err(|e| e.to_string())?;

    // Return path relative to workspace root
    let rel = format!(".snak/attachments/{chat_id}/{dest_name}");
    Ok(rel)
}

/// Extract text from a PDF file using pdf-extract.
#[tauri::command]
pub fn extract_pdf_text(file_path: String) -> Result<String, String> {
    let bytes = fs::read(&file_path).map_err(|e| format!("Failed to read PDF: {e}"))?;
    let text = pdf_extract::extract_text_from_mem(&bytes)
        .map_err(|e| format!("Failed to extract PDF text: {e}"))?;
    Ok(text)
}

/// Read a text file and return its contents (used for .md attachments).
#[tauri::command]
pub fn read_file_text(file_path: String) -> Result<String, String> {
    fs::read_to_string(&file_path).map_err(|e| format!("Failed to read file: {e}"))
}

/// Read a file and return its base64-encoded contents + detected MIME type.
#[tauri::command]
pub fn read_file_base64(file_path: String) -> Result<(String, String), String> {
    use base64::Engine;

    let path = Path::new(&file_path);
    let bytes = fs::read(path).map_err(|e| format!("Failed to read file: {e}"))?;

    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    let mime = match ext.as_str() {
        "pdf" => "application/pdf",
        "md" | "markdown" | "mdx" => "text/markdown",
        "txt" | "log" | "csv" | "tsv" => "text/plain",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        _ => "application/octet-stream",
    };

    let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok((encoded, mime.to_string()))
}
