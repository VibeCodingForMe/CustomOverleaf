use std::{
    ffi::OsString,
    fs,
    path::{Path, PathBuf},
    process::Stdio,
    sync::atomic::Ordering,
    time::{Duration, Instant},
};

use base64::Engine;
use serde::Serialize;
use tokio::{io::AsyncReadExt, process::Command};

use crate::{
    diagnostics,
    error::{AppError, AppResult},
    models::{BuildResult, CompileSettings, Diagnostic, LastPdf, ToolsInfo},
    project,
    state::{project_build_dir, project_last_pdf_path, project_last_synctex_path, AppState},
    tools,
    util::now_ms,
};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildStatus {
    pub running: bool,
    pub build_id: u64,
    pub pid: Option<u32>,
}

#[derive(Debug)]
struct EnginePlan {
    name: String,
    program: PathBuf,
    args: Vec<OsString>,
    passes: usize,
}

#[derive(Debug)]
struct ProcessOutcome {
    success: bool,
    exit_code: Option<i32>,
    stdout: String,
    stderr: String,
    cancelled: bool,
    timed_out: bool,
}

fn choose_engine(requested: &str, available: &ToolsInfo) -> AppResult<EnginePlan> {
    let latexmk = available.latexmk.as_ref().map(|t| PathBuf::from(&t.path));
    let tectonic = available.tectonic.as_ref().map(|t| PathBuf::from(&t.path));
    let pdflatex = available.pdflatex.as_ref().map(|t| PathBuf::from(&t.path));
    let xelatex = available.xelatex.as_ref().map(|t| PathBuf::from(&t.path));
    let lualatex = available.lualatex.as_ref().map(|t| PathBuf::from(&t.path));

    let normalized = match requested {
        "auto" => {
            if latexmk.is_some() {
                "latexmk"
            } else if tectonic.is_some() {
                "pdflatex"
            } else {
                "pdflatex"
            }
        }
        other => other,
    };

    let latexmk_plan = |name: &str, flag: Option<&str>, driver: &PathBuf| -> EnginePlan {
        let mut args: Vec<OsString> = Vec::new();
        if let Some(flag) = flag {
            args.push(flag.into());
        } else {
            args.push("-pdf".into());
        }
        args.push("-interaction=nonstopmode".into());
        args.push("-file-line-error".into());
        args.push("-synctex=1".into());
        EnginePlan {
            name: name.into(),
            program: driver.clone(),
            args,
            passes: 1,
        }
    };

    match normalized {
        "latexmk" => {
            let driver = latexmk.ok_or_else(|| missing_engine("latexmk"))?;
            Ok(latexmk_plan("latexmk", None, &driver))
        }
        "pdflatex" => {
            if let Some(driver) = &latexmk {
                Ok(latexmk_plan("pdflatex", None, driver))
            } else if let Some(driver) = pdflatex {
                Ok(EnginePlan {
                    name: "pdflatex".into(),
                    program: driver,
                    args: vec![
                        "-interaction=nonstopmode".into(),
                        "-file-line-error".into(),
                        "-synctex=1".into(),
                    ],
                    passes: 2,
                })
            } else if let Some(driver) = &tectonic {
                Ok(EnginePlan {
                    name: "tectonic".into(),
                    program: driver.clone(),
                    args: vec![],
                    passes: 1,
                })
            } else {
                Err(missing_engine("pdfLaTeX"))
            }
        }
        "xelatex" => {
            if let Some(driver) = &latexmk {
                Ok(latexmk_plan("xelatex", Some("-xelatex"), driver))
            } else if let Some(driver) = xelatex {
                Ok(EnginePlan {
                    name: "xelatex".into(),
                    program: driver,
                    args: vec![
                        "-interaction=nonstopmode".into(),
                        "-file-line-error".into(),
                        "-synctex=1".into(),
                    ],
                    passes: 2,
                })
            } else {
                Err(missing_engine("XeLaTeX"))
            }
        }
        "lualatex" => {
            if let Some(driver) = &latexmk {
                Ok(latexmk_plan("lualatex", Some("-lualatex"), driver))
            } else if let Some(driver) = lualatex {
                Ok(EnginePlan {
                    name: "lualatex".into(),
                    program: driver,
                    args: vec![
                        "-interaction=nonstopmode".into(),
                        "-file-line-error".into(),
                        "-synctex=1".into(),
                    ],
                    passes: 2,
                })
            } else {
                Err(missing_engine("LuaLaTeX"))
            }
        }
        "tectonic" => {
            let driver = tectonic.ok_or_else(|| missing_engine("Tectonic"))?;
            Ok(EnginePlan {
                name: "tectonic".into(),
                program: driver,
                args: vec![],
                passes: 1,
            })
        }
        other => Err(AppError::new(
            "unknown_engine",
            format!("Unknown TeX engine: {other}"),
        )),
    }
}

fn missing_engine(name: &str) -> AppError {
    AppError::new(
        "missing_engine",
        format!(
            "{name} was not found. Install TeX Live/MacTeX or Tectonic, then refresh the tool list."
        ),
    )
}

fn quote_arg(arg: &OsString) -> String {
    let text = arg.to_string_lossy();
    if text.is_empty() || text.contains(' ') || text.contains('"') {
        format!("\"{}\"", text.replace('"', "\\\""))
    } else {
        text.to_string()
    }
}

fn build_args(plan: &EnginePlan, main_file: &str, build_dir: &Path) -> Vec<OsString> {
    let mut args = plan.args.clone();
    match plan.name.as_str() {
        "latexmk" | "pdflatex"
            if plan
                .program
                .file_name()
                .map(|n| n == "latexmk")
                .unwrap_or(false) =>
        {
            args.push(format!("-outdir={}", build_dir.display()).into());
            args.push(main_file.into());
        }
        "xelatex" | "lualatex"
            if plan
                .program
                .file_name()
                .map(|n| n == "latexmk")
                .unwrap_or(false) =>
        {
            args.push(format!("-outdir={}", build_dir.display()).into());
            args.push(main_file.into());
        }
        "tectonic" => {
            args.push("-X".into());
            args.push("compile".into());
            args.push(main_file.into());
            args.push("--outdir".into());
            args.push(build_dir.as_os_str().to_owned());
            args.push("--keep-logs".into());
            args.push("--synctex".into());
        }
        _ => {
            args.push(format!("-output-directory={}", build_dir.display()).into());
            args.push(main_file.into());
        }
    }
    args
}

fn kill_group(pid: u32, signal: i32) {
    #[cfg(unix)]
    unsafe {
        libc::kill(-(pid as i32), signal);
    }
}

async fn run_process(
    app_state: &AppState,
    plan: &EnginePlan,
    args: &[OsString],
    cwd: &Path,
    timeout: Duration,
) -> AppResult<ProcessOutcome> {
    let started = Instant::now();
    let mut command = Command::new(&plan.program);
    command
        .args(args)
        .current_dir(cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null());
    let mut search_paths = Vec::new();
    if plan.name == "tectonic" {
        search_paths.push(app_state.data_dir.join("bin"));
    }
    search_paths.extend(tools::path_candidates());
    if let Ok(path) = std::env::join_paths(search_paths) {
        command.env("PATH", path);
    }
    #[cfg(unix)]
    command.process_group(0);
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            return Ok(ProcessOutcome {
                success: false,
                exit_code: None,
                stdout: String::new(),
                stderr: format!("Could not start {}: {err}", plan.program.display()),
                cancelled: false,
                timed_out: false,
            })
        }
        Err(err) => return Err(AppError::io("Could not start the TeX compiler", err)),
    };
    let pid = child.id().unwrap_or(0);
    if let Ok(mut slot) = app_state.build_slot.lock() {
        slot.active_pid = Some(pid);
    }
    let mut stdout_pipe = child
        .stdout
        .take()
        .ok_or_else(|| AppError::new("compiler_io", "Could not capture compiler stdout"))?;
    let mut stderr_pipe = child
        .stderr
        .take()
        .ok_or_else(|| AppError::new("compiler_io", "Could not capture compiler stderr"))?;
    let stdout_task = tokio::spawn(async move {
        let mut buffer = Vec::new();
        let _ = stdout_pipe.read_to_end(&mut buffer).await;
        buffer
    });
    let stderr_task = tokio::spawn(async move {
        let mut buffer = Vec::new();
        let _ = stderr_pipe.read_to_end(&mut buffer).await;
        buffer
    });

    let remaining = timeout.saturating_sub(started.elapsed());
    let mut timed_out = false;
    let status = {
        let wait = child.wait();
        tokio::pin!(wait);
        tokio::select! {
            result = &mut wait => result.ok(),
            _ = tokio::time::sleep(remaining) => None,
        }
    };
    let status = if let Some(status) = status {
        Some(status)
    } else {
        timed_out = true;
        kill_group(pid, libc::SIGKILL);
        child.wait().await.ok()
    };

    let stdout = stdout_task.await.unwrap_or_default();
    let stderr = stderr_task.await.unwrap_or_default();
    let cancelled = app_state
        .build_slot
        .lock()
        .map(|slot| slot.cancel_requested)
        .unwrap_or(false);

    Ok(ProcessOutcome {
        success: status.as_ref().map(|s| s.success()).unwrap_or(false),
        exit_code: status.and_then(|s| s.code()),
        stdout: String::from_utf8_lossy(&stdout).to_string(),
        stderr: String::from_utf8_lossy(&stderr).to_string(),
        cancelled,
        timed_out,
    })
}

fn combine_logs(outcomes: &[ProcessOutcome]) -> String {
    let mut text = String::new();
    for (index, outcome) in outcomes.iter().enumerate() {
        if outcomes.len() > 1 {
            text.push_str(&format!("--- compiler pass {} ---\n", index + 1));
        }
        if !outcome.stdout.trim().is_empty() {
            text.push_str(outcome.stdout.trim_end());
            text.push('\n');
        }
        if !outcome.stderr.trim().is_empty() {
            text.push_str(outcome.stderr.trim_end());
            text.push('\n');
        }
    }
    text
}

fn strip_ansi(value: &str) -> String {
    let re = regex::Regex::new(r"\x1b\[[0-9;]*[A-Za-z]").expect("valid regex");
    re.replace_all(value, "").to_string()
}

fn failure_diagnostic(code: &str, message: &str, main_file: &str) -> Diagnostic {
    Diagnostic {
        id: format!("diag-{code}"),
        severity: "error".into(),
        code: code.into(),
        message: message.into(),
        raw: message.into(),
        file: Some(main_file.into()),
        line: None,
        column: None,
        params: Default::default(),
        fixable: false,
    }
}

fn pdf_is_valid(path: &Path) -> bool {
    let Ok(meta) = fs::metadata(path) else {
        return false;
    };
    if meta.len() < 5 {
        return false;
    }
    let mut file = match fs::File::open(path) {
        Ok(file) => file,
        Err(_) => return false,
    };
    let mut header = [0u8; 5];
    use std::io::Read;
    if file.read_exact(&mut header).is_err() {
        return false;
    }
    &header == b"%PDF-"
}

pub async fn compile(
    root: &Path,
    main_file: &str,
    requested_engine: &str,
    settings: &CompileSettings,
    state: &AppState,
) -> AppResult<BuildResult> {
    let main_path = project::resolve_existing(root, main_file)?;
    if !main_path.is_file() {
        return Err(AppError::new(
            "invalid_main",
            "The main LaTeX file does not exist",
        ));
    }
    let available = tools::detect_tools();
    let plan = choose_engine(requested_engine, &available)?;

    let build_id = state.next_build_id();
    {
        let mut slot = state
            .build_slot
            .lock()
            .map_err(|_| AppError::new("state_error", "Build state lock poisoned"))?;
        if slot.running {
            return Err(AppError::new(
                "build_in_progress",
                "Another build is already running for this application",
            ));
        }
        slot.running = true;
        slot.build_id = build_id;
        slot.active_pid = None;
        slot.cancel_requested = false;
    }

    let result = compile_inner(root, main_file, &plan, settings, state, build_id).await;
    if let Ok(mut slot) = state.build_slot.lock() {
        slot.running = false;
        slot.active_pid = None;
        slot.cancel_requested = false;
    }
    result
}

async fn compile_inner(
    root: &Path,
    main_file: &str,
    plan: &EnginePlan,
    settings: &CompileSettings,
    state: &AppState,
    build_id: u64,
) -> AppResult<BuildResult> {
    let build_dir = resolve_build_dir(root, &settings.build_dir)?;
    fs::create_dir_all(&build_dir)
        .map_err(|e| AppError::io("Could not create build directory", e))?;
    let stem = Path::new(main_file)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "document".into());
    let pdf_path = build_dir.join(format!("{stem}.pdf"));
    let log_path = build_dir.join(format!("{stem}.log"));
    let _ = fs::remove_file(&pdf_path);
    let _ = fs::remove_file(&log_path);
    let _ = fs::remove_file(build_dir.join(format!("{stem}.synctex.gz")));
    let last_pdf = project_last_pdf_path(root);
    let started_at = now_ms();
    let started = Instant::now();
    let args = build_args(plan, main_file, &build_dir);
    let mut command_preview = plan.program.to_string_lossy().to_string();
    for arg in &args {
        command_preview.push(' ');
        command_preview.push_str(&quote_arg(arg));
    }

    let timeout = Duration::from_secs(settings.timeout_seconds.max(15));
    let mut outcomes: Vec<ProcessOutcome> = Vec::new();
    let mut cancelled = false;
    let mut timed_out = false;

    for pass in 0..plan.passes.max(1) {
        if state
            .build_slot
            .lock()
            .map(|slot| slot.cancel_requested)
            .unwrap_or(false)
        {
            cancelled = true;
            break;
        }
        if pass > 0 {
            let elapsed = started.elapsed();
            if elapsed >= timeout {
                timed_out = true;
                break;
            }
        }
        let remaining = timeout.saturating_sub(started.elapsed());
        let outcome = run_process(state, plan, &args, root, remaining).await?;
        let pass_success = outcome.success;
        cancelled = cancelled || outcome.cancelled;
        timed_out = timed_out || outcome.timed_out;
        outcomes.push(outcome);
        if cancelled || timed_out {
            break;
        }
        if !pass_success {
            break;
        }
    }

    let mut logs = strip_ansi(&combine_logs(&outcomes));
    let log_file = fs::read_to_string(&log_path).unwrap_or_default();
    let mut diagnostic_input = logs.clone();
    if !log_file.trim().is_empty() {
        diagnostic_input.push_str("\n=== TeX log ===\n");
        diagnostic_input.push_str(&strip_ansi(&log_file));
    }
    if !log_file.trim().is_empty() {
        logs.push_str("\n=== TeX log ===\n");
        logs.push_str(&strip_ansi(&log_file));
    }

    let process_success = outcomes.last().map(|o| o.success).unwrap_or(false);
    let valid_pdf = pdf_is_valid(&pdf_path);
    let success = process_success && valid_pdf && !cancelled && !timed_out;
    let mut diagnostics =
        diagnostics::parse_diagnostics(root, main_file, &diagnostic_input, success);

    if success {
        if let Some(parent) = last_pdf.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| AppError::io("Could not create build metadata folder", e))?;
        }
        fs::copy(&pdf_path, &last_pdf)
            .map_err(|e| AppError::io("Could not preserve the successful PDF", e))?;
        // Keep the SyncTeX file that belongs to the preserved PDF. If an
        // engine did not emit one, remove the previous mapping so reverse
        // lookup cannot point into a different build.
        let synctex_source = build_dir.join(format!("{stem}.synctex.gz"));
        let last_synctex = project_last_synctex_path(root);
        if synctex_source.is_file() {
            fs::copy(&synctex_source, &last_synctex)
                .map_err(|e| AppError::io("Could not preserve SyncTeX data", e))?;
        } else {
            let _ = fs::remove_file(&last_synctex);
        }
    } else {
        if cancelled {
            diagnostics.push(failure_diagnostic(
                "build_cancelled",
                "The compilation was cancelled.",
                main_file,
            ));
        } else if timed_out {
            diagnostics.push(failure_diagnostic(
                "build_timeout",
                "The compiler did not finish before the timeout.",
                main_file,
            ));
        } else if !valid_pdf && !diagnostics.iter().any(|d| d.code == "no_pdf") {
            diagnostics.push(failure_diagnostic(
                "no_pdf",
                "The compiler finished without producing a valid PDF.",
                main_file,
            ));
        }
    }

    let pdf_size = fs::metadata(&pdf_path).map(|m| m.len()).unwrap_or(0);
    let stale_pdf = last_pdf.exists();
    let exit_code = outcomes.last().and_then(|o| o.exit_code);
    let build_output = format!(
        "{}\n\nEngine: {}\nExit code: {}\nDuration: {} ms\nPDF: {}",
        command_preview,
        plan.name,
        exit_code
            .map(|c| c.to_string())
            .unwrap_or_else(|| "none".into()),
        started.elapsed().as_millis(),
        if valid_pdf {
            format!("{} bytes", pdf_size)
        } else {
            "not produced".into()
        }
    );

    Ok(BuildResult {
        id: build_id,
        success,
        cancelled,
        timed_out,
        exit_code,
        logs,
        build_output,
        diagnostics,
        duration_ms: started.elapsed().as_millis() as u64,
        engine: plan.name.clone(),
        engine_path: Some(plan.program.to_string_lossy().to_string()),
        pdf_path: if valid_pdf {
            project::relative_path(root, &pdf_path)
        } else {
            None
        },
        pdf_size,
        stale_pdf,
        command_preview,
        main_file: main_file.to_string(),
        started_at_ms: started_at,
    })
}

pub fn cancel(state: &AppState) -> AppResult<()> {
    let mut slot = state
        .build_slot
        .lock()
        .map_err(|_| AppError::new("state_error", "Build state lock poisoned"))?;
    if !slot.running {
        return Ok(());
    }
    slot.cancel_requested = true;
    if let Some(pid) = slot.active_pid {
        drop(slot);
        kill_group(pid, libc::SIGTERM);
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(800));
            kill_group(pid, libc::SIGKILL);
        });
    }
    Ok(())
}

pub fn status(state: &AppState) -> AppResult<BuildStatus> {
    let slot = state
        .build_slot
        .lock()
        .map_err(|_| AppError::new("state_error", "Build state lock poisoned"))?;
    Ok(BuildStatus {
        running: slot.running,
        build_id: slot.build_id,
        pid: slot.active_pid,
    })
}

pub fn last_pdf(root: &Path) -> AppResult<Option<LastPdf>> {
    let path = project_last_pdf_path(root);
    if !path.is_file() {
        return Ok(None);
    }
    let meta = fs::metadata(&path).map_err(|e| AppError::io("Could not read PDF info", e))?;
    let bytes = fs::read(&path).map_err(|e| AppError::io("Could not read PDF", e))?;
    if !bytes.starts_with(b"%PDF-") {
        return Ok(None);
    }
    let data = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(Some(LastPdf {
        data,
        built_at_ms: meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64)
            .unwrap_or_else(now_ms),
        size: bytes.len() as u64,
    }))
}

pub fn clean(root: &Path, custom_build_dir: &str) -> AppResult<()> {
    let build_dir = resolve_build_dir(root, custom_build_dir)?;
    if build_dir.exists() {
        if !build_dir.starts_with(root) {
            return Err(AppError::new(
                "outside_project",
                "Refusing to remove a directory outside the project",
            ));
        }
        fs::remove_dir_all(&build_dir)
            .map_err(|e| AppError::io("Could not clean build files", e))?;
    }
    Ok(())
}

const AUX_EXTENSIONS: &[&str] = &[
    "aux",
    "bbl",
    "bcf",
    "blg",
    "fls",
    "fdb_latexmk",
    "lof",
    "log",
    "lot",
    "nav",
    "out",
    "run.xml",
    "snm",
    "synctex",
    "synctex.gz",
    "toc",
    "vrb",
    "xdv",
];

fn is_auxiliary_file(name: &str) -> bool {
    let lower = name.to_lowercase();
    AUX_EXTENSIONS
        .iter()
        .any(|extension| lower.ends_with(&format!(".{extension}")))
}

/// Removes generated auxiliary files while preserving PDFs and source files.
pub fn clean_aux(root: &Path, custom_build_dir: &str) -> AppResult<u64> {
    let build_dir = resolve_build_dir(root, custom_build_dir)?;
    let mut removed = 0u64;
    let mut directories = vec![root.to_path_buf()];
    if build_dir != root {
        directories.push(build_dir);
    }
    for directory in directories {
        let Ok(entries) = fs::read_dir(&directory) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            if is_auxiliary_file(&name) && fs::remove_file(&path).is_ok() {
                removed += 1;
            }
        }
    }
    Ok(removed)
}

/// Resolves the configured build directory, rejecting absolute/parent paths and
/// symlink escapes. An empty setting keeps the default `.latexstudio/build`.
pub fn resolve_build_dir(root: &Path, custom: &str) -> AppResult<PathBuf> {
    let setting = custom.trim().replace('\\', "/");
    if setting.is_empty() {
        return Ok(project_build_dir(root));
    }
    if setting.starts_with('/') || setting.split('/').any(|part| part == "..") {
        return Err(AppError::new(
            "invalid_build_dir",
            "The build directory must stay inside the project",
        ));
    }
    let candidate = root.join(&setting);
    fs::create_dir_all(&candidate)
        .map_err(|e| AppError::io("Could not create build directory", e))?;
    let canonical_root = root
        .canonicalize()
        .map_err(|e| AppError::io("Could not resolve project root", e))?;
    let canonical_candidate = candidate
        .canonicalize()
        .map_err(|e| AppError::io("Could not resolve build directory", e))?;
    if !canonical_candidate.starts_with(&canonical_root) {
        return Err(AppError::new(
            "outside_project",
            "The build directory escapes the project",
        ));
    }
    Ok(canonical_candidate)
}

#[allow(dead_code)]
pub fn next_id(state: &AppState) -> u64 {
    state.next_build_id.fetch_add(1, Ordering::SeqCst)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clean_aux_removes_generated_files_but_keeps_pdf_and_source() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().canonicalize().unwrap();
        fs::create_dir_all(root.join(".latexstudio/build")).unwrap();
        fs::write(root.join("main.tex"), "source").unwrap();
        fs::write(root.join("main.aux"), "aux").unwrap();
        fs::write(root.join("main.pdf"), "pdf").unwrap();
        fs::write(root.join(".latexstudio/build/main.log"), "log").unwrap();
        fs::write(root.join(".latexstudio/build/main.synctex.gz"), "sync").unwrap();
        fs::write(root.join(".latexstudio/build/main.pdf"), "pdf").unwrap();
        let removed = clean_aux(&root, "").unwrap();
        assert_eq!(removed, 3);
        assert!(root.join("main.tex").is_file());
        assert!(root.join("main.pdf").is_file());
        assert!(root.join(".latexstudio/build/main.pdf").is_file());
        assert!(!root.join("main.aux").exists());
        assert!(!root.join(".latexstudio/build/main.log").exists());
        assert!(!root.join(".latexstudio/build/main.synctex.gz").exists());
    }

    #[tokio::test]
    #[ignore = "requires Tectonic and a network connection on first run"]
    async fn tectonic_compiles_a_sample_document() {
        if tools::find_tool("tectonic").is_none() {
            eprintln!("Tectonic not installed; skipping");
            return;
        }
        let external_root = std::env::var("LATEX_STUDIO_TEST_PROJECT").ok();
        let external_main =
            std::env::var("LATEX_STUDIO_TEST_MAIN").unwrap_or_else(|_| "main.tex".into());
        let temp_dir;
        let root = if let Some(path) = external_root {
            PathBuf::from(path).canonicalize().unwrap()
        } else {
            temp_dir = tempfile::tempdir().unwrap();
            let root = temp_dir.path().canonicalize().unwrap();
            fs::write(
                root.join("main.tex"),
                "\\documentclass{article}\n\\begin{document}\nHello \\LaTeX{} Studio.\n\\end{document}\n",
            )
            .unwrap();
            root
        };
        let state = AppState::new();
        let settings = CompileSettings::default();
        let result = compile(&root, &external_main, "tectonic", &settings, &state)
            .await
            .unwrap();
        assert!(
            result.success,
            "compile failed:\n{}\n{:?}",
            result.logs, result.diagnostics
        );
        assert!(project_last_pdf_path(&root).is_file());
        assert!(result.pdf_path.is_some());
        let synctex_path = project_last_synctex_path(&root);
        assert!(synctex_path.is_file(), "SyncTeX data was not preserved");
        let sync_data = crate::synctex::load(&root).unwrap();
        assert!(!sync_data.entries.is_empty());
        assert!(sync_data.page_count >= 1);
    }
}
