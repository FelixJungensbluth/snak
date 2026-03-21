use std::sync::Mutex;

pub mod commands;
pub mod db;

use commands::keys::{delete_api_key, get_api_key, set_api_key};
use commands::workspace::{db_health, index_message, insert_node, open_workspace, search_messages, DbState};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(DbState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            open_workspace,
            db_health,
            insert_node,
            index_message,
            search_messages,
            set_api_key,
            get_api_key,
            delete_api_key,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
