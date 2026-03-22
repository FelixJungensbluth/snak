use std::collections::HashMap;
use std::sync::Mutex;

pub mod commands;
pub mod db;

use commands::attachments::{extract_pdf_text, read_file_base64, read_file_text, save_attachment};
use commands::keys::{delete_api_key, get_api_key, set_api_key};
use commands::streaming::{abort_stream, auto_title_chat, list_ollama_models, stream_chat, StreamState};
use commands::workspace::{
    append_message_to_file, archive_node, create_chat, create_folder, db_health, delete_node,
    get_saved_workspace, index_message, insert_node, list_nodes, load_session, move_node,
    open_workspace, read_chat_file, reindex_all_chats, rename_node, save_session, save_workspace,
    search_messages, update_chat_model_config, DbState,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .manage(DbState(Mutex::new(None)))
        .manage(StreamState(Mutex::new(HashMap::new())))
        .invoke_handler(tauri::generate_handler![
            // workspace / database
            open_workspace,
            db_health,
            insert_node,
            index_message,
            search_messages,
            reindex_all_chats,
            list_nodes,
            create_chat,
            create_folder,
            rename_node,
            archive_node,
            delete_node,
            move_node,
            read_chat_file,
            append_message_to_file,
            update_chat_model_config,
            get_saved_workspace,
            save_workspace,
            save_session,
            load_session,
            // api keys
            set_api_key,
            get_api_key,
            delete_api_key,
            // streaming
            stream_chat,
            abort_stream,
            auto_title_chat,
            list_ollama_models,
            // attachments
            save_attachment,
            extract_pdf_text,
            read_file_text,
            read_file_base64,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
