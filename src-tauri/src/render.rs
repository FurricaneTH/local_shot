use std::{fs, path::{Path, PathBuf}, process::Command};
use crate::models::{EditRecipe, ExportRequest, ExportResult, MediaItem};

fn pct(value: f64) -> f64 { value.clamp(0.0, 100.0) }

pub fn safe_file_name(value: &str) -> String {
    let mut result = String::with_capacity(value.len());
    for character in value.trim().chars().take(96) {
        if character.is_control() || "<>:\"/\\|?*".contains(character) { result.push('-'); } else { result.push(character); }
    }
    let clean = result.trim_matches('.').trim();
    if clean.is_empty() { "capture".into() } else { clean.into() }
}

pub fn validate_recipe(mut recipe: EditRecipe) -> EditRecipe {
    recipe.crop.x = pct(recipe.crop.x).min(99.0);
    recipe.crop.y = pct(recipe.crop.y).min(99.0);
    recipe.crop.width = recipe.crop.width.clamp(1.0, 100.0 - recipe.crop.x);
    recipe.crop.height = recipe.crop.height.clamp(1.0, 100.0 - recipe.crop.y);
    recipe.zoom = recipe.zoom.clamp(1.0, 4.0);
    recipe.annotations.retain(|note| note.text.chars().count() <= 500 && note.end_ms > note.start_ms);
    recipe.annotations.truncate(100);
    recipe
}

fn filter_graph(recipe: &EditRecipe, scratch: &Path) -> Result<String, String> {
    let crop = &recipe.crop;
    let mut filters = vec![format!("crop=iw*{:.4}/100:ih*{:.4}/100:iw*{:.4}/100:ih*{:.4}/100", crop.width, crop.height, crop.x, crop.y)];
    if recipe.zoom > 1.001 {
        filters.push(format!("scale=iw*{0:.3}:ih*{0:.3},crop=iw/{0:.3}:ih/{0:.3}:(iw-iw/{0:.3})/2:(ih-ih/{0:.3})/2", recipe.zoom));
    }
    for (index, note) in recipe.annotations.iter().enumerate() {
        let start = note.start_ms as f64 / 1000.0;
        let end = note.end_ms as f64 / 1000.0;
        if note.kind == "spotlight" {
            filters.push(format!("drawbox=x=iw*{:.4}/100-22:y=ih*{:.4}/100-22:w=44:h=44:color=#d8ff61@0.75:t=4:enable='between(t,{:.3},{:.3})'", pct(note.x), pct(note.y), start, end));
        } else {
            let text_path = scratch.join(format!("annotation-{index}.txt"));
            fs::write(&text_path, &note.text).map_err(|error| error.to_string())?;
            let escaped = text_path.to_string_lossy().replace('\\', "\\\\").replace(':', "\\:").replace('\'', "\\'");
            filters.push(format!("drawtext=textfile='{escaped}':x=iw*{:.4}/100:y=ih*{:.4}/100:fontsize=28:fontcolor=black:box=1:boxcolor=#d8ff61@0.95:boxborderw=12:enable='between(t,{:.3},{:.3})'", pct(note.x), pct(note.y), start, end));
        }
    }
    filters.push("scale=trunc(iw/2)*2:trunc(ih/2)*2".into());
    Ok(filters.join(","))
}

fn command_failure(output: std::process::Output) -> String {
    let message = String::from_utf8_lossy(&output.stderr);
    let tail = message.lines().rev().take(8).collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>().join("\n");
    format!("ffmpeg render failed.\n{tail}")
}

pub fn poster(ffmpeg: &str, source: &Path, destination: &Path) -> Result<(), String> {
    let output = Command::new(ffmpeg).args(["-hide_banner", "-loglevel", "error", "-y", "-ss", "0.5", "-i"])
        .arg(source).args(["-frames:v", "1", "-q:v", "2"]).arg(destination).output()
        .map_err(|_| format!("ffmpeg was not found: '{ffmpeg}'. Check FFMPEG_BIN in .env."))?;
    if output.status.success() { Ok(()) } else { Err(command_failure(output)) }
}

pub fn export(ffmpeg: &str, exports: &Path, item: &MediaItem, request: &ExportRequest) -> Result<ExportResult, String> {
    let recipe = validate_recipe(item.recipe.clone());
    fs::create_dir_all(exports).map_err(|error| error.to_string())?;
    let stem = format!("{}-{}", safe_file_name(&request.title), chrono::Local::now().format("%Y%m%d-%H%M%S"));
    let extension = match request.format.as_str() { "h264" => "mp4", "webm" => "webm", _ => return Err("Export format must be h264 or webm.".into()) };
    let destination = exports.join(format!("{stem}.{extension}"));
    let scratch = exports.join(format!(".{stem}-render"));
    fs::create_dir_all(&scratch).map_err(|error| error.to_string())?;
    let filters = filter_graph(&recipe, &scratch)?;
    let mut command = Command::new(ffmpeg);
    command.args(["-hide_banner", "-loglevel", "error", "-y"]);
    if item.kind == "screenshot" { command.args(["-loop", "1", "-t", "5"]); }
    command.arg("-i").arg(&item.media_path).args(["-vf", &filters, "-map", "0:v:0", "-map", "0:a?"]);
    if request.format == "h264" {
        command.args(["-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart"]);
    } else {
        command.args(["-c:v", "libvpx-vp9", "-crf", "30", "-b:v", "0", "-row-mt", "1", "-c:a", "libopus", "-b:a", "128k"]);
    }
    let output = command.arg(&destination).output().map_err(|_| format!("ffmpeg was not found: '{ffmpeg}'. Check FFMPEG_BIN in .env."))?;
    let _ = fs::remove_dir_all(&scratch);
    if !output.status.success() { return Err(command_failure(output)); }
    let poster_path = exports.join(format!("{stem}.poster.jpg"));
    poster(ffmpeg, &destination, &poster_path)?;
    let transcript_path = exports.join(format!("{stem}.transcript.txt"));
    let summary_path = exports.join(format!("{stem}.summary.md"));
    fs::copy(&item.transcript_path, &transcript_path).map_err(|error| error.to_string())?;
    let mut summary = format!("# {}\n\n- Source: `{}`\n- Duration: {:.1} seconds\n- Export: {}\n\n## Key moments\n", request.title, item.media_path, item.duration_ms as f64 / 1000.0, request.format);
    if recipe.annotations.is_empty() { summary.push_str("\nNo notes added yet.\n"); }
    for note in &recipe.annotations { summary.push_str(&format!("\n- `{}` — {}\n", note.start_ms / 1000, note.text)); }
    fs::write(&summary_path, summary).map_err(|error| error.to_string())?;
    Ok(ExportResult { media_path: path_string(destination), poster_path: path_string(poster_path), transcript_path: path_string(transcript_path), summary_path: path_string(summary_path) })
}

pub fn path_string(path: PathBuf) -> String { path.to_string_lossy().into_owned() }

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{Region, Annotation};

    #[test]
    fn sanitizes_file_names() {
        assert_eq!(safe_file_name(" ../release:demo?.mp4 "), "-release-demo-.mp4");
        assert_eq!(safe_file_name("..."), "capture");
    }

    #[test]
    fn clamps_transform_recipe() {
        let recipe = EditRecipe { crop: Region { x: -2.0, y: 98.0, width: 200.0, height: 0.0 }, zoom: 8.0, cursor_highlight: true, annotations: vec![] };
        let valid = validate_recipe(recipe);
        assert_eq!(valid.crop.x, 0.0);
        assert_eq!(valid.crop.height, 1.0);
        assert_eq!(valid.zoom, 4.0);
    }

    #[test]
    fn renders_h264_and_webm_with_transform_and_sidecars_when_ffmpeg_is_available() {
        let ffmpeg = std::env::var("FFMPEG_BIN").unwrap_or_else(|_| "ffmpeg".into());
        if Command::new(&ffmpeg).arg("-version").output().is_err() {
            eprintln!("ffmpeg is unavailable; render integration test skipped");
            return;
        }
        let root = std::env::temp_dir().join(format!("localcut-render-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let input = root.join("input.mp4");
        let generated = Command::new(&ffmpeg).args([
            "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=#304055:s=320x240:d=1",
            "-c:v", "libx264", "-pix_fmt", "yuv420p"
        ]).arg(&input).status().unwrap();
        assert!(generated.success());
        let transcript = root.join("input.transcript.txt");
        fs::write(&transcript, "00:00 LocalCut test transcript\n").unwrap();
        let summary = root.join("input.summary.md");
        fs::write(&summary, "# Input\n").unwrap();
        let item = MediaItem {
            id: "render-test".into(), title: "Input".into(), kind: "video".into(), source: "screen".into(),
            media_path: path_string(input), poster_path: None, transcript_path: path_string(transcript), summary_path: path_string(summary),
            duration_ms: 1000, created_at: chrono::Utc::now().to_rfc3339(),
            recipe: EditRecipe {
                crop: Region { x: 5.0, y: 5.0, width: 90.0, height: 90.0 }, zoom: 1.2, cursor_highlight: true,
                annotations: vec![Annotation { id: "note".into(), kind: "spotlight".into(), text: "Focus".into(), x: 50.0, y: 50.0, start_ms: 0, end_ms: 900 }]
            }
        };
        for format in ["h264", "webm"] {
            let request = ExportRequest { id: item.id.clone(), title: format!("Safe demo {format}"), format: format.into() };
            let result = export(&ffmpeg, &root.join("exports"), &item, &request).unwrap();
            assert!(Path::new(&result.media_path).exists());
            assert!(Path::new(&result.poster_path).exists());
            assert!(Path::new(&result.transcript_path).exists());
            assert!(Path::new(&result.summary_path).exists());
        }
        fs::remove_dir_all(root).unwrap();
    }
}
