use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager, WindowEvent};
use std::{
    collections::{HashMap, HashSet},
    env,
    fs,
    path::{Path, PathBuf},
    process::Command,
};
use std::os::unix::fs::PermissionsExt;
use base64::{engine::general_purpose, Engine as _};

#[derive(Debug, Serialize, Deserialize, Clone)]
struct AppConfig {
    items: Vec<ConfigItem>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct ConfigItem {
    label: String,
    command: String,
    icon: Option<String>,
}

fn xdg_config_home() -> Result<PathBuf, String> {
    if let Ok(dir) = env::var("XDG_CONFIG_HOME") {
        if !dir.trim().is_empty() {
            return Ok(PathBuf::from(dir));
        }
    }

    let home = env::var("HOME").map_err(|_| "HOME is not set".to_string())?;
    Ok(PathBuf::from(home).join(".config"))
}

fn config_dir() -> Result<PathBuf, String> {
    Ok(xdg_config_home()?.join("binpick"))
}

fn default_config() -> AppConfig {
    AppConfig { items: Vec::new() }
}

fn ensure_config_dir() -> Result<PathBuf, String> {
    let dir = config_dir()?;
    fs::create_dir_all(&dir).map_err(|err| format!("create config dir: {err}"))?;
    Ok(dir)
}

fn ensure_config_file(config_dir: &Path) -> Result<PathBuf, String> {
    let config_path = config_dir.join("config.json");
    if !config_path.exists() {
        let data = serde_json::to_string_pretty(&default_config())
            .map_err(|err| format!("serialize config: {err}"))?;
        fs::write(&config_path, data).map_err(|err| format!("write config: {err}"))?;
    }
    Ok(config_path)
}

fn config_cache_path(config_dir: &Path) -> PathBuf {
    config_dir.join("items-cache.json")
}

fn read_config_cache(config_dir: &Path) -> Option<AppConfig> {
    let cache_path = config_cache_path(config_dir);
    let raw = fs::read_to_string(cache_path).ok()?;
    serde_json::from_str(&raw).ok()
}

fn write_config_cache(config_dir: &Path, config: &AppConfig) -> Result<(), String> {
    let cache_path = config_cache_path(config_dir);
    let data = serde_json::to_string(config).map_err(|err| format!("serialize cache: {err}"))?;
    fs::write(cache_path, data).map_err(|err| format!("write cache: {err}"))
}

fn desktop_icon_map() -> HashMap<String, String> {
    let mut map = HashMap::new();
    let mut dirs = Vec::new();

    if let Ok(data_home) = env::var("XDG_DATA_HOME") {
        if !data_home.trim().is_empty() {
            dirs.push(PathBuf::from(data_home));
        }
    }

    if let Ok(home) = env::var("HOME") {
        dirs.push(PathBuf::from(home).join(".local/share"));
    }

    dirs.push(PathBuf::from("/usr/local/share"));
    dirs.push(PathBuf::from("/usr/share"));

    for dir in dirs {
        let applications = dir.join("applications");
        let entries = match fs::read_dir(applications) {
            Ok(entries) => entries,
            Err(_) => continue,
        };

        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|ext| ext.to_str()) != Some("desktop") {
                continue;
            }
            let contents = match fs::read_to_string(&path) {
                Ok(contents) => contents,
                Err(_) => continue,
            };

            if let Some((exec, icon)) = parse_desktop_entry(&contents) {
                if let Some(command) = extract_exec_command(&exec) {
                    if let Some(icon_path) = resolve_icon_path(&icon) {
                        map.entry(command).or_insert(icon_path);
                    }
                }
            }
        }
    }

    map
}

fn parse_desktop_entry(contents: &str) -> Option<(String, String)> {
    let mut in_entry = false;
    let mut exec = None;
    let mut icon = None;
    let mut entry_type = None;
    let mut hidden = false;
    let mut no_display = false;

    for line in contents.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if line.starts_with('[') && line.ends_with(']') {
            in_entry = line == "[Desktop Entry]";
            continue;
        }
        if !in_entry {
            continue;
        }

        let mut parts = line.splitn(2, '=');
        let key = parts.next()?.trim();
        let value = parts.next().unwrap_or("").trim();

        match key {
            "Type" => entry_type = Some(value.to_string()),
            "Exec" => exec = Some(value.to_string()),
            "Icon" => icon = Some(value.to_string()),
            "Hidden" => hidden = value.eq_ignore_ascii_case("true"),
            "NoDisplay" => no_display = value.eq_ignore_ascii_case("true"),
            _ => {}
        }
    }

    if hidden || no_display {
        return None;
    }
    if entry_type.as_deref() != Some("Application") {
        return None;
    }

    match (exec, icon) {
        (Some(exec), Some(icon)) => Some((exec, icon)),
        _ => None,
    }
}

fn extract_exec_command(exec: &str) -> Option<String> {
    let token = exec
        .split_whitespace()
        .next()
        .map(|value| value.trim_matches('"'))?;
    let path = Path::new(token);
    path.file_name()
        .and_then(|name| name.to_str())
        .map(|value| value.to_string())
}

fn resolve_icon_path(icon: &str) -> Option<String> {
    let icon_path = Path::new(icon);
    if icon_path.is_absolute() && icon_path.exists() {
        return Some(icon.to_string());
    }

    let mut bases = Vec::new();
    if let Ok(data_home) = env::var("XDG_DATA_HOME") {
        if !data_home.trim().is_empty() {
            bases.push(PathBuf::from(data_home));
        }
    }
    if let Ok(home) = env::var("HOME") {
        bases.push(PathBuf::from(home).join(".local/share"));
    }
    bases.push(PathBuf::from("/usr/local/share"));
    bases.push(PathBuf::from("/usr/share"));

    let mut names = Vec::new();
    if icon.ends_with(".png") || icon.ends_with(".svg") || icon.ends_with(".xpm") {
        names.push(icon.to_string());
    } else {
        names.push(format!("{icon}.png"));
        names.push(format!("{icon}.svg"));
        names.push(format!("{icon}.xpm"));
    }

    for base in &bases {
        for name in &names {
            let candidate = base.join("pixmaps").join(name);
            if candidate.exists() {
                return Some(candidate.to_string_lossy().to_string());
            }
        }
    }

    let sizes = ["256x256", "128x128", "64x64", "48x48", "32x32", "scalable"];
    for base in &bases {
        let icons_dir = base.join("icons");
        let themes = match fs::read_dir(&icons_dir) {
            Ok(entries) => entries,
            Err(_) => continue,
        };

        for theme in themes.flatten() {
            let theme_path = theme.path();
            if !theme_path.is_dir() {
                continue;
            }
            for size in sizes {
                for name in &names {
                    let candidate = theme_path.join(size).join("apps").join(name);
                    if candidate.exists() {
                        return Some(candidate.to_string_lossy().to_string());
                    }
                }
            }
        }
    }

    None
}

fn mime_for_path(path: &Path) -> &'static str {
    match path.extension().and_then(|ext| ext.to_str()) {
        Some("png") => "image/png",
        Some("svg") => "image/svg+xml",
        Some("xpm") => "image/x-xpixmap",
        _ => "application/octet-stream",
    }
}

fn path_items(icon_map: &HashMap<String, String>) -> Vec<ConfigItem> {
    let mut seen = HashSet::new();
    let mut items = Vec::new();
    let path_var = env::var("PATH").unwrap_or_default();

    for dir in env::split_paths(&path_var) {
        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if !path.is_file() {
                    continue;
                }
                let name = match path.file_name().and_then(|value| value.to_str()) {
                    Some(value) => value.to_string(),
                    None => continue,
                };
                if !seen.insert(name.clone()) {
                    continue;
                }
                let executable = path
                    .metadata()
                    .map(|meta| meta.permissions().mode() & 0o111 != 0)
                    .unwrap_or(false);
                if !executable {
                    continue;
                }
                let icon = icon_map.get(&name).cloned();
                items.push(ConfigItem {
                    label: name.clone(),
                    command: name,
                    icon,
                });
            }
        }
    }

    items.sort_by(|a, b| a.label.cmp(&b.label));
    items
}

fn build_config() -> Result<AppConfig, String> {
    let dir = ensure_config_dir()?;
    let config_path = ensure_config_file(&dir)?;
    let raw = fs::read_to_string(config_path).map_err(|err| format!("read config: {err}"))?;
    let mut config: AppConfig =
        serde_json::from_str(&raw).map_err(|err| format!("parse config: {err}"))?;

    let icon_map = desktop_icon_map();
    let mut seen = HashSet::new();
    let mut merged = Vec::new();

    for item in path_items(&icon_map) {
        if seen.insert(item.command.clone()) {
            merged.push(item);
        }
    }

    for item in config.items.drain(..) {
        if seen.insert(item.command.clone()) {
            let mut merged_item = item;
            if merged_item.icon.is_none() {
                merged_item.icon = icon_map.get(&merged_item.command).cloned();
            }
            merged.push(merged_item);
        }
    }

    Ok(AppConfig { items: merged })
}

#[tauri::command]
fn get_config() -> Result<AppConfig, String> {
    let dir = ensure_config_dir()?;
    let _ = ensure_config_file(&dir)?;
    if let Some(config) = read_config_cache(&dir) {
        return Ok(config);
    }
    Ok(default_config())
}

#[tauri::command]
fn refresh_config(app: tauri::AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn(async move {
        let config = match build_config() {
            Ok(config) => config,
            Err(err) => {
                eprintln!("refresh_config failed: {err}");
                return;
            }
        };
        let dir = match ensure_config_dir() {
            Ok(dir) => dir,
            Err(err) => {
                eprintln!("refresh_config config dir failed: {err}");
                return;
            }
        };
        if let Err(err) = write_config_cache(&dir, &config) {
            eprintln!("refresh_config cache write failed: {err}");
        }
        let _ = app.emit("config_refreshed", config);
    });
    Ok(())
}

#[tauri::command]
fn get_icon_data(path: String) -> Result<String, String> {
    let path = PathBuf::from(path);
    let bytes = fs::read(&path).map_err(|err| format!("read icon: {err}"))?;
    let mime = mime_for_path(&path);
    let encoded = general_purpose::STANDARD.encode(bytes);
    Ok(format!("data:{};base64,{}", mime, encoded))
}

#[tauri::command]
fn get_config_dir() -> Result<String, String> {
    let dir = ensure_config_dir()?;
    Ok(dir.to_string_lossy().to_string())
}

#[tauri::command]
fn run_command(command: String) -> Result<(), String> {
    let command = command.trim();
    if command.is_empty() {
        return Err("command is empty".to_string());
    }

    // Use a shell so scripts without a shebang and shell features (quotes, env vars, newlines) work.
    Command::new("sh")
        .arg("-lc")
        .arg(command)
        .spawn()
        .map_err(|err| format!("spawn command: {err}"))?;
    Ok(())
}

#[tauri::command]
fn quit(app: tauri::AppHandle) {
    app.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = ensure_config_dir().and_then(|dir| ensure_config_file(&dir));
    let mut builder = tauri::Builder::default();
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            let Some(window) = app.get_webview_window("main") else {
                return;
            };
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
            let _ = window.emit("focus_input", ());
        }));
    }

    builder
        .setup(|app| {
            #[cfg(desktop)]
            {
                use tauri_plugin_global_shortcut::{
                    Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState,
                };

                let shortcut = if cfg!(target_os = "macos") {
                    Shortcut::new(Some(Modifiers::META), Code::Space)
                } else {
                    Shortcut::new(Some(Modifiers::CONTROL), Code::Space)
                };

                app.handle().plugin(
                    tauri_plugin_global_shortcut::Builder::new()
                        .with_handler(move |app, _, event| {
                            if event.state() != ShortcutState::Pressed {
                                return;
                            }
                            let Some(window) = app.get_webview_window("main") else {
                                return;
                            };
                            let is_visible = window.is_visible().unwrap_or(false);
                            if is_visible {
                                let _ = window.hide();
                                return;
                            }
                            let _ = window.show();
                            let _ = window.set_focus();
                            let _ = window.emit("focus_input", ());
                        })
                        .build(),
                )?;

                let _ = app.global_shortcut().register(shortcut);
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            get_config,
            refresh_config,
            get_icon_data,
            get_config_dir,
            run_command,
            quit
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
