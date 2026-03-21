use tauri_plugin_store::StoreExt;

/// Store API keys in the OS keychain via tauri-plugin-store.
/// Keys are namespaced as `api_key:{provider}`.
#[tauri::command]
pub fn set_api_key(
    app: tauri::AppHandle,
    provider: String,
    api_key: String,
) -> Result<(), String> {
    let store = app.store("keys.bin").map_err(|e| e.to_string())?;
    let key = format!("api_key:{provider}");
    store.set(key, serde_json::Value::String(api_key));
    store.save().map_err(|e| e.to_string())?;
    Ok(())
}

/// Retrieve an API key for the given provider. Returns `None` if not set.
#[tauri::command]
pub fn get_api_key(
    app: tauri::AppHandle,
    provider: String,
) -> Result<Option<String>, String> {
    let store = app.store("keys.bin").map_err(|e| e.to_string())?;
    let key = format!("api_key:{provider}");
    Ok(store.get(key).and_then(|v| v.as_str().map(|s| s.to_string())))
}

/// Delete the API key for a provider.
#[tauri::command]
pub fn delete_api_key(
    app: tauri::AppHandle,
    provider: String,
) -> Result<(), String> {
    let store = app.store("keys.bin").map_err(|e| e.to_string())?;
    let key = format!("api_key:{provider}");
    store.delete(key);
    store.save().map_err(|e| e.to_string())?;
    Ok(())
}
