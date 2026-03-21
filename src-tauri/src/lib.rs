use std::sync::Mutex;

pub mod commands;
pub mod db;

use commands::keys::{delete_api_key, get_api_key, set_api_key};
use commands::workspace::{
    archive_node, create_chat, create_folder, db_health, delete_node, get_saved_workspace,
    index_message, insert_node, list_nodes, open_workspace, rename_node, save_workspace,
    search_messages, DbState,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(DbState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            open_workspace,
            db_health,
            insert_node,
            index_message,
            search_messages,
            list_nodes,
            create_chat,
            create_folder,
            rename_node,
            archive_node,
            delete_node,
            get_saved_workspace,
            save_workspace,
            set_api_key,
            get_api_key,
            delete_api_key,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
