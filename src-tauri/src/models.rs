use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Region {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl Default for Region {
    fn default() -> Self {
        Self { x: 0.0, y: 0.0, width: 100.0, height: 100.0 }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Annotation {
    pub id: String,
    pub kind: String,
    pub text: String,
    pub x: f64,
    pub y: f64,
    pub start_ms: u64,
    pub end_ms: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditRecipe {
    pub crop: Region,
    pub zoom: f64,
    pub cursor_highlight: bool,
    pub annotations: Vec<Annotation>,
}

impl Default for EditRecipe {
    fn default() -> Self {
        Self { crop: Region::default(), zoom: 1.0, cursor_highlight: true, annotations: vec![] }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaItem {
    pub id: String,
    pub title: String,
    pub kind: String,
    pub source: String,
    pub media_path: String,
    pub poster_path: Option<String>,
    pub transcript_path: String,
    pub summary_path: String,
    pub duration_ms: u64,
    pub created_at: String,
    pub recipe: EditRecipe,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveCaptureRequest {
    pub bytes: Vec<u8>,
    pub extension: String,
    pub title: String,
    pub kind: String,
    pub source: String,
    pub duration_ms: u64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeCaptureRequest {
    pub title: String,
    pub source: String,
    pub microphone: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportRequest {
    pub id: String,
    pub title: String,
    pub format: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub media_path: String,
    pub poster_path: String,
    pub transcript_path: String,
    pub summary_path: String,
}
