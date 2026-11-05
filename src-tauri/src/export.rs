use std::fs;
use std::path::{Path, PathBuf};

use base64::Engine;
use walkdir::WalkDir;

use crate::{
    error::{AppError, AppResult},
    models::ExportResult,
    project,
    state::project_last_pdf_path,
    tools,
};

const MAX_PANDOC_OUTPUT: usize = 12_000;

fn ensure_extension(path: &Path, extension: &str) -> PathBuf {
    if path.extension().is_some() {
        path.to_path_buf()
    } else {
        let mut value = path.as_os_str().to_owned();
        value.push(".");
        value.push(extension);
        PathBuf::from(value)
    }
}

fn prepare_destination(dest: &str, extension: &str, overwrite: bool) -> AppResult<PathBuf> {
    let path = ensure_extension(Path::new(dest), extension);
    if !path.is_absolute() {
        return Err(AppError::new(
            "invalid_destination",
            "Export destination must be an absolute path",
        ));
    }
    if let Some(parent) = path.parent() {
        if !parent.is_dir() {
            return Err(AppError::new(
                "invalid_destination",
                "The export folder does not exist",
            ));
        }
    }
    if path.exists() && !overwrite {
        return Err(AppError::new(
            "export_exists",
            "A file already exists at the selected destination",
        ));
    }
    Ok(path)
}

pub fn path_exists(path: &str) -> bool {
    Path::new(path).exists()
}

pub fn export(
    root: &Path,
    format: &str,
    dest: &str,
    overwrite: bool,
    main_file: &str,
) -> AppResult<ExportResult> {
    let root = root
        .canonicalize()
        .map_err(|e| AppError::new("invalid_project", e.to_string()))?;
    match format {
        "pdf" => {
            let source = project_last_pdf_path(&root);
            if !source.is_file() {
                return Err(AppError::new(
                    "no_pdf",
                    "There is no successfully compiled PDF to export yet",
                ));
            }
            let destination = prepare_destination(dest, "pdf", overwrite)?;
            fs::copy(&source, &destination)
                .map_err(|e| AppError::io("Could not export the PDF", e))?;
            Ok(ExportResult {
                path: destination.to_string_lossy().to_string(),
                format: "pdf".into(),
            })
        }
        "tex" => {
            let source = project::resolve_existing(&root, main_file)?;
            let destination = prepare_destination(dest, "tex", overwrite)?;
            fs::copy(&source, &destination)
                .map_err(|e| AppError::io("Could not export the LaTeX source", e))?;
            Ok(ExportResult {
                path: destination.to_string_lossy().to_string(),
                format: "tex".into(),
            })
        }
        "zip" => {
            let destination = prepare_destination(dest, "zip", overwrite)?;
            write_zip(&root, &destination)?;
            Ok(ExportResult {
                path: destination.to_string_lossy().to_string(),
                format: "zip".into(),
            })
        }
        other => Err(AppError::new(
            "unknown_format",
            format!("Unsupported export format: {other}"),
        )),
    }
}

pub fn write_zip(root: &Path, destination: &Path) -> AppResult<()> {
    let file = fs::File::create(destination)
        .map_err(|e| AppError::io("Could not create ZIP archive", e))?;
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .unix_permissions(0o644);
    let dir_options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Stored)
        .unix_permissions(0o755);
    for entry in WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| {
            let name = entry.file_name().to_string_lossy();
            !(entry.file_type().is_dir()
                && matches!(
                    name.as_ref(),
                    ".git" | ".latexstudio" | "node_modules" | "target" | ".idea"
                ))
                && name != ".DS_Store"
        })
    {
        let entry = entry.map_err(|e| AppError::new("zip_failed", e.to_string()))?;
        if entry.path() == root {
            continue;
        }
        let Ok(rel) = entry.path().strip_prefix(root) else {
            continue;
        };
        let name = rel.to_string_lossy().replace('\\', "/");
        if name.is_empty() {
            continue;
        }
        if entry.file_type().is_dir() {
            zip.add_directory(format!("{name}/"), dir_options)
                .map_err(|e| AppError::new("zip_failed", e.to_string()))?;
        } else if entry.file_type().is_file() {
            use std::io::Write;
            zip.start_file(name, options)
                .map_err(|e| AppError::new("zip_failed", e.to_string()))?;
            let bytes = fs::read(entry.path())
                .map_err(|e| AppError::io("Could not read a project file", e))?;
            zip.write_all(&bytes)
                .map_err(|e| AppError::new("zip_failed", e.to_string()))?;
        }
    }
    zip.finish()
        .map_err(|e| AppError::new("zip_failed", e.to_string()))?;
    Ok(())
}

pub async fn export_pandoc(
    root: &Path,
    format: &str,
    dest: &str,
    overwrite: bool,
    main_file: &str,
) -> AppResult<ExportResult> {
    let definition = match format {
        "docx" => ("docx", vec![]),
        "html" => (
            "html",
            vec!["--standalone", "--embed-resources", "--resource-path=."],
        ),
        "odt" => ("odt", vec![]),
        "epub" => ("epub", vec![]),
        "markdown" => ("md", vec!["--to=markdown", "--wrap=auto"]),
        other => {
            return Err(AppError::new(
                "unknown_format",
                format!("Unsupported Pandoc format: {other}"),
            ))
        }
    };
    let pandoc = tools::find_tool("pandoc").ok_or_else(|| {
        AppError::new(
            "pandoc_missing",
            "Pandoc is not installed. Install it with Homebrew, then refresh the tool list.",
        )
    })?;
    project::resolve_existing(root, main_file)?;
    let destination = prepare_destination(dest, definition.0, overwrite)?;
    let mut command = tokio::process::Command::new(pandoc);
    command
        .arg(main_file)
        .arg("--output")
        .arg(&destination)
        .arg(format!("--resource-path={}", root.display()))
        .current_dir(root)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    for arg in definition.1 {
        command.arg(arg);
    }
    let output = tokio::time::timeout(std::time::Duration::from_secs(180), command.output())
        .await
        .map_err(|_| AppError::new("conversion_timeout", "The conversion timed out"))?
        .map_err(|e| AppError::io("Could not start Pandoc", e))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let message = stderr.lines().take(40).collect::<Vec<_>>().join("\n");
        return Err(AppError::new(
            "conversion_failed",
            if message.trim().is_empty() {
                "Pandoc failed without an error message".into()
            } else {
                message
            },
        ));
    }
    if !destination.is_file() {
        return Err(AppError::new(
            "conversion_failed",
            "Pandoc finished but no output file was created",
        ));
    }
    Ok(ExportResult {
        path: destination.to_string_lossy().to_string(),
        format: format.into(),
    })
}

pub fn pdf_data(path: &Path) -> AppResult<String> {
    let bytes = fs::read(path).map_err(|e| AppError::io("Could not read PDF", e))?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

#[allow(dead_code)]
pub fn truncate_output(value: &str) -> String {
    if value.len() <= MAX_PANDOC_OUTPUT {
        value.to_string()
    } else {
        value.chars().take(MAX_PANDOC_OUTPUT).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;

    #[test]
    fn zip_preserves_nested_unicode_paths_and_excludes_build_output() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("Проект с пробелами");
        fs::create_dir_all(root.join("глава")).unwrap();
        fs::create_dir_all(root.join(".latexstudio/build")).unwrap();
        fs::create_dir_all(root.join("node_modules/pkg")).unwrap();
        fs::write(root.join("main.tex"), "\\documentclass{article}").unwrap();
        fs::write(root.join("глава/введение.tex"), "Текст").unwrap();
        fs::write(root.join(".latexstudio/build/main.pdf"), "pdf").unwrap();
        fs::write(root.join("node_modules/pkg/index.js"), "js").unwrap();

        let destination = temp.path().join("export.zip");
        write_zip(&root, &destination).unwrap();

        let file = fs::File::open(&destination).unwrap();
        let mut archive = zip::ZipArchive::new(file).unwrap();
        let names = (0..archive.len())
            .map(|index| archive.by_index(index).unwrap().name().to_string())
            .collect::<Vec<_>>();
        assert!(names.contains(&"main.tex".to_string()));
        assert!(names.contains(&"глава/введение.tex".to_string()));
        assert!(names.iter().all(|name| !name.starts_with(".latexstudio/")));
        assert!(names.iter().all(|name| !name.starts_with("node_modules/")));

        let mut content = String::new();
        archive
            .by_name("глава/введение.tex")
            .unwrap()
            .read_to_string(&mut content)
            .unwrap();
        assert_eq!(content, "Текст");
    }

    #[test]
    fn tex_export_uses_requested_main_file() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("project");
        fs::create_dir_all(root.join("chapters")).unwrap();
        fs::write(root.join("main.tex"), "main").unwrap();
        fs::write(root.join("chapters/other.tex"), "other").unwrap();
        let destination = temp.path().join("source.tex");
        let result = export(
            &root,
            "tex",
            destination.to_str().unwrap(),
            false,
            "chapters/other.tex",
        )
        .unwrap();
        assert_eq!(fs::read_to_string(result.path).unwrap(), "other");
    }
}

