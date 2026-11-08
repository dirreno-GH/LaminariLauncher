use serde::Serialize;

#[derive(Serialize)]
struct LauncherStatus {
    name: &'static str,
    version: &'static str,
    ready: bool,
}

#[tauri::command]
fn launcher_status() -> LauncherStatus {
    LauncherStatus {
        name: "Laminari Launcher",
        version: env!("CARGO_PKG_VERSION"),
        ready: true,
    }
}

#[tauri::command]
fn import_placeholder() -> String {
    "Кнопка уже связана с Rust. Выбор папки .minecraft добавим следующим этапом.".to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            launcher_status,
            import_placeholder
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Laminari Launcher");
}
