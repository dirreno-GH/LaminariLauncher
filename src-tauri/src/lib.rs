use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use reqwest::header::{HeaderValue, CONTENT_TYPE, COOKIE, SET_COOKIE};
use reqwest::{Client, StatusCode, Url};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::sync::{Mutex, OnceLock};
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use tauri_plugin_dialog::DialogExt;

const API_BASE: &str = "https://laminari-client.laminari.workers.dev";
const SESSION_COOKIE_NAME: &str = "__Host-laminari_session";

static SESSION_COOKIE: OnceLock<Mutex<Option<String>>> = OnceLock::new();

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportedVersion {
    id: String,
    name: String,
    path: String,
    json_path: String,
    jar_path: Option<String>,
    inherits_from: Option<String>,
    loader: String,
    release_type: String,
    minecraft_version: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GameEnvironment {
    path: String,
    mods_path: String,
    client_mod_installed: bool,
    fabric_api_installed: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LaunchResult {
    message: String,
    game_dir: String,
    profile_file: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateInfo {
    current_version: String,
    latest_version: String,
    available: bool,
    download_url: Option<String>,
}

#[derive(Serialize)]
struct LauncherStatus {
    name: &'static str,
    version: &'static str,
    ready: bool,
}

fn session_store() -> &'static Mutex<Option<String>> {
    SESSION_COOKIE.get_or_init(|| Mutex::new(None))
}

fn client() -> Result<Client, String> {
    Client::builder()
        .user_agent("LaminariLauncher/0.4")
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| format!("Не удалось создать сетевой клиент: {error}"))
}

fn validate_api_path(path: &str) -> Result<(), String> {
    if !path.starts_with("/api/") || path.contains("://") || path.contains("..") {
        return Err("Недопустимый путь API".to_string());
    }
    Ok(())
}

fn current_cookie() -> Result<String, String> {
    session_store()
        .lock()
        .map_err(|_| "Не удалось прочитать сессию".to_string())?
        .clone()
        .ok_or_else(|| "Сначала войди в аккаунт".to_string())
}

fn clear_cookie() {
    if let Ok(mut guard) = session_store().lock() {
        *guard = None;
    }
}

fn store_cookie_from_response(response: &reqwest::Response) -> Result<(), String> {
    let cookie_header = response
        .headers()
        .get_all(SET_COOKIE)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .find(|value| value.starts_with(SESSION_COOKIE_NAME))
        .ok_or_else(|| "Сервер не вернул сессию".to_string())?;

    let cookie_pair = cookie_header
        .split(';')
        .next()
        .ok_or_else(|| "Некорректная сессия сервера".to_string())?
        .to_string();

    let mut guard = session_store()
        .lock()
        .map_err(|_| "Не удалось сохранить сессию".to_string())?;

    *guard = Some(cookie_pair);
    Ok(())
}

fn append_query(url: &mut Url, query: &Value) {
    if let Some(object) = query.as_object() {
        let mut pairs = url.query_pairs_mut();
        for (key, value) in object {
            if value.is_null() {
                continue;
            }
            let text = value
                .as_str()
                .map(ToString::to_string)
                .unwrap_or_else(|| value.to_string());
            pairs.append_pair(key, &text);
        }
    }
}

fn api_url(path: &str, query: &Value) -> Result<Url, String> {
    validate_api_path(path)?;
    let mut url = Url::parse(&format!("{API_BASE}{path}"))
        .map_err(|error| format!("Некорректный адрес API: {error}"))?;
    append_query(&mut url, query);
    Ok(url)
}

async fn parse_json_response(response: reqwest::Response) -> Result<Value, String> {
    let status = response.status();
    let payload = response
        .json::<Value>()
        .await
        .map_err(|_| format!("Сервер вернул ответ без JSON ({status})"))?;

    if !status.is_success() || payload.get("ok").and_then(Value::as_bool) == Some(false) {
        let error = payload
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("Ошибка сервера Laminari");
        return Err(error.to_string());
    }

    Ok(payload)
}

async fn authenticated_get(path: &str, query: Value) -> Result<Value, String> {
    let cookie = current_cookie()?;
    let response = client()?
        .get(api_url(path, &query)?)
        .header(COOKIE, cookie)
        .send()
        .await
        .map_err(|error| format!("Нет соединения с Laminari: {error}"))?;

    if response.status() == StatusCode::UNAUTHORIZED {
        clear_cookie();
    }

    parse_json_response(response).await
}

async fn authenticated_post(path: &str, body: Value) -> Result<Value, String> {
    validate_api_path(path)?;
    let cookie = current_cookie()?;
    let response = client()?
        .post(format!("{API_BASE}{path}"))
        .header(COOKIE, cookie)
        .json(&body)
        .send()
        .await
        .map_err(|error| format!("Нет соединения с Laminari: {error}"))?;

    if response.status() == StatusCode::UNAUTHORIZED {
        clear_cookie();
    }

    parse_json_response(response).await
}

#[tauri::command]
fn launcher_status() -> LauncherStatus {
    LauncherStatus {
        name: "Laminari Launcher",
        version: env!("CARGO_PKG_VERSION"),
        ready: true,
    }
}

fn find_version_json(folder: &PathBuf) -> Result<PathBuf, String> {
    let folder_name = folder
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default();

    let expected = folder.join(format!("{folder_name}.json"));
    if expected.is_file() {
        return Ok(expected);
    }

    let entries = fs::read_dir(folder)
        .map_err(|error| format!("Не удалось прочитать папку версии: {error}"))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) == Some("json") {
            return Ok(path);
        }
    }

    Err("В выбранной папке нет JSON-файла версии Minecraft.".to_string())
}

fn find_version_jar(folder: &PathBuf, id: &str) -> Option<PathBuf> {
    let expected = folder.join(format!("{id}.jar"));
    if expected.is_file() {
        return Some(expected);
    }

    let entries = fs::read_dir(folder).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) == Some("jar") {
            return Some(path);
        }
    }

    None
}

fn detect_minecraft_version(version_id: &str, data: &Value) -> String {
    if let Some(base) = data.get("inheritsFrom").and_then(Value::as_str) {
        return base.to_string();
    }

    if version_id.contains("1.21.11") {
        return "1.21.11".to_string();
    }

    version_id.to_string()
}

fn detect_loader(version_id: &str, data: &Value) -> String {
    let mut haystack = version_id.to_lowercase();

    if let Some(libraries) = data.get("libraries").and_then(Value::as_array) {
        for library in libraries {
            if let Some(name) = library.get("name").and_then(Value::as_str) {
                haystack.push(' ');
                haystack.push_str(&name.to_lowercase());
            }
        }
    }

    if haystack.contains("neoforge") {
        "NeoForge".to_string()
    } else if haystack.contains("fabric-loader") || haystack.contains("fabricmc") {
        "Fabric".to_string()
    } else if haystack.contains("quilt-loader") || haystack.contains("quiltmc") {
        "Quilt".to_string()
    } else if haystack.contains("forge") {
        "Forge".to_string()
    } else {
        "Vanilla".to_string()
    }
}

#[tauri::command]
async fn import_minecraft_version(app: tauri::AppHandle) -> Result<Option<ImportedVersion>, String> {
    let selected = app
        .dialog()
        .file()
        .set_title("Выбери папку версии Minecraft")
        .blocking_pick_folder();

    let Some(selected) = selected else {
        return Ok(None);
    };

    let folder = selected
        .into_path()
        .map_err(|_| "Не удалось получить путь выбранной папки.".to_string())?;

    if !folder.is_dir() {
        return Err("Выбранный путь не является папкой.".to_string());
    }

    let json_path = find_version_json(&folder)?;
    let json_text = fs::read_to_string(&json_path)
        .map_err(|error| format!("Не удалось прочитать JSON версии: {error}"))?;
    let data: Value = serde_json::from_str(&json_text)
        .map_err(|error| format!("JSON версии повреждён: {error}"))?;

    let looks_like_version = data.get("id").is_some()
        || data.get("mainClass").is_some()
        || data.get("inheritsFrom").is_some()
        || data.get("libraries").is_some();

    if !looks_like_version {
        return Err("Эта папка не похожа на версию Minecraft.".to_string());
    }

    let folder_name = folder
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("Minecraft")
        .to_string();

    let id = data
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or(&folder_name)
        .to_string();

    let name = if id.trim().is_empty() {
        folder_name.clone()
    } else {
        id.clone()
    };

    let inherits_from = data
        .get("inheritsFrom")
        .and_then(Value::as_str)
        .map(ToString::to_string);

    let release_type = data
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or("release")
        .to_string();

    let jar_path = find_version_jar(&folder, &id)
        .map(|path| path.to_string_lossy().to_string());

    let loader = detect_loader(&id, &data);
    let minecraft_version = detect_minecraft_version(&id, &data);

    Ok(Some(ImportedVersion {
        id,
        name,
        path: folder.to_string_lossy().to_string(),
        json_path: json_path.to_string_lossy().to_string(),
        jar_path,
        inherits_from,
        loader,
        release_type,
        minecraft_version,
    }))
}

fn laminari_game_dir() -> Result<PathBuf, String> {
    let appdata = std::env::var_os("APPDATA")
        .ok_or_else(|| "Windows APPDATA не найден.".to_string())?;

    Ok(PathBuf::from(appdata)
        .join("LaminariLauncher")
        .join("game")
        .join("fabric-1.21.11"))
}

fn ensure_game_directories() -> Result<PathBuf, String> {
    let root = laminari_game_dir()?;

    for folder in [
        "mods",
        "config",
        "resourcepacks",
        "shaderpacks",
        "saves",
        "screenshots",
        "logs",
        "crash-reports",
    ] {
        fs::create_dir_all(root.join(folder))
            .map_err(|error| format!("Не удалось создать папку {folder}: {error}"))?;
    }

    Ok(root)
}

fn mod_exists(mods: &PathBuf, prefix: &str) -> bool {
    fs::read_dir(mods)
        .ok()
        .into_iter()
        .flatten()
        .flatten()
        .any(|entry| {
            entry
                .file_name()
                .to_str()
                .map(|name| name.starts_with(prefix) && name.ends_with(".jar"))
                .unwrap_or(false)
        })
}

fn remove_old_mods(mods: &PathBuf, prefix: &str) {
    if let Ok(entries) = fs::read_dir(mods) {
        for entry in entries.flatten() {
            let path = entry.path();
            let remove = path
                .file_name()
                .and_then(|value| value.to_str())
                .map(|name| name.starts_with(prefix) && name.ends_with(".jar"))
                .unwrap_or(false);

            if remove {
                let _ = fs::remove_file(path);
            }
        }
    }
}

async fn download_jar(url: &str, cookie: Option<String>) -> Result<Vec<u8>, String> {
    let mut request = client()?.get(url);

    if let Some(cookie) = cookie {
        request = request.header(COOKIE, cookie);
    }

    let response = request
        .send()
        .await
        .map_err(|error| format!("Ошибка скачивания: {error}"))?;

    if !response.status().is_success() {
        return Err(format!("Сервер вернул ошибку {}", response.status()));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("Не удалось прочитать JAR: {error}"))?
        .to_vec();

    if bytes.len() < 4 || bytes[0..4] != [0x50, 0x4b, 0x03, 0x04] {
        return Err("Скачанный файл не является корректным JAR.".to_string());
    }

    Ok(bytes)
}

#[tauri::command]
fn game_environment() -> Result<GameEnvironment, String> {
    let root = ensure_game_directories()?;
    let mods = root.join("mods");

    Ok(GameEnvironment {
        path: root.to_string_lossy().to_string(),
        mods_path: mods.to_string_lossy().to_string(),
        client_mod_installed: mod_exists(&mods, "LaminariClient"),
        fabric_api_installed: mod_exists(&mods, "fabric-api"),
    })
}

#[tauri::command]
async fn download_client_mod() -> Result<GameEnvironment, String> {
    const FABRIC_API_URL: &str = "https://maven.fabricmc.net/net/fabricmc/fabric-api/fabric-api/0.141.6+1.21.11/fabric-api-0.141.6+1.21.11.jar";

    let root = ensure_game_directories()?;
    let mods = root.join("mods");
    let cookie = current_cookie()?;

    let client_bytes = download_jar(
        &format!("{API_BASE}/download/beta"),
        Some(cookie),
    )
    .await?;

    let fabric_api_bytes = download_jar(FABRIC_API_URL, None).await?;

    remove_old_mods(&mods, "LaminariClient");
    remove_old_mods(&mods, "fabric-api");

    fs::write(mods.join("LaminariClient-BETA.jar"), client_bytes)
        .map_err(|error| format!("Не удалось сохранить Laminari Client: {error}"))?;

    fs::write(
        mods.join("fabric-api-0.141.6+1.21.11.jar"),
        fabric_api_bytes,
    )
    .map_err(|error| format!("Не удалось сохранить Fabric API: {error}"))?;

    game_environment()
}

#[tauri::command]
fn open_game_folder() -> Result<(), String> {
    let root = ensure_game_directories()?;

    Command::new("explorer.exe")
        .arg(&root)
        .spawn()
        .map_err(|error| format!("Не удалось открыть папку игры: {error}"))?;

    Ok(())
}

fn minecraft_root_from_version(version_path: &str) -> Result<PathBuf, String> {
    let version_dir = PathBuf::from(version_path);
    let versions_dir = version_dir
        .parent()
        .ok_or_else(|| "Не удалось определить папку versions.".to_string())?;

    versions_dir
        .parent()
        .map(PathBuf::from)
        .ok_or_else(|| "Не удалось определить корень .minecraft.".to_string())
}

fn launcher_profile_path(root: &PathBuf) -> Result<PathBuf, String> {
    let normal = root.join("launcher_profiles.json");
    if normal.is_file() {
        return Ok(normal);
    }

    let store = root.join("launcher_profiles_microsoft_store.json");
    if store.is_file() {
        return Ok(store);
    }

    Err("Не найден профиль официального Minecraft Launcher. Открой официальный лаунчер и войди в Microsoft-аккаунт хотя бы один раз.".to_string())
}

fn write_laminari_launcher_profile(
    profile_path: &PathBuf,
    version_id: &str,
    game_dir: &PathBuf,
) -> Result<(), String> {
    let text = fs::read_to_string(profile_path)
        .map_err(|error| format!("Не удалось прочитать профиль Minecraft Launcher: {error}"))?;

    let mut root: Value = serde_json::from_str(&text)
        .map_err(|error| format!("Профиль Minecraft Launcher повреждён: {error}"))?;

    if !root.is_object() {
        return Err("Некорректный launcher_profiles JSON.".to_string());
    }

    let backup = profile_path.with_extension("json.laminari.bak");
    if !backup.exists() {
        let _ = fs::copy(profile_path, &backup);
    }

    let object = root
        .as_object_mut()
        .ok_or_else(|| "Некорректный launcher_profiles JSON.".to_string())?;

    let profiles = object
        .entry("profiles")
        .or_insert_with(|| json!({}));

    let profiles_object = profiles
        .as_object_mut()
        .ok_or_else(|| "Поле profiles в launcher_profiles повреждено.".to_string())?;

    profiles_object.insert(
        "laminari-client-1-21-11".to_string(),
        json!({
            "name": "Laminari Client",
            "type": "custom",
            "lastVersionId": version_id,
            "gameDir": game_dir.to_string_lossy().to_string()
        }),
    );

    object.insert(
        "selectedProfile".to_string(),
        Value::String("laminari-client-1-21-11".to_string()),
    );

    let output = serde_json::to_string_pretty(&root)
        .map_err(|error| format!("Не удалось сохранить профиль лаунчера: {error}"))?;

    fs::write(profile_path, output)
        .map_err(|error| format!("Не удалось обновить профиль Minecraft Launcher: {error}"))?;

    Ok(())
}

#[tauri::command]
fn launch_fabric_client(
    version_id: String,
    version_path: String,
    minecraft_version: String,
    loader: String,
) -> Result<LaunchResult, String> {
    if loader != "Fabric" || minecraft_version != "1.21.11" {
        return Err("Laminari Client запускается только на Fabric 1.21.11.".to_string());
    }

    let root = ensure_game_directories()?;
    let mods = root.join("mods");

    if !mod_exists(&mods, "LaminariClient") || !mod_exists(&mods, "fabric-api") {
        return Err("Сначала установи Laminari Client кнопкой «Скачать мод».".to_string());
    }

    let minecraft_root = minecraft_root_from_version(&version_path)?;
    let profile_path = launcher_profile_path(&minecraft_root)?;

    write_laminari_launcher_profile(&profile_path, &version_id, &root)?;

    Command::new("cmd")
        .args(["/C", "start", "", "minecraft://"])
        .spawn()
        .map_err(|error| format!("Не удалось открыть Minecraft Launcher: {error}"))?;

    Ok(LaunchResult {
        message: "Профиль Laminari Client подготовлен и официальный Minecraft Launcher открыт. Для запуска используется только Fabric 1.21.11.".to_string(),
        game_dir: root.to_string_lossy().to_string(),
        profile_file: profile_path.to_string_lossy().to_string(),
    })
}

fn version_parts(version: &str) -> Vec<u64> {
    version
        .trim_start_matches('v')
        .split('.')
        .map(|part| {
            part.chars()
                .take_while(|ch| ch.is_ascii_digit())
                .collect::<String>()
                .parse::<u64>()
                .unwrap_or(0)
        })
        .collect()
}

fn version_is_newer(latest: &str, current: &str) -> bool {
    let mut latest_parts = version_parts(latest);
    let mut current_parts = version_parts(current);
    let length = latest_parts.len().max(current_parts.len());

    latest_parts.resize(length, 0);
    current_parts.resize(length, 0);

    latest_parts > current_parts
}

#[tauri::command]
async fn check_for_updates() -> Result<UpdateInfo, String> {
    const RELEASE_API: &str = "https://api.github.com/repos/dirreno-GH/LaminariLauncher/releases/latest";
    const ASSET_NAME: &str = "LaminariLauncher.exe";

    let response = client()?
        .get(RELEASE_API)
        .send()
        .await
        .map_err(|error| format!("Не удалось проверить обновления: {error}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "GitHub вернул ошибку при проверке обновлений: {}",
            response.status()
        ));
    }

    let release = response
        .json::<Value>()
        .await
        .map_err(|error| format!("Не удалось прочитать данные обновления: {error}"))?;

    let latest_version = release
        .get("tag_name")
        .and_then(Value::as_str)
        .unwrap_or(env!("CARGO_PKG_VERSION"))
        .trim_start_matches('v')
        .to_string();

    let download_url = release
        .get("assets")
        .and_then(Value::as_array)
        .and_then(|assets| {
            assets.iter().find_map(|asset| {
                let name = asset.get("name").and_then(Value::as_str)?;
                if name != ASSET_NAME {
                    return None;
                }
                asset
                    .get("browser_download_url")
                    .and_then(Value::as_str)
                    .map(ToString::to_string)
            })
        });

    let current_version = env!("CARGO_PKG_VERSION").to_string();
    let available = version_is_newer(&latest_version, &current_version) && download_url.is_some();

    Ok(UpdateInfo {
        current_version,
        latest_version,
        available,
        download_url,
    })
}

fn escape_powershell_single_quoted(value: &str) -> String {
    value.replace('\'', "''")
}

#[tauri::command]
async fn install_launcher_update(download_url: String) -> Result<(), String> {
    const ALLOWED_PREFIX: &str =
        "https://github.com/dirreno-GH/LaminariLauncher/releases/download/";

    if !download_url.starts_with(ALLOWED_PREFIX)
        || !download_url.ends_with("/LaminariLauncher.exe")
    {
        return Err("Источник обновления не прошёл проверку.".to_string());
    }

    let response = client()?
        .get(&download_url)
        .send()
        .await
        .map_err(|error| format!("Не удалось скачать обновление: {error}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "GitHub вернул ошибку при скачивании: {}",
            response.status()
        ));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("Не удалось прочитать обновление: {error}"))?;

    if bytes.len() < 1024 * 1024 || bytes.get(0..2) != Some(&[0x4d, 0x5a]) {
        return Err("Скачанный файл не похож на Windows EXE.".to_string());
    }

    let current_exe = std::env::current_exe()
        .map_err(|error| format!("Не удалось определить текущий EXE: {error}"))?;

    let parent = current_exe
        .parent()
        .ok_or_else(|| "Не удалось определить папку лаунчера.".to_string())?;

    let update_exe = parent.join("LaminariLauncher.update.exe");

    fs::write(&update_exe, &bytes)
        .map_err(|error| format!("Не удалось сохранить обновление: {error}"))?;

    let pid = std::process::id();
    let temp_dir = std::env::temp_dir();
    let script_path = temp_dir.join(format!("laminari-update-{pid}.ps1"));

    let script = format!(
        "$ErrorActionPreference='Stop'\n\
         Wait-Process -Id {pid} -ErrorAction SilentlyContinue\n\
         Start-Sleep -Milliseconds 350\n\
         Copy-Item -LiteralPath '{}' -Destination '{}' -Force\n\
         Start-Process -FilePath '{}'\n\
         Remove-Item -LiteralPath '{}' -Force -ErrorAction SilentlyContinue\n\
         Remove-Item -LiteralPath $MyInvocation.MyCommand.Path -Force -ErrorAction SilentlyContinue\n",
        escape_powershell_single_quoted(&update_exe.to_string_lossy()),
        escape_powershell_single_quoted(&current_exe.to_string_lossy()),
        escape_powershell_single_quoted(&current_exe.to_string_lossy()),
        escape_powershell_single_quoted(&update_exe.to_string_lossy()),
    );

    fs::write(&script_path, script)
        .map_err(|error| format!("Не удалось подготовить установщик обновления: {error}"))?;

    let mut command = Command::new("powershell.exe");
    command
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
        ])
        .arg(&script_path);

    #[cfg(target_os = "windows")]
    command.creation_flags(0x08000000);

    command
        .spawn()
        .map_err(|error| format!("Не удалось запустить установку обновления: {error}"))?;

    Ok(())
}

#[tauri::command]
async fn auth_login(username: String, password: String, totp: Option<String>) -> Result<Value, String> {
    let response = client()?
        .post(format!("{API_BASE}/api/login"))
        .json(&json!({
            "username": username,
            "password": password,
            "totp": totp.unwrap_or_default()
        }))
        .send()
        .await
        .map_err(|error| format!("Не удалось подключиться к Laminari: {error}"))?;

    if response.status() != StatusCode::OK {
        return parse_json_response(response).await;
    }

    store_cookie_from_response(&response)?;
    parse_json_response(response).await
}

#[tauri::command]
async fn auth_register(email: String, username: String, password: String) -> Result<Value, String> {
    let response = client()?
        .post(format!("{API_BASE}/api/register"))
        .json(&json!({
            "email": email,
            "username": username,
            "password": password,
            "consent": "on"
        }))
        .send()
        .await
        .map_err(|error| format!("Не удалось подключиться к Laminari: {error}"))?;

    if response.status() != StatusCode::CREATED {
        return parse_json_response(response).await;
    }

    store_cookie_from_response(&response)?;
    parse_json_response(response).await
}

#[tauri::command]
async fn auth_logout() -> Result<Value, String> {
    if let Ok(cookie) = current_cookie() {
        let _ = client()?
            .post(format!("{API_BASE}/api/logout"))
            .header(COOKIE, cookie)
            .send()
            .await;
    }

    clear_cookie();
    Ok(json!({ "ok": true }))
}

#[tauri::command]
async fn account_me() -> Result<Value, String> {
    authenticated_get("/api/me", json!({})).await
}

#[tauri::command]
async fn account_profile() -> Result<Value, String> {
    authenticated_get("/api/messenger/settings", json!({})).await
}

#[tauri::command]
async fn account_save_profile(
    status: String,
    bio: String,
    frame_style: String,
    privacy_messages: String,
    privacy_requests: String,
) -> Result<Value, String> {
    authenticated_post(
        "/api/messenger/settings",
        json!({
            "status": status,
            "bio": bio,
            "frameStyle": frame_style,
            "privacyMessages": privacy_messages,
            "privacyRequests": privacy_requests
        }),
    )
    .await
}

#[tauri::command]
async fn account_friends() -> Result<Value, String> {
    authenticated_get("/api/messenger/friends", json!({})).await
}

#[tauri::command]
async fn account_search_users(query: String) -> Result<Value, String> {
    authenticated_get("/api/messenger/search", json!({ "q": query })).await
}

#[tauri::command]
async fn account_send_friend_request(target_id: String) -> Result<Value, String> {
    authenticated_post("/api/messenger/request", json!({ "targetId": target_id })).await
}

#[tauri::command]
async fn api_get(path: String, query: Value) -> Result<Value, String> {
    authenticated_get(&path, query).await
}

#[tauri::command]
async fn api_post(path: String, body: Value) -> Result<Value, String> {
    authenticated_post(&path, body).await
}

#[tauri::command]
async fn api_get_text(path: String, query: Value) -> Result<String, String> {
    let cookie = current_cookie()?;
    let response = client()?
        .get(api_url(&path, &query)?)
        .header(COOKIE, cookie)
        .send()
        .await
        .map_err(|error| format!("Нет соединения с Laminari: {error}"))?;

    if !response.status().is_success() {
        return Err(format!("Сервер вернул ошибку {}", response.status()));
    }

    response
        .text()
        .await
        .map_err(|error| format!("Не удалось прочитать ответ: {error}"))
}

#[tauri::command]
async fn api_upload(
    path: String,
    query: Value,
    content_type: String,
    file_name: String,
    bytes: Vec<u8>,
) -> Result<Value, String> {
    validate_api_path(&path)?;

    let allowed = [
        "/api/profile/avatar",
        "/api/messenger/attachment",
        "/api/social/sticker-upload",
        "/api/social/emoji-upload",
    ];

    if !allowed.iter().any(|item| *item == path) {
        return Err("Загрузка в этот API запрещена лаунчером".to_string());
    }

    let cookie = current_cookie()?;
    let mut request = client()?
        .post(api_url(&path, &query)?)
        .header(COOKIE, cookie)
        .header(CONTENT_TYPE, content_type)
        .body(bytes);

    let safe_header = HeaderValue::from_str(&file_name)
        .unwrap_or_else(|_| HeaderValue::from_static("file"));
    request = request.header("X-File-Name", safe_header);

    let response = request
        .send()
        .await
        .map_err(|error| format!("Не удалось загрузить файл: {error}"))?;

    parse_json_response(response).await
}

#[tauri::command]
async fn api_media(path: String, query: Option<Value>) -> Result<Value, String> {
    validate_api_path(&path)?;

    let allowed = [
        "/api/avatar/",
        "/api/messenger/media/",
        "/api/social/sticker-media/",
        "/api/social/emoji-media/",
        "/api/social/group-media/",
        "/api/social/qr",
    ];

    if !allowed.iter().any(|prefix| path.starts_with(prefix)) {
        return Err("Недопустимый media API".to_string());
    }

    let cookie = current_cookie()?;
    let response = client()?
        .get(api_url(&path, &query.unwrap_or_else(|| json!({})))?)
        .header(COOKIE, cookie)
        .send()
        .await
        .map_err(|error| format!("Не удалось загрузить медиа: {error}"))?;

    if !response.status().is_success() {
        return Err(format!("Медиа недоступно ({})", response.status()));
    }

    let mime = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("application/octet-stream")
        .to_string();

    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("Не удалось прочитать медиа: {error}"))?;

    Ok(json!({
        "mime": mime,
        "data": BASE64.encode(bytes)
    }))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            launcher_status,
            import_minecraft_version,
            game_environment,
            download_client_mod,
            open_game_folder,
            launch_fabric_client,
            check_for_updates,
            install_launcher_update,
            auth_login,
            auth_register,
            auth_logout,
            account_me,
            account_profile,
            account_save_profile,
            account_friends,
            account_search_users,
            account_send_friend_request,
            api_get,
            api_post,
            api_get_text,
            api_upload,
            api_media
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Laminari Launcher");
}
