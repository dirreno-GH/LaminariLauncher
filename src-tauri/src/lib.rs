use reqwest::header::{COOKIE, SET_COOKIE};
use reqwest::{Client, StatusCode};
use serde::Serialize;
use serde_json::{json, Value};
use std::sync::{Mutex, OnceLock};

const API_BASE: &str = "https://laminari-client.laminari.workers.dev";
const SESSION_COOKIE_NAME: &str = "__Host-laminari_session";

static SESSION_COOKIE: OnceLock<Mutex<Option<String>>> = OnceLock::new();

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
        .user_agent("LaminariLauncher/0.3")
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| format!("Не удалось создать сетевой клиент: {error}"))
}

fn current_cookie() -> Result<String, String> {
    session_store()
        .lock()
        .map_err(|_| "Не удалось прочитать сессию".to_string())?
        .clone()
        .ok_or_else(|| "Сначала войди в аккаунт".to_string())
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

async fn authenticated_get(path: &str) -> Result<Value, String> {
    let cookie = current_cookie()?;
    let response = client()?
        .get(format!("{API_BASE}{path}"))
        .header(COOKIE, cookie)
        .send()
        .await
        .map_err(|error| format!("Нет соединения с Laminari: {error}"))?;

    parse_json_response(response).await
}

async fn authenticated_post(path: &str, body: Value) -> Result<Value, String> {
    let cookie = current_cookie()?;
    let response = client()?
        .post(format!("{API_BASE}{path}"))
        .header(COOKIE, cookie)
        .json(&body)
        .send()
        .await
        .map_err(|error| format!("Нет соединения с Laminari: {error}"))?;

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

#[tauri::command]
fn import_placeholder() -> String {
    "Кнопка уже связана с Rust. Выбор папки .minecraft добавим следующим этапом.".to_string()
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
    let cookie = current_cookie().ok();

    if let Some(cookie) = cookie {
        let _ = client()?
            .post(format!("{API_BASE}/api/logout"))
            .header(COOKIE, cookie)
            .send()
            .await;
    }

    let mut guard = session_store()
        .lock()
        .map_err(|_| "Не удалось очистить сессию".to_string())?;

    *guard = None;
    Ok(json!({ "ok": true }))
}

#[tauri::command]
async fn account_me() -> Result<Value, String> {
    authenticated_get("/api/me").await
}

#[tauri::command]
async fn account_profile() -> Result<Value, String> {
    authenticated_get("/api/messenger/settings").await
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
    authenticated_get("/api/messenger/friends").await
}

#[tauri::command]
async fn account_search_users(query: String) -> Result<Value, String> {
    let cookie = current_cookie()?;
    let mut url = reqwest::Url::parse(&format!("{API_BASE}/api/messenger/search"))
        .map_err(|error| format!("Некорректный адрес API: {error}"))?;

    url.query_pairs_mut().append_pair("q", &query);

    let response = client()?
        .get(url)
        .header(COOKIE, cookie)
        .send()
        .await
        .map_err(|error| format!("Нет соединения с Laminari: {error}"))?;

    parse_json_response(response).await
}

#[tauri::command]
async fn account_send_friend_request(target_id: String) -> Result<Value, String> {
    authenticated_post(
        "/api/messenger/request",
        json!({ "targetId": target_id }),
    )
    .await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            launcher_status,
            import_placeholder,
            auth_login,
            auth_register,
            auth_logout,
            account_me,
            account_profile,
            account_save_profile,
            account_friends,
            account_search_users,
            account_send_friend_request
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Laminari Launcher");
}
