use std::path::Path;
use rusqlite::{params, Connection};
use crate::models::{EditRecipe, MediaItem};

pub fn migrate(path: &Path) -> Result<(), String> {
    let connection = Connection::open(path).map_err(|error| error.to_string())?;
    connection.execute_batch(
        "PRAGMA journal_mode=WAL;
         PRAGMA foreign_keys=ON;
         CREATE TABLE IF NOT EXISTS media (
           id TEXT PRIMARY KEY,
           title TEXT NOT NULL,
           kind TEXT NOT NULL CHECK(kind IN ('video','screenshot')),
           source TEXT NOT NULL CHECK(source IN ('screen','window','region')),
           media_path TEXT NOT NULL UNIQUE,
           poster_path TEXT,
           transcript_path TEXT NOT NULL,
           summary_path TEXT NOT NULL,
           duration_ms INTEGER NOT NULL DEFAULT 0,
           created_at TEXT NOT NULL,
           recipe_json TEXT NOT NULL
         );
         CREATE INDEX IF NOT EXISTS media_created_at ON media(created_at DESC);"
    ).map_err(|error| error.to_string())?;
    Ok(())
}

pub fn insert(path: &Path, item: &MediaItem) -> Result<(), String> {
    let connection = Connection::open(path).map_err(|error| error.to_string())?;
    let recipe = serde_json::to_string(&item.recipe).map_err(|error| error.to_string())?;
    connection.execute(
        "INSERT INTO media (id,title,kind,source,media_path,poster_path,transcript_path,summary_path,duration_ms,created_at,recipe_json)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
        params![item.id, item.title, item.kind, item.source, item.media_path, item.poster_path, item.transcript_path, item.summary_path, item.duration_ms, item.created_at, recipe]
    ).map_err(|error| error.to_string())?;
    Ok(())
}

pub fn list(path: &Path) -> Result<Vec<MediaItem>, String> {
    let connection = Connection::open(path).map_err(|error| error.to_string())?;
    let mut statement = connection.prepare(
        "SELECT id,title,kind,source,media_path,poster_path,transcript_path,summary_path,duration_ms,created_at,recipe_json FROM media ORDER BY created_at DESC"
    ).map_err(|error| error.to_string())?;
    let rows = statement.query_map([], |row| {
        let json: String = row.get(10)?;
        let recipe = serde_json::from_str(&json).unwrap_or_default();
        Ok(MediaItem {
            id: row.get(0)?, title: row.get(1)?, kind: row.get(2)?, source: row.get(3)?, media_path: row.get(4)?,
            poster_path: row.get(5)?, transcript_path: row.get(6)?, summary_path: row.get(7)?, duration_ms: row.get(8)?,
            created_at: row.get(9)?, recipe
        })
    }).map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|error| error.to_string())
}

pub fn get(path: &Path, id: &str) -> Result<MediaItem, String> {
    list(path)?.into_iter().find(|item| item.id == id).ok_or_else(|| "Kayıt bulunamadı.".to_string())
}

pub fn update_recipe(path: &Path, id: &str, title: &str, recipe: &EditRecipe) -> Result<(), String> {
    let connection = Connection::open(path).map_err(|error| error.to_string())?;
    let json = serde_json::to_string(recipe).map_err(|error| error.to_string())?;
    let changed = connection.execute("UPDATE media SET title=?1, recipe_json=?2 WHERE id=?3", params![title, json, id]).map_err(|error| error.to_string())?;
    if changed == 0 { return Err("Kayıt bulunamadı.".into()); }
    Ok(())
}

