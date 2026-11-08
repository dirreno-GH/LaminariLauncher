use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use reqwest::header::{HeaderValue, CONTENT_TYPE, COOKIE, SET_COOKIE};
use reqwest::{Client, StatusCode, Url};
use serde::Serialize;
use serde_json::{json, Map, Value};
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
