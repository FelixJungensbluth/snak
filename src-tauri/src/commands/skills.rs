use serde::Serialize;
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Serialize, Clone)]
pub struct Skill {
    pub name: String,
    pub content: String,
}

fn skills_dir(workspace_root: &str) -> PathBuf {
    PathBuf::from(workspace_root).join(".snak").join("skills")
}

#[tauri::command]
pub fn list_skills(workspace_root: String) -> Result<Vec<Skill>, String> {
    let dir = skills_dir(&workspace_root);
    if !dir.exists() {
        return Ok(vec![]);
    }

    let mut skills = Vec::new();
    let entries = fs::read_dir(&dir).map_err(|e| format!("Failed to read skills directory: {e}"))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("md") {
            let name = path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_string();
            if name.is_empty() {
                continue;
            }
            match fs::read_to_string(&path) {
                Ok(content) => skills.push(Skill { name, content }),
                Err(e) => eprintln!("Failed to read skill file {:?}: {e}", path),
            }
        }
    }

    skills.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(skills)
}

#[tauri::command]
pub fn save_skill(workspace_root: String, name: String, content: String) -> Result<(), String> {
    let dir = skills_dir(&workspace_root);
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create skills directory: {e}"))?;

    let path = dir.join(format!("{name}.md"));
    fs::write(&path, content).map_err(|e| format!("Failed to write skill file: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn delete_skill(workspace_root: String, name: String) -> Result<(), String> {
    let path = skills_dir(&workspace_root).join(format!("{name}.md"));
    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("Failed to delete skill file: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
pub fn ensure_default_skills(workspace_root: String) -> Result<(), String> {
    let dir = skills_dir(&workspace_root);
    if dir.exists() {
        return Ok(());
    }

    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create skills directory: {e}"))?;

    let defaults = vec![
        ("review", "You are a thorough code/text reviewer. Analyze the provided content and give structured feedback:\n\n1. **Summary** — Brief overview of what you reviewed\n2. **Strengths** — What works well\n3. **Issues** — Problems, bugs, or concerns (ranked by severity)\n4. **Suggestions** — Concrete improvements\n\nBe specific, cite line numbers or quotes where relevant. Be constructive."),
        ("summarize", "Summarize the provided content concisely. Structure your summary as:\n\n1. **TL;DR** — One sentence summary\n2. **Key Points** — Bullet list of the most important points\n3. **Details** — Brief elaboration on anything that needs context\n\nKeep it short and actionable."),
        ("explain", "Explain the provided content in a clear, accessible way. Assume the reader is intelligent but unfamiliar with the specifics. Use analogies where helpful. Structure your explanation from high-level concepts down to details."),
        ("improve", "Analyze the provided content and suggest improvements. Focus on:\n\n1. **Clarity** — Is the message/code clear?\n2. **Correctness** — Are there errors or inaccuracies?\n3. **Style** — Does it follow best practices?\n4. **Efficiency** — Can it be simplified or optimized?\n\nProvide the improved version along with explanations of what changed and why."),
    ];

    for (name, content) in defaults {
        let path = dir.join(format!("{name}.md"));
        fs::write(&path, content).map_err(|e| format!("Failed to write default skill: {e}"))?;
    }

    Ok(())
}
