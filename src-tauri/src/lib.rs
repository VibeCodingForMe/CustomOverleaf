mod checkpoint;
mod commands;
mod compiler;
mod diagnostics;
mod doctor;
mod error;
mod export;
mod git;
mod indexer;
mod models;
mod project;
mod provision;
mod replace;
mod state;
mod synctex;
mod templates;
mod tools;
mod util;

use state::AppState;
use tauri::{
    menu::{Menu, MenuItemBuilder, PredefinedMenuItem, Submenu},
    Emitter, Manager,
};

fn build_app_menu<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<Menu<R>> {
    let undo = MenuItemBuilder::with_id("edit.undo", "Undo")
        .accelerator("CmdOrCtrl+Z")
        .build(app)?;
    let redo = MenuItemBuilder::with_id("edit.redo", "Redo")
        .accelerator("CmdOrCtrl+Shift+Z")
        .build(app)?;

    let app_menu = Submenu::with_items(
        app,
        "LaTeX Studio",
        true,
        &[
            &PredefinedMenuItem::about(app, None, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::show_all(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?;

    let edit_menu = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &undo,
            &redo,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;

    let view_menu = Submenu::with_items(
        app,
        "View",
        true,
        &[&PredefinedMenuItem::fullscreen(app, None)?],
    )?;

    let window_menu = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, None)?,
        ],
    )?;

    Menu::with_items(app, &[&app_menu, &edit_menu, &view_menu, &window_menu])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let state = AppState::new();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(state)
        .setup(|app| {
            let state = app.state::<AppState>();
            provision::provision(app.handle(), &state);
            let menu = build_app_menu(app.handle())?;
            app.handle().set_menu(menu)?;
            Ok(())
        })
        .on_menu_event(|app, event| {
            let id = event.id().as_ref();
            if id == "edit.undo" || id == "edit.redo" {
                let _ = app.emit("menu-action", id);
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_settings,
            commands::update_settings,
            commands::get_tools,
            commands::open_project,
            commands::refresh_project,
            commands::create_project,
            commands::remove_recent,
            commands::set_main_file,
            commands::read_project_file,
            commands::write_project_file,
            commands::create_project_file,
            commands::create_project_folder,
            commands::rename_project_path,
            commands::delete_project_path,
            commands::duplicate_project_path,
            commands::import_project_paths,
            commands::stat_project_file,
            commands::get_project_revision,
            commands::reveal_project_path,
            commands::reveal_project,
            commands::search_project,
            commands::preview_replace,
            commands::apply_replace,
            commands::get_project_index,
            commands::run_project_doctor,
            commands::compile_project,
            commands::cancel_compilation,
            commands::get_build_status,
            commands::get_last_pdf,
            commands::clean_project_build,
            commands::clean_project_aux,
            commands::suggest_diagnostic_fix,
            commands::backup_project_file,
            commands::path_exists,
            commands::export_project,
            commands::export_pandoc_project,
            commands::list_checkpoints,
            commands::create_checkpoint,
            commands::preview_checkpoint,
            commands::get_checkpoint_file_diff,
            commands::restore_checkpoint,
            commands::synctex_status,
            commands::forward_synctex,
            commands::reverse_synctex,
            commands::get_app_data_dir,
            commands::reveal_app_data_dir,
            commands::get_git_status,
            commands::get_git_diff,
            commands::stage_git_paths,
            commands::commit_git,
            commands::read_binary_base64,
            commands::report_frontend_error,
        ])
        .run(tauri::generate_context!())
        .expect("error while running LaTeX Studio");
}
