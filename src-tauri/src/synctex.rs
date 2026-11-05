use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use flate2::read::GzDecoder;

use crate::error::{AppError, AppResult};
use crate::models::{SyncSource, SyncStatus, SyncTarget};
use crate::state::project_last_synctex_path;

/// SyncTeX stores horizontal/vertical coordinates in TeX scaled points.
const SP_TO_PT: f64 = 72.27 / 72.0 / 65536.0;
const MAX_REVERSE_DISTANCE_PT: f64 = 24.0;

#[derive(Debug, Clone)]
pub struct SyncEntry {
    pub file: String,
    pub line: u32,
    pub page: u32,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone)]
pub struct SyncData {
    pub entries: Vec<SyncEntry>,
    pub page_count: u32,
}

fn plain_path(root: &Path) -> PathBuf {
    root.join(".latexstudio").join("last-success.synctex")
}

fn existing_path(root: &Path) -> Option<PathBuf> {
    let gz = project_last_synctex_path(root);
    if gz.is_file() {
        return Some(gz);
    }
    let plain = plain_path(root);
    if plain.is_file() {
        return Some(plain);
    }
    None
}

fn modified_ms(meta: &fs::Metadata) -> i64 {
    meta.modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

fn read_text(path: &Path) -> AppResult<String> {
    let bytes = fs::read(path).map_err(|error| {
        AppError::new(
            "synctex_read_failed",
            format!("SyncTeX data could not be read: {error}"),
        )
    })?;
    if path
        .extension()
        .map(|extension| extension.eq_ignore_ascii_case("gz"))
        .unwrap_or(false)
    {
        let mut decoder = GzDecoder::new(bytes.as_slice());
        let mut text = String::new();
        decoder.read_to_string(&mut text).map_err(|error| {
            AppError::new(
                "synctex_invalid",
                format!("SyncTeX data is not valid gzip: {error}"),
            )
        })?;
        Ok(text)
    } else {
        String::from_utf8(bytes).map_err(|error| {
            AppError::new(
                "synctex_invalid",
                format!("SyncTeX data is not valid UTF-8: {error}"),
            )
        })
    }
}

fn normalize_relative(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn map_input(root: &Path, raw: &str) -> Option<String> {
    let raw = raw.trim();
    if raw.is_empty() {
        return None;
    }
    let input = PathBuf::from(raw);
    let candidate = if input.is_absolute() {
        input
    } else {
        root.join(input)
    };
    let resolved = candidate.canonicalize().unwrap_or(candidate);
    resolved.strip_prefix(root).ok().map(normalize_relative)
}

struct Header {
    magnification: f64,
    unit: f64,
}

impl Default for Header {
    fn default() -> Self {
        Self {
            magnification: 1000.0,
            unit: 1.0,
        }
    }
}

fn parse_record(
    line: &str,
    page: u32,
    inputs: &HashMap<u32, String>,
    scale: f64,
) -> Option<SyncEntry> {
    let record_type = line.chars().next()?;
    if !matches!(record_type, '[' | '(' | 'h' | 'v' | 'x' | 'k' | 'g' | '$') {
        return None;
    }
    let body = &line[record_type.len_utf8()..];
    let (tag, rest) = body.split_once(',')?;
    let tag: u32 = tag.trim().parse().ok()?;
    let file = inputs.get(&tag)?.clone();
    let (source_line, rest) = rest.split_once(':')?;
    let source_line: u32 = source_line.trim().parse().ok()?;
    if source_line == 0 {
        return None;
    }
    let mut coordinates = rest.split(':');
    let (horizontal, vertical) = coordinates.next()?.split_once(',')?;
    let horizontal: f64 = horizontal.trim().parse().ok()?;
    let vertical: f64 = vertical.trim().parse().ok()?;
    let dimensions = coordinates.next();
    let mut width = 0.0;
    let mut height = 0.0;
    if let Some(dimensions) = dimensions {
        let mut values = dimensions.split(',');
        width = values
            .next()
            .and_then(|value| value.trim().parse::<f64>().ok())
            .unwrap_or(0.0);
        height = values
            .next()
            .and_then(|value| value.trim().parse::<f64>().ok())
            .unwrap_or(0.0);
    }
    // SyncTeX v points down from the page top. A box grows upward from its
    // baseline, so its top edge is v - height. Point records have no height.
    let y = if height > 0.0 {
        (vertical - height) * scale
    } else {
        vertical * scale
    };
    Some(SyncEntry {
        file,
        line: source_line,
        page,
        x: horizontal * scale,
        y,
        width: width.max(0.0) * scale,
        height: height.max(0.0) * scale,
    })
}

fn parse_text(root: &Path, text: &str) -> AppResult<SyncData> {
    let mut inputs: HashMap<u32, String> = HashMap::new();
    let mut entries = Vec::new();
    let mut page_count = 0u32;
    let mut current_page = 0u32;
    let mut header = Header::default();
    let mut in_content = false;

    for raw_line in text.lines() {
        let line = raw_line.trim_end_matches('\r');
        if !in_content {
            if let Some(rest) = line.strip_prefix("Input:") {
                if let Some((tag, path)) = rest.split_once(':') {
                    if let Ok(tag) = tag.trim().parse::<u32>() {
                        if let Some(relative) = map_input(root, path) {
                            inputs.insert(tag, relative);
                        }
                    }
                }
                continue;
            }
            if let Some(value) = line.strip_prefix("Magnification:") {
                if let Ok(value) = value.trim().parse::<f64>() {
                    if value > 0.0 {
                        header.magnification = value;
                    }
                }
                continue;
            }
            if let Some(value) = line.strip_prefix("Unit:") {
                if let Ok(value) = value.trim().parse::<f64>() {
                    if value > 0.0 {
                        header.unit = value;
                    }
                }
                continue;
            }
            if line.trim() == "Content:" {
                in_content = true;
            }
            continue;
        }

        if line.starts_with('{') {
            if let Ok(page) = line[1..].trim().parse::<u32>() {
                if page > 0 {
                    current_page = page;
                    page_count = page_count.max(page);
                }
            }
            continue;
        }
        if line.starts_with('}') {
            current_page = 0;
            continue;
        }
        if line.starts_with('!') || current_page == 0 {
            continue;
        }
        let scale = SP_TO_PT * header.unit * 1000.0 / header.magnification;
        if let Some(entry) = parse_record(line, current_page, &inputs, scale) {
            entries.push(entry);
        }
    }

    if !in_content {
        return Err(AppError::new(
            "synctex_invalid",
            "SyncTeX data does not contain a content section",
        ));
    }

    Ok(SyncData {
        entries,
        page_count,
    })
}

pub fn load(root: &Path) -> AppResult<SyncData> {
    let path = existing_path(root).ok_or_else(|| {
        AppError::new(
            "synctex_unavailable",
            "No SyncTeX data is available for the last successful build. Recompile the project first.",
        )
    })?;
    let text = read_text(&path)?;
    parse_text(root, &text)
}

pub fn status(root: &Path) -> SyncStatus {
    let Some(path) = existing_path(root) else {
        return SyncStatus {
            available: false,
            built_at_ms: 0,
            size: 0,
            page_count: 0,
        };
    };
    let Ok(meta) = fs::metadata(&path) else {
        return SyncStatus {
            available: false,
            built_at_ms: 0,
            size: 0,
            page_count: 0,
        };
    };
    let parsed = read_text(&path)
        .ok()
        .and_then(|text| parse_text(root, &text).ok());
    SyncStatus {
        available: parsed.is_some(),
        built_at_ms: modified_ms(&meta),
        size: meta.len(),
        page_count: parsed.map(|data| data.page_count).unwrap_or(0),
    }
}

pub fn forward(root: &Path, file: &str, line: u32) -> AppResult<Option<SyncTarget>> {
    let data = load(root)?;
    let file = file.replace('\\', "/");
    let file = file.trim_start_matches("./");
    let candidates: Vec<&SyncEntry> = data
        .entries
        .iter()
        .filter(|entry| entry.file == file)
        .collect();
    if candidates.is_empty() {
        return Ok(None);
    }

    let exact: Vec<&SyncEntry> = candidates
        .iter()
        .copied()
        .filter(|entry| entry.line == line)
        .collect();
    let pool = if exact.is_empty() { candidates } else { exact };
    let chosen = pool.into_iter().min_by(|left, right| {
        let left_distance = left.line.abs_diff(line);
        let right_distance = right.line.abs_diff(line);
        left_distance
            .cmp(&right_distance)
            .then_with(|| left.page.cmp(&right.page))
            .then_with(|| {
                left.y
                    .partial_cmp(&right.y)
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
    });
    Ok(chosen.map(|entry| SyncTarget {
        page: entry.page,
        x: entry.x,
        y: entry.y,
        width: entry.width,
        height: entry.height,
    }))
}

fn point_distance(entry: &SyncEntry, x: f64, y: f64) -> f64 {
    let width = entry.width.max(0.0);
    let height = entry.height.max(0.0);
    let dx = if x < entry.x {
        entry.x - x
    } else if x > entry.x + width {
        x - (entry.x + width)
    } else {
        0.0
    };
    let dy = if y < entry.y {
        entry.y - y
    } else if y > entry.y + height {
        y - (entry.y + height)
    } else {
        0.0
    };
    (dx * dx + dy * dy).sqrt()
}

pub fn reverse(root: &Path, page: u32, x: f64, y: f64) -> AppResult<Option<SyncSource>> {
    let data = load(root)?;
    let candidates: Vec<&SyncEntry> = data
        .entries
        .iter()
        .filter(|entry| entry.page == page)
        .collect();
    if candidates.is_empty() {
        return Ok(None);
    }

    let containing = candidates
        .iter()
        .copied()
        .filter(|entry| {
            entry.width > 0.0
                && entry.height > 0.0
                && x >= entry.x
                && x <= entry.x + entry.width
                && y >= entry.y
                && y <= entry.y + entry.height
        })
        .min_by(|left, right| {
            let left_area = left.width * left.height;
            let right_area = right.width * right.height;
            left_area
                .partial_cmp(&right_area)
                .unwrap_or(std::cmp::Ordering::Equal)
        });

    let chosen = containing.or_else(|| {
        candidates
            .iter()
            .copied()
            .map(|entry| (entry, point_distance(entry, x, y)))
            .filter(|(_, distance)| *distance <= MAX_REVERSE_DISTANCE_PT)
            .min_by(|(left, left_distance), (right, right_distance)| {
                left_distance
                    .partial_cmp(right_distance)
                    .unwrap_or(std::cmp::Ordering::Equal)
                    .then_with(|| {
                        let left_area = left.width * left.height;
                        let right_area = right.width * right.height;
                        left_area
                            .partial_cmp(&right_area)
                            .unwrap_or(std::cmp::Ordering::Equal)
                    })
            })
            .map(|(entry, _)| entry)
    });

    Ok(chosen.map(|entry| SyncSource {
        file: entry.file.clone(),
        line: entry.line,
    }))
}

#[cfg(test)]
mod tests {
    use std::io::Write;

    use flate2::write::GzEncoder;
    use flate2::Compression;
    use tempfile::tempdir;

    use super::*;

    fn write_synctex(root: &Path, text: &str) {
        let directory = root.join(".latexstudio");
        fs::create_dir_all(&directory).unwrap();
        let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
        encoder.write_all(text.as_bytes()).unwrap();
        fs::write(
            directory.join("last-success.synctex.gz"),
            encoder.finish().unwrap(),
        )
        .unwrap();
    }

    fn fixture() -> (tempfile::TempDir, PathBuf) {
        let directory = tempdir().unwrap();
        let root = directory.path().canonicalize().unwrap();
        fs::write(root.join("main.tex"), "main").unwrap();
        fs::write(root.join("chapter.tex"), "chapter").unwrap();
        let text = format!(
            "SyncTeX Version:1\nInput:1:{}\nInput:2:{}\nOutput:pdf\nMagnification:1000\nUnit:1\nX Offset:0\nY Offset:0\nContent:\n{{1\n[1,3:65536,131072:65536,65536,0\nx2,10:131072,262144\n}}1\n{{2\n[1,7:0,0:131072,65536,0\n}}2\n",
            root.join("main.tex").display(),
            root.join("chapter.tex").display()
        );
        write_synctex(&root, &text);
        (directory, root)
    }

    #[test]
    fn status_and_forward_map_real_records() {
        let (_directory, root) = fixture();
        let status = status(&root);
        assert!(status.available);
        assert_eq!(status.page_count, 2);
        assert!(status.size > 0);

        let target = forward(&root, "main.tex", 3).unwrap().unwrap();
        assert_eq!(target.page, 1);
        assert!((target.x - 1.00375).abs() < 0.01);
        assert!((target.y - 1.00375).abs() < 0.01);

        let nearest = forward(&root, "main.tex", 4).unwrap().unwrap();
        assert_eq!(nearest.page, 1);
        assert!((nearest.x - 1.00375).abs() < 0.01);
    }

    #[test]
    fn reverse_hit_tests_boxes_and_ignores_far_clicks() {
        let (_directory, root) = fixture();
        let source = reverse(&root, 1, 1.5, 1.5).unwrap().unwrap();
        assert_eq!(source.file, "main.tex");
        assert_eq!(source.line, 3);

        let included = reverse(&root, 1, 2.1, 4.1).unwrap().unwrap();
        assert_eq!(included.file, "chapter.tex");
        assert_eq!(included.line, 10);

        assert!(reverse(&root, 1, 50.0, 50.0).unwrap().is_none());
        assert!(reverse(&root, 9, 1.0, 1.0).unwrap().is_none());
    }

    #[test]
    fn missing_synctex_is_reported() {
        let directory = tempdir().unwrap();
        let root = directory.path().canonicalize().unwrap();
        let status = status(&root);
        assert!(!status.available);
        let error = forward(&root, "main.tex", 1).unwrap_err();
        assert_eq!(error.code, "synctex_unavailable");
    }

    #[test]
    fn malformed_synctex_does_not_crash() {
        let directory = tempdir().unwrap();
        let root = directory.path().canonicalize().unwrap();
        write_synctex(&root, "SyncTeX Version:1\nnot a record\n");
        let error = load(&root).unwrap_err();
        assert_eq!(error.code, "synctex_invalid");
        assert!(!status(&root).available);
    }

    #[test]
    #[ignore = "requires a real Tectonic build with --synctex"]
    fn parses_real_tectonic_synctex() {
        let project = std::env::var("LATEX_STUDIO_TEST_PROJECT")
            .expect("set LATEX_STUDIO_TEST_PROJECT to a compiled Tectonic project");
        let root = PathBuf::from(project).canonicalize().unwrap();
        let data = load(&root).unwrap();
        assert!(!data.entries.is_empty());
        assert!(data.page_count >= 1);

        let target = forward(&root, "main.tex", 14)
            .unwrap()
            .expect("line 14 should map to the PDF");
        assert!(target.page >= 1);
        let source = reverse(
            &root,
            target.page,
            target.x + target.width / 2.0,
            target.y + target.height / 2.0,
        )
        .unwrap()
        .expect("the mapped box should map back to source");
        assert_eq!(source.file, "main.tex");
    }
}
