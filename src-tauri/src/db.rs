use rusqlite::{Connection, Result, params};

pub struct NodeRow {
    pub id: String,
    pub node_type: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub order_idx: i64,
    pub is_archived: bool,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub last_message: Option<String>,
}

/// Run all schema migrations on the given connection.
/// Safe to call multiple times (idempotent via IF NOT EXISTS).
pub fn run_migrations(conn: &Connection) -> Result<()> {
    conn.execute_batch("PRAGMA journal_mode=WAL;")?;

    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS nodes (
            id          TEXT    PRIMARY KEY NOT NULL,
            type        TEXT    NOT NULL CHECK(type IN ('chat','folder')),
            name        TEXT    NOT NULL,
            parent_id   TEXT    REFERENCES nodes(id) ON DELETE CASCADE,
            order_idx   INTEGER NOT NULL DEFAULT 0,
            is_archived INTEGER NOT NULL DEFAULT 0 CHECK(is_archived IN (0,1)),
            provider    TEXT,
            model       TEXT,
            last_message TEXT,
            created_at  INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
            updated_at  INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
        );",
    )?;

    // FTS5 virtual table with Porter stemming for full-text search over messages
    conn.execute_batch(
        "CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
            content,
            chat_id UNINDEXED,
            msg_id  UNINDEXED,
            tokenize = 'porter ascii'
        );",
    )?;

    Ok(())
}

/// Open (or create) the workspace SQLite database at the given path and run migrations.
pub fn open_workspace_db(db_path: &str) -> Result<Connection> {
    let conn = Connection::open(db_path)?;
    run_migrations(&conn)?;
    Ok(conn)
}

/// Insert a node into the nodes table.
pub fn insert_node(
    conn: &Connection,
    id: &str,
    node_type: &str,
    name: &str,
    parent_id: Option<&str>,
    order_idx: i64,
    provider: Option<&str>,
    model: Option<&str>,
) -> Result<()> {
    conn.execute(
        "INSERT INTO nodes (id, type, name, parent_id, order_idx, provider, model)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![id, node_type, name, parent_id, order_idx, provider, model],
    )?;
    Ok(())
}

/// Update the last_message preview for a chat node.
pub fn update_last_message(conn: &Connection, chat_id: &str, preview: &str) -> Result<()> {
    conn.execute(
        "UPDATE nodes SET last_message = ?1, updated_at = strftime('%s','now') * 1000
         WHERE id = ?2",
        params![preview, chat_id],
    )?;
    Ok(())
}

/// Insert a message into the FTS index.
pub fn index_message(
    conn: &Connection,
    content: &str,
    chat_id: &str,
    msg_id: &str,
) -> Result<()> {
    conn.execute(
        "INSERT INTO messages_fts (content, chat_id, msg_id) VALUES (?1, ?2, ?3)",
        params![content, chat_id, msg_id],
    )?;
    Ok(())
}

/// List all non-archived nodes ordered by parent_id / order_idx.
pub fn list_nodes(conn: &Connection) -> Result<Vec<NodeRow>> {
    let mut stmt = conn.prepare(
        "SELECT id, type, name, parent_id, order_idx, is_archived, provider, model, last_message
         FROM nodes
         WHERE is_archived = 0
         ORDER BY parent_id NULLS FIRST, order_idx ASC, name ASC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(NodeRow {
            id: row.get(0)?,
            node_type: row.get(1)?,
            name: row.get(2)?,
            parent_id: row.get(3)?,
            order_idx: row.get(4)?,
            is_archived: row.get::<_, i64>(5)? != 0,
            provider: row.get(6)?,
            model: row.get(7)?,
            last_message: row.get(8)?,
        })
    })?;
    rows.collect()
}

/// Rename a node and update its updated_at timestamp.
pub fn rename_node(conn: &Connection, id: &str, new_name: &str) -> Result<()> {
    conn.execute(
        "UPDATE nodes SET name = ?1, updated_at = strftime('%s','now') * 1000 WHERE id = ?2",
        params![new_name, id],
    )?;
    Ok(())
}

/// Archive a node (set is_archived = 1).
pub fn archive_node(conn: &Connection, id: &str) -> Result<()> {
    conn.execute(
        "UPDATE nodes SET is_archived = 1, updated_at = strftime('%s','now') * 1000 WHERE id = ?1",
        params![id],
    )?;
    Ok(())
}

/// Delete a node row. Due to ON DELETE CASCADE, child nodes are also removed.
pub fn delete_node(conn: &Connection, id: &str) -> Result<()> {
    conn.execute("DELETE FROM nodes WHERE id = ?1", params![id])?;
    Ok(())
}

/// Move a node: update its parent_id and order_idx.
pub fn move_node(
    conn: &Connection,
    id: &str,
    new_parent_id: Option<&str>,
    new_order_idx: i64,
) -> Result<()> {
    conn.execute(
        "UPDATE nodes SET parent_id = ?1, order_idx = ?2, updated_at = strftime('%s','now') * 1000
         WHERE id = ?3",
        params![new_parent_id, new_order_idx, id],
    )?;
    Ok(())
}

/// Bulk-update order_idx for a list of node IDs (in order).
pub fn reorder_siblings(conn: &Connection, ids: &[String]) -> Result<()> {
    let mut stmt = conn.prepare(
        "UPDATE nodes SET order_idx = ?1, updated_at = strftime('%s','now') * 1000 WHERE id = ?2",
    )?;
    for (idx, id) in ids.iter().enumerate() {
        stmt.execute(params![idx as i64, id])?;
    }
    Ok(())
}

pub struct FtsResult {
    pub chat_id: String,
    pub msg_id: String,
    pub snippet: String,
}

/// Full-text search over messages. Returns up to `limit` results.
pub fn search_messages(
    conn: &Connection,
    query: &str,
    limit: usize,
) -> Result<Vec<FtsResult>> {
    // Sanitize: strip FTS5 special chars, split into tokens, add prefix '*' to last token
    let tokens: Vec<String> = query
        .split_whitespace()
        .map(|t| {
            t.chars()
                .filter(|c| c.is_alphanumeric() || *c == '_')
                .collect::<String>()
        })
        .filter(|t| !t.is_empty())
        .collect();

    if tokens.is_empty() {
        return Ok(vec![]);
    }

    // Build FTS5 query: exact tokens + prefix on last token for as-you-type feel
    let fts_query = if tokens.len() == 1 {
        format!("\"{}\"*", tokens[0])
    } else {
        let last = tokens.len() - 1;
        tokens
            .iter()
            .enumerate()
            .map(|(i, t)| if i == last { format!("\"{}\"*", t) } else { format!("\"{}\"", t) })
            .collect::<Vec<_>>()
            .join(" ")
    };

    let mut stmt = conn.prepare(
        "SELECT chat_id, msg_id,
                snippet(messages_fts, 0, '<mark>', '</mark>', '…', 20) AS snippet
         FROM messages_fts
         WHERE content MATCH ?1
         ORDER BY rank
         LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![fts_query, limit as i64], |row| {
        Ok(FtsResult {
            chat_id: row.get(0)?,
            msg_id: row.get(1)?,
            snippet: row.get(2)?,
        })
    })?;
    rows.collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn in_memory_db() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory DB");
        run_migrations(&conn).expect("migrations");
        conn
    }

    #[test]
    fn test_insert_and_query_node() {
        let conn = in_memory_db();

        insert_node(&conn, "node-1", "chat", "My Chat", None, 0, Some("anthropic"), Some("claude-sonnet-4-6"))
            .expect("insert node");

        let (id, name, node_type): (String, String, String) = conn
            .query_row(
                "SELECT id, name, type FROM nodes WHERE id = 'node-1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("query node");

        assert_eq!(id, "node-1");
        assert_eq!(name, "My Chat");
        assert_eq!(node_type, "chat");
    }

    #[test]
    fn test_insert_folder_with_child() {
        let conn = in_memory_db();

        insert_node(&conn, "folder-1", "folder", "Work", None, 0, None, None)
            .expect("insert folder");
        insert_node(&conn, "chat-1", "chat", "Project Alpha", Some("folder-1"), 0, Some("openai"), Some("gpt-4o"))
            .expect("insert child chat");

        let parent_id: Option<String> = conn
            .query_row(
                "SELECT parent_id FROM nodes WHERE id = 'chat-1'",
                [],
                |row| row.get(0),
            )
            .expect("query child");

        assert_eq!(parent_id, Some("folder-1".to_string()));
    }

    #[test]
    fn test_ordering() {
        let conn = in_memory_db();

        insert_node(&conn, "c", "chat", "C", None, 2, None, None).expect("c");
        insert_node(&conn, "a", "chat", "A", None, 0, None, None).expect("a");
        insert_node(&conn, "b", "chat", "B", None, 1, None, None).expect("b");

        let mut stmt = conn
            .prepare("SELECT id FROM nodes ORDER BY order_idx ASC")
            .unwrap();
        let ids: Vec<String> = stmt
            .query_map([], |row| row.get(0))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();

        assert_eq!(ids, vec!["a", "b", "c"]);
    }

    #[test]
    fn test_archive_node() {
        let conn = in_memory_db();

        insert_node(&conn, "chat-arc", "chat", "Old Chat", None, 0, None, None)
            .expect("insert");
        conn.execute(
            "UPDATE nodes SET is_archived = 1 WHERE id = 'chat-arc'",
            [],
        )
        .expect("archive");

        let is_archived: i64 = conn
            .query_row(
                "SELECT is_archived FROM nodes WHERE id = 'chat-arc'",
                [],
                |row| row.get(0),
            )
            .expect("query");

        assert_eq!(is_archived, 1);
    }

    #[test]
    fn test_fts_insert_and_search() {
        let conn = in_memory_db();

        insert_node(&conn, "chat-fts", "chat", "FTS Chat", None, 0, None, None)
            .expect("insert chat");
        index_message(&conn, "The quick brown fox jumps over the lazy dog", "chat-fts", "msg-1")
            .expect("index msg 1");
        index_message(&conn, "Laziness is a virtue in programming", "chat-fts", "msg-2")
            .expect("index msg 2");
        index_message(&conn, "Rust makes systems programming safe and fast", "chat-fts", "msg-3")
            .expect("index msg 3");

        let results = search_messages(&conn, "jump", 10).expect("search");
        assert!(!results.is_empty(), "expected FTS results for 'jump'");
        assert_eq!(results[0].msg_id, "msg-1");

        let lazy_results = search_messages(&conn, "lazy", 10).expect("search lazy");
        assert!(lazy_results.len() >= 1, "expected results for 'lazy'");

        let none = search_messages(&conn, "zzzyyyxxx", 10).expect("search none");
        assert!(none.is_empty());
    }

    #[test]
    fn test_move_node_to_new_parent() {
        let conn = in_memory_db();

        insert_node(&conn, "folder-a", "folder", "Folder A", None, 0, None, None).expect("fa");
        insert_node(&conn, "folder-b", "folder", "Folder B", None, 1, None, None).expect("fb");
        insert_node(&conn, "chat-mv", "chat", "Moveable Chat", Some("folder-a"), 0, None, None)
            .expect("chat");

        conn.execute(
            "UPDATE nodes SET parent_id = 'folder-b' WHERE id = 'chat-mv'",
            [],
        )
        .expect("move");

        let parent: Option<String> = conn
            .query_row(
                "SELECT parent_id FROM nodes WHERE id = 'chat-mv'",
                [],
                |row| row.get(0),
            )
            .expect("query after move");

        assert_eq!(parent, Some("folder-b".to_string()));
    }
}
