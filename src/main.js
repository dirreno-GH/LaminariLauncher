const tauri = window.__TAURI__;
const invoke = tauri?.core?.invoke;
const currentWindow = tauri?.window?.getCurrentWindow ? tauri.window.getCurrentWindow() : null;

const ROLE_KEYS = [
  "novice","player","active_player","veteran","og","beta_tester","alpha_tester","qa_tester",
  "bug_hunter","idea_maker","contributor","supporter","trusted","vip","premium","legend","elite",
  "master","champion","laminari_pro","developer","lead_developer","frontend_developer",
  "backend_developer","client_developer","web_developer","designer","ui_designer","artist",
  "animator","content_creator","streamer","partner","community_manager","helper","support",
  "moderator","senior_moderator","head_moderator","administrator","senior_administrator",
  "head_administrator","manager","project_manager","staff","senior_staff","security","tiktok",
  "youtube","media"
];

const pages = {
  home: document.getElementById("home-page"),
  library: document.getElementById("library-page"),
  mods: document.getElementById("mods-page"),
  messenger: document.getElementById("messenger-page"),
  hub: document.getElementById("hub-page"),
  profile: document.getElementById("profile-page"),
  settings: document.getElementById("settings-page"),
};

const pageNames = {
  home: "Главная",
  library: "Библиотека",
  mods: "Моды",
  messenger: "Мессенджер",
  hub: "Laminari Hub",
  profile: "Профиль",
  settings: "Настройки",
};

const authGate = document.getElementById("auth-gate");
const authError = document.getElementById("auth-error");
const loginForm = document.getElementById("login-form");
const registerForm = document.getElementById("register-form");
const loginTab = document.getElementById("auth-login-tab");
const registerTab = document.getElementById("auth-register-tab");

const navItems = [...document.querySelectorAll(".nav-item")];
const pageTitle = document.getElementById("page-title");
const toast = document.getElementById("toast");
const toastTitle = document.getElementById("toast-title");
const toastMessage = document.getElementById("toast-message");
const backendStatus = document.getElementById("backend-status");
const runtimeVersion = document.getElementById("runtime-version");

const profileStatusInput = document.getElementById("profile-status-input");
const profileBioInput = document.getElementById("profile-bio-input");
const profileFrameInput = document.getElementById("profile-frame-input");
const profileActivityInput = document.getElementById("profile-activity-input");
const profileBannerInput = document.getElementById("profile-banner-input");
const profileAccentInput = document.getElementById("profile-accent-input");
const profileInvisibleInput = document.getElementById("profile-invisible-input");
const profilePublicInput = document.getElementById("profile-public-input");
const profileAvatarInput = document.getElementById("profile-avatar-input");
const profilePreviewName = document.getElementById("profile-preview-name");
const profilePreviewStatus = document.getElementById("profile-preview-status");
const profilePreviewRole = document.getElementById("profile-preview-role");
const profileAccountName = document.getElementById("profile-account-name");
const profileAccountRole = document.getElementById("profile-account-role");
const profileAvatar = document.getElementById("profile-avatar");
const profileFrame = document.getElementById("profile-frame");

const friendSearchInput = document.getElementById("friend-search-input");
const friendsList = document.getElementById("friends-list");
const friendsEmpty = document.getElementById("friends-empty");
const friendsCount = document.getElementById("friends-count");
const requestBox = document.getElementById("friend-requests-box");
const requestsList = document.getElementById("friend-requests-list");
const requestsCount = document.getElementById("requests-count");

const chatEmpty = document.getElementById("chat-empty");
const chatView = document.getElementById("chat-view");
const chatAvatar = document.getElementById("chat-avatar");
const chatName = document.getElementById("chat-name");
const chatStatus = document.getElementById("chat-status");
const chatMessages = document.getElementById("chat-messages");
const chatInput = document.getElementById("chat-input");
const typingIndicator = document.getElementById("typing-indicator");
const pinnedMessage = document.getElementById("pinned-message");
const hubContent = document.getElementById("hub-content");
const adminHubTab = document.getElementById("admin-hub-tab");
const messengerNavBadge = document.getElementById("messenger-nav-badge");

let toastTimer;
let friends = [];
let currentMe = null;
let currentProfile = null;
let currentDashboard = null;
let activeFriend = null;
let activeGroup = null;
let currentHub = "overview";
let canManageRoles = false;
let typingTimer = null;
let messengerRefreshTimer = null;
let pendingReply = null;
let lastSummaryMessageId = null;

function showToast(title, message) {
  clearTimeout(toastTimer);
  toastTitle.textContent = title;
  toastMessage.textContent = message;
  toast.classList.add("show");
  toastTimer = setTimeout(() => toast.classList.remove("show"), 3400);
}

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function fmtTime(unix) {
  const value = Number(unix || 0);
  if (!value) return "";
  try {
    return new Date(value * 1000).toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

async function apiGet(path, query = {}) {
  return await invoke("api_get", { path, query });
}

async function apiPost(path, body = {}) {
  return await invoke("api_post", { path, body });
}

async function apiUpload(path, file, query = {}) {
  const buffer = await file.arrayBuffer();
  return await invoke("api_upload", {
    path,
    query,
    contentType: file.type || "application/octet-stream",
    fileName: file.name || "file",
    bytes: Array.from(new Uint8Array(buffer)),
  });
}

async function mediaData(path) {
  const payload = await invoke("api_media", { path, query: {} });
  return `data:${payload.mime};base64,${payload.data}`;
}

function setAuthMode(mode) {
  const login = mode === "login";
  loginForm.classList.toggle("hidden", !login);
  registerForm.classList.toggle("hidden", login);
  loginTab.classList.toggle("active", login);
  registerTab.classList.toggle("active", !login);
  authError.textContent = "";
}

loginTab.addEventListener("click", () => setAuthMode("login"));
registerTab.addEventListener("click", () => setAuthMode("register"));

async function finishAuthentication() {
  authError.textContent = "";
  currentMe = await invoke("account_me");
  authGate.classList.add("hidden");
  adminHubTab.classList.toggle("hidden", !(currentMe.isAdmin || currentMe.role === "creator"));
  await Promise.all([loadProfile(currentMe), loadFriends(), loadRequests()]);
  backendStatus.textContent = "АККАУНТ ПОДКЛЮЧЁН";
  startMessengerRefresh();
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = loginForm.querySelector("button[type='submit']");
  button.disabled = true;
  authError.textContent = "";

  try {
    await invoke("auth_login", {
      username: document.getElementById("login-username").value.trim(),
      password: document.getElementById("login-password").value,
      totp: document.getElementById("login-totp").value.trim() || null,
    });
    document.getElementById("login-password").value = "";
    await finishAuthentication();
    showToast("Laminari", "Вход выполнен.");
  } catch (error) {
    authError.textContent = String(error);
  } finally {
    button.disabled = false;
  }
});

registerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = registerForm.querySelector("button[type='submit']");
  button.disabled = true;
  authError.textContent = "";

  try {
    if (!document.getElementById("register-consent").checked) {
      throw new Error("Подтверди согласие на обработку данных.");
    }

    await invoke("auth_register", {
      email: document.getElementById("register-email").value.trim(),
      username: document.getElementById("register-username").value.trim(),
      password: document.getElementById("register-password").value,
    });

    document.getElementById("register-password").value = "";
    await finishAuthentication();
    showToast("Laminari", "Аккаунт создан и подключён.");
  } catch (error) {
    authError.textContent = String(error);
  } finally {
    button.disabled = false;
  }
});

function openPage(page) {
  Object.entries(pages).forEach(([key, element]) => {
    element.classList.toggle("active-page", key === page);
  });

  navItems.forEach((item) => {
    item.classList.toggle("active", item.dataset.page === page);
  });

  pageTitle.textContent = pageNames[page] ?? "Laminari";

  if (page === "messenger") {
    Promise.all([loadFriends(), loadRequests()]).catch((error) => showToast("Мессенджер", String(error)));
  }

  if (page === "profile") {
    loadProfile().catch((error) => showToast("Профиль", String(error)));
  }

  if (page === "hub") {
    loadHub(currentHub).catch((error) => showHubError(error));
  }
}

navItems.forEach((item) => {
  item.addEventListener("click", () => openPage(item.dataset.page));
});

document.querySelectorAll(".hub-tab").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".hub-tab").forEach((tab) => tab.classList.remove("active"));
    button.classList.add("active");
    currentHub = button.dataset.hub;
    loadHub(currentHub).catch((error) => showHubError(error));
  });
});

document.getElementById("library-card").addEventListener("click", () => openPage("library"));

async function requestImport() {
  try {
    const message = await invoke("import_placeholder");
    showToast("Импорт сборки", message);
  } catch (error) {
    showToast("Ошибка", String(error));
  }
}

document.getElementById("import-button").addEventListener("click", requestImport);
document.getElementById("library-import-button").addEventListener("click", requestImport);

document.getElementById("play-button").addEventListener("click", () => {
  showToast("Laminari Client", "Сначала импортируй сборку Minecraft.");
});

document.getElementById("minimize-button").addEventListener("click", async () => {
  try { await currentWindow?.minimize(); } catch (error) { showToast("Окно", String(error)); }
});

document.getElementById("maximize-button").addEventListener("click", async () => {
  try { await currentWindow?.toggleMaximize(); } catch (error) { showToast("Окно", String(error)); }
});

document.getElementById("close-button").addEventListener("click", async () => {
  try { await currentWindow?.close(); } catch (error) { showToast("Окно", String(error)); }
});

function applyFrame(frameStyle) {
  profileFrame.className = "profile-frame frame-" + (frameStyle || "classic");
}

async function loadProfile(meOverride = null) {
  const me = meOverride || currentMe || await invoke("account_me");
  currentMe = me;
  const [settings, dashboard] = await Promise.all([
    invoke("account_profile"),
    apiGet("/api/social/dashboard"),
  ]);

  currentDashboard = dashboard;
  currentProfile = { ...me, ...settings, ...(dashboard.me || {}) };

  profilePreviewName.textContent = me.username || "Laminari";
  profilePreviewRole.textContent = me.roleLabel || me.role || "Игрок";
  profilePreviewStatus.textContent = settings.status || "В Laminari";
  profileAccountName.textContent = me.username || "—";
  profileAccountRole.textContent = me.roleLabel || me.role || "—";
  profileAvatar.textContent = ((me.username || "L")[0] || "L").toUpperCase();

  profileStatusInput.value = settings.status || "";
  profileBioInput.value = settings.bio || "";
  profileFrameInput.value = settings.frameStyle || "classic";
  profileActivityInput.value = dashboard.me?.activity || "";
  profileBannerInput.value = dashboard.me?.banner || "";
  profileAccentInput.value = dashboard.me?.accent || "mono";
  profileInvisibleInput.checked = Boolean(dashboard.me?.invisible);
  profilePublicInput.checked = dashboard.me?.publicProfile !== false;
  applyFrame(settings.frameStyle || "classic");
}

profileFrameInput.addEventListener("change", () => applyFrame(profileFrameInput.value));

document.getElementById("save-profile-button").addEventListener("click", async () => {
  try {
    await Promise.all([
      invoke("account_save_profile", {
        status: profileStatusInput.value.trim(),
        bio: profileBioInput.value.trim(),
        frameStyle: profileFrameInput.value,
        privacyMessages: currentProfile?.privacyMessages || "friends",
        privacyRequests: currentProfile?.privacyRequests || "everyone",
      }),
      apiPost("/api/social/profile", {
        invisible: profileInvisibleInput.checked,
        activity: profileActivityInput.value.trim(),
        banner: profileBannerInput.value.trim(),
        accent: profileAccentInput.value,
        publicProfile: profilePublicInput.checked,
      }),
    ]);

    await loadProfile();
    showToast("Профиль", "Профиль синхронизирован с сайтом.");
  } catch (error) {
    showToast("Профиль", String(error));
  }
});

profileAvatarInput.addEventListener("change", async () => {
  const file = profileAvatarInput.files?.[0];
  if (!file) return;

  try {
    await apiUpload("/api/profile/avatar", file);
    const preview = URL.createObjectURL(file);
    profileAvatar.style.backgroundImage = `url("${preview}")`;
    profileAvatar.style.backgroundSize = "cover";
    profileAvatar.textContent = "";
    showToast("Профиль", "Аватар загружен на сайт.");
  } catch (error) {
    showToast("Аватар", String(error));
  } finally {
    profileAvatarInput.value = "";
  }
});

document.getElementById("logout-button").addEventListener("click", async () => {
  try { await invoke("auth_logout"); } catch {}
  stopMessengerRefresh();
  friends = [];
  currentMe = null;
  activeFriend = null;
  renderFriends();
  closeChat();
  authGate.classList.remove("hidden");
  setAuthMode("login");
  showToast("Laminari", "Ты вышел из аккаунта.");
});

async function loadFriends() {
  const payload = await invoke("account_friends");
  friends = Array.isArray(payload.friends) ? payload.friends : [];
  canManageRoles = Boolean(payload.canManageRoles);
  renderFriends(friendSearchInput.value);
}

async function loadRequests() {
  const payload = await apiGet("/api/messenger/requests");
  const requests = Array.isArray(payload.requests) ? payload.requests : [];
  requestsCount.textContent = String(requests.length);
  requestBox.classList.toggle("hidden", !requests.length);
  requestsList.replaceChildren();

  for (const request of requests) {
    const row = document.createElement("div");
    row.className = "request-row";
    row.innerHTML = `
      <span class="friend-avatar frame-${esc(request.frameStyle || "classic")}">${esc((request.username || "L")[0].toUpperCase())}</span>
      <span class="request-copy"><strong>${esc(request.username)}</strong><span>${esc(request.role || "Игрок")}</span></span>
      <button class="request-accept">✓</button>
      <button class="request-reject">×</button>
    `;
    row.querySelector(".request-accept").onclick = async () => {
      await apiPost("/api/messenger/accept", { targetId: request.id });
      await Promise.all([loadRequests(), loadFriends()]);
      showToast("Друзья", request.username + " добавлен в друзья.");
    };
    row.querySelector(".request-reject").onclick = async () => {
      await apiPost("/api/messenger/reject", { targetId: request.id });
      await loadRequests();
    };
    requestsList.append(row);
  }
}

function renderFriends(filter = "") {
  const query = filter.trim().toLocaleLowerCase("ru-RU");
  const visible = friends.filter((friend) =>
    String(friend.username || "").toLocaleLowerCase("ru-RU").includes(query)
  );

  friendsList.replaceChildren();
  friendsCount.textContent = String(friends.length);
  friendsEmpty.style.display = visible.length ? "none" : "flex";

  if (!visible.length && query) {
    friendsEmpty.querySelector("strong").textContent = "Ничего не найдено";
    friendsEmpty.querySelector("span").textContent = "Попробуй другой ник.";
  } else if (!friends.length) {
    friendsEmpty.querySelector("strong").textContent = "Список друзей пуст";
    friendsEmpty.querySelector("span").textContent = "Добавь пользователя сайта Laminari.";
  }

  for (const friend of visible) {
    const card = document.createElement("button");
    card.className = "friend-card" + (activeFriend?.id === friend.id ? " selected" : "");
    card.innerHTML = `
      <span class="friend-avatar frame-${esc(friend.frameStyle || "classic")}">${esc((friend.username || "L")[0].toUpperCase())}</span>
      <span class="friend-copy">
        <strong>${friend.favorite ? "★ " : ""}${esc(friend.username || "Пользователь")}</strong>
        <span>${esc(friend.lastMessage || friend.status || (friend.online ? "В сети" : "Не в сети"))}</span>
      </span>
      ${friend.unread ? `<span class="unread-badge">${Number(friend.unread)}</span>` : ""}
    `;
    card.onclick = () => openChat(friend);
    friendsList.append(card);
  }
}

friendSearchInput.addEventListener("input", () => renderFriends(friendSearchInput.value));

document.getElementById("add-friend-button").addEventListener("click", async () => {
  const username = window.prompt("Введите точный ник пользователя Laminari:");
  if (!username?.trim()) return;

  try {
    const payload = await invoke("account_search_users", { query: username.trim() });
    const users = Array.isArray(payload.users) ? payload.users : [];
    const exact = users.find((user) =>
      String(user.username || "").toLocaleLowerCase("ru-RU") === username.trim().toLocaleLowerCase("ru-RU")
    );
    const target = exact || (users.length === 1 ? users[0] : null);

    if (!target) throw new Error(users.length ? "Найдено несколько пользователей. Уточни ник." : "Пользователь не найден.");
    if (target.isFriend) throw new Error("Этот пользователь уже у тебя в друзьях.");
    if (target.outgoing) throw new Error("Заявка этому пользователю уже отправлена.");

    await invoke("account_send_friend_request", { targetId: target.id });
    showToast("Друзья", "Заявка отправлена пользователю " + target.username + ".");
  } catch (error) {
    showToast("Друзья", String(error));
  }
});

async function openChat(friend) {
  activeFriend = friend;
  renderFriends(friendSearchInput.value);
  chatEmpty.classList.add("hidden");
  chatView.classList.remove("hidden");
  chatName.textContent = friend.username || "Друг";
  chatStatus.textContent = (friend.role || "Игрок") + " · " + (friend.online ? "В сети" : "Не в сети");
  chatAvatar.className = "friend-avatar frame-" + (friend.frameStyle || "classic");
  chatAvatar.textContent = ((friend.username || "L")[0] || "L").toUpperCase();

  try {
    const draft = await apiGet("/api/social/draft", { context: "direct", contextId: friend.id });
    chatInput.value = draft.draft?.body || "";
  } catch {}

  await refreshChat();
}

function closeChat() {
  activeFriend = null;
  chatEmpty.classList.remove("hidden");
  chatView.classList.add("hidden");
  chatMessages.replaceChildren();
}

async function refreshChat() {
  if (!activeFriend) return;

  const payload = await apiGet("/api/messenger/messages", { userId: activeFriend.id });
  typingIndicator.textContent = payload.typing ? "печатает..." : "";
  pinnedMessage.classList.toggle("hidden", !payload.pinnedMessageId);
  pinnedMessage.textContent = payload.pinnedMessageId ? "📌 Закреплённое сообщение · нажми, чтобы снять закрепление" : "";
  pinnedMessage.onclick = payload.pinnedMessageId ? async () => {
    await apiPost("/api/messenger/unpin", { targetId: activeFriend.id });
    await refreshChat();
  } : null;
  renderMessages(payload.messages || []);
}

function renderMessages(messages) {
  chatMessages.replaceChildren();

  for (const message of messages) {
    const bubble = document.createElement("div");
    bubble.className = "message-row " + (message.fromMe ? "mine" : "theirs");

    const card = document.createElement("div");
    card.className = "message-bubble";

    if (message.replyPreview) {
      const reply = document.createElement("div");
      reply.className = "message-reply";
      reply.textContent = message.replyPreview;
      card.append(reply);
    }

    if (message.body) {
      const body = document.createElement("div");
      body.className = "message-body";
      body.textContent = message.body;
      card.append(body);
    }

    if (message.attachment) {
      const attachment = document.createElement("button");
      attachment.className = "message-attachment";
      attachment.textContent = "📎 " + (message.attachment.name || message.attachment.type || "Вложение");
      attachment.onclick = () => previewMedia(message.attachment.url, message.attachment.type, message.attachment.name);
      card.append(attachment);
    }

    if (message.sticker) {
      const sticker = document.createElement("button");
      sticker.className = "message-attachment";
      sticker.textContent = "🖼 Стикер";
      sticker.onclick = () => previewMedia(message.sticker.url, "image/webp", "Стикер");
      card.append(sticker);
    }

    if (message.emoji) {
      const emoji = document.createElement("button");
      emoji.className = "message-attachment";
      emoji.textContent = "🙂 Эмодзи";
      emoji.onclick = () => previewMedia(message.emoji.url, "image/webp", "Эмодзи");
      card.append(emoji);
    }

    if (Array.isArray(message.reactions) && message.reactions.length) {
      const reactions = document.createElement("div");
      reactions.className = "message-reactions";
      reactions.textContent = message.reactions.map((item) => item.reaction).join(" ");
      card.append(reactions);
    }

    const meta = document.createElement("div");
    meta.className = "message-meta";
    meta.textContent = fmtTime(message.createdAt) + (message.editedAt ? " · изменено" : "") + (message.read && message.fromMe ? " · прочитано" : "");
    card.append(meta);

    const actions = document.createElement("div");
    actions.className = "message-actions";

    for (const reaction of ["👍","❤️","😂","🔥"]) {
      const button = document.createElement("button");
      button.textContent = reaction;
      button.onclick = async () => {
        await apiPost("/api/messenger/reaction", { targetId: activeFriend.id, messageId: message.id, reaction });
        await refreshChat();
      };
      actions.append(button);
    }

    const replyAction = document.createElement("button");
    replyAction.textContent = "↩";
    replyAction.title = "Ответить";
    replyAction.onclick = () => {
      pendingReply = message;
      showToast("Ответ", "Ответ на: " + (message.body || "вложение"));
      chatInput.focus();
    };
    actions.append(replyAction);

    const pin = document.createElement("button");
    pin.textContent = "📌";
    pin.title = "Закрепить";
    pin.onclick = async () => {
      await apiPost("/api/messenger/pin", { targetId: activeFriend.id, messageId: message.id });
      await refreshChat();
    };
    actions.append(pin);

    const forward = document.createElement("button");
    forward.textContent = "↗";
    forward.title = "Переслать";
    forward.onclick = async () => {
      const username = prompt("Кому переслать? Введи ник друга:");
      if (!username) return;
      const target = friends.find((friend) => friend.username.toLowerCase() === username.trim().toLowerCase());
      if (!target) return showToast("Пересылка", "Такого друга нет в списке.");
      await apiPost("/api/social/forward", { messageId: message.id, targetId: target.id });
      showToast("Пересылка", "Сообщение переслано.");
    };
    actions.append(forward);

    const history = document.createElement("button");
    history.textContent = "⟳";
    history.title = "История изменений";
    history.onclick = async () => {
      const payload = await apiGet("/api/social/edit-history", { messageId: message.id });
      const text = (payload.entries || []).map((item) => `${fmtTime(item.created_at)}: ${item.old_body} → ${item.new_body}`).join("\n");
      alert(text || "Истории изменений нет.");
    };
    actions.append(history);

    const hide = document.createElement("button");
    hide.textContent = "⌫";
    hide.title = "Удалить только у себя";
    hide.onclick = async () => {
      await apiPost("/api/messenger/delete-message", { targetId: activeFriend.id, messageId: message.id, scope: "me" });
      await refreshChat();
    };
    actions.append(hide);

    if (!message.fromMe) {
      const report = document.createElement("button");
      report.textContent = "!";
      report.title = "Пожаловаться";
      report.onclick = async () => {
        const reason = prompt("Причина жалобы:");
        if (!reason?.trim()) return;
        await apiPost("/api/social/report", { targetId: activeFriend.id, messageId: message.id, reason: reason.trim() });
        showToast("Жалоба", "Жалоба отправлена.");
      };
      actions.append(report);
    }

    if (message.fromMe) {
      const edit = document.createElement("button");
      edit.textContent = "✎";
      edit.title = "Редактировать";
      edit.onclick = async () => {
        const body = prompt("Новый текст:", message.body || "");
        if (!body?.trim()) return;
        await apiPost("/api/messenger/edit-message", { targetId: activeFriend.id, messageId: message.id, body });
        await refreshChat();
      };
      actions.append(edit);

      const remove = document.createElement("button");
      remove.textContent = "×";
      remove.title = "Удалить у всех";
      remove.onclick = async () => {
        await apiPost("/api/messenger/delete-message", { targetId: activeFriend.id, messageId: message.id, scope: "all" });
        await refreshChat();
      };
      actions.append(remove);
    }

    card.append(actions);
    bubble.append(card);
    chatMessages.append(bubble);
  }

  chatMessages.scrollTop = chatMessages.scrollHeight;
}

async function previewMedia(path, type = "", name = "Медиа") {
  try {
    const data = await mediaData(path);
    const overlay = document.createElement("div");
    overlay.className = "media-overlay";
    const box = document.createElement("div");
    box.className = "media-box";
    const close = document.createElement("button");
    close.className = "media-close";
    close.textContent = "×";
    close.onclick = () => overlay.remove();
    box.append(close);

    if (String(type).startsWith("image/")) {
      const img = document.createElement("img");
      img.src = data;
      img.alt = name;
      box.append(img);
    } else if (String(type).startsWith("audio/")) {
      const audio = document.createElement("audio");
      audio.controls = true;
      audio.src = data;
      box.append(audio);
    } else {
      const link = document.createElement("a");
      link.href = data;
      link.download = name || "file";
      link.textContent = "Скачать " + (name || "файл");
      box.append(link);
    }

    overlay.onclick = (event) => {
      if (event.target === overlay) overlay.remove();
    };
    overlay.append(box);
    document.body.append(overlay);
  } catch (error) {
    showToast("Медиа", String(error));
  }
}

async function sendMessage() {
  if (!activeFriend) return;
  const body = chatInput.value.trim();
  if (!body) return;

  await apiPost("/api/messenger/message", {
    targetId: activeFriend.id,
    body,
    replyToId: pendingReply?.id || null,
  });
  pendingReply = null;
  chatInput.value = "";
  await apiPost("/api/social/draft", { context: "direct", contextId: activeFriend.id, body: "" });
  await refreshChat();
  await loadFriends();
}

document.getElementById("chat-send-button").addEventListener("click", () => {
  sendMessage().catch((error) => showToast("Сообщение", String(error)));
});

chatInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendMessage().catch((error) => showToast("Сообщение", String(error)));
  }
});

chatInput.addEventListener("input", () => {
  if (!activeFriend) return;
  clearTimeout(typingTimer);
  typingTimer = setTimeout(async () => {
    try {
      await Promise.all([
        apiPost("/api/messenger/typing", { targetId: activeFriend.id }),
        apiPost("/api/social/draft", { context: "direct", contextId: activeFriend.id, body: chatInput.value }),
      ]);
    } catch {}
  }, 350);
});

document.getElementById("chat-file-input").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file || !activeFriend) return;

  try {
    await apiUpload("/api/messenger/attachment", file, { targetId: activeFriend.id });
    await refreshChat();
    await loadFriends();
  } catch (error) {
    showToast("Вложение", String(error));
  } finally {
    event.target.value = "";
  }
});

document.getElementById("chat-search-button").onclick = async () => {
  if (!activeFriend) return;
  const query = prompt("Что найти в переписке?");
  if (!query?.trim()) return;
  const payload = await apiGet("/api/messenger/search-messages", { userId: activeFriend.id, q: query.trim() });
  const text = (payload.messages || []).map((item) => `${fmtTime(item.createdAt)} · ${item.body}`).join("\n");
  alert(text || "Ничего не найдено.");
};

document.getElementById("chat-gallery-button").onclick = async () => {
  if (!activeFriend) return;
  const payload = await apiGet("/api/messenger/gallery", { userId: activeFriend.id });
  const items = payload.items || [];
  if (!items.length) return showToast("Галерея", "Вложений пока нет.");
  const chosen = items[0];
  await previewMedia(chosen.url, chosen.type, chosen.name);
};

document.getElementById("chat-favorite-button").onclick = async () => {
  if (!activeFriend) return;
  const next = !Boolean(activeFriend.favorite);
  await apiPost("/api/messenger/favorite", { targetId: activeFriend.id, favorite: next });
  activeFriend.favorite = next;
  await loadFriends();
  document.getElementById("chat-favorite-button").textContent = next ? "★" : "☆";
};

document.getElementById("chat-sticker-button").onclick = async () => {
  if (!activeFriend) return;
  const payload = await apiGet("/api/social/stickers");
  const items = payload.items || [];
  if (!items.length) return showToast("Стикеры", "Стикеров пока нет.");
  const name = prompt("Название стикера:\n" + items.map((item) => item.name).join(", "));
  if (!name) return;
  const item = items.find((entry) => entry.name.toLowerCase() === name.trim().toLowerCase());
  if (!item) return showToast("Стикеры", "Стикер не найден.");
  await apiPost("/api/social/sticker/send", { targetId: activeFriend.id, stickerId: item.id });
  await refreshChat();
};

document.getElementById("chat-emoji-button").onclick = async () => {
  if (!activeFriend) return;
  const payload = await apiGet("/api/social/emoji");
  const items = payload.items || [];
  if (!items.length) return showToast("Эмодзи", "Кастомных эмодзи пока нет.");
  const name = prompt("Название эмодзи:\n" + items.map((item) => item.name).join(", "));
  if (!name) return;
  const item = items.find((entry) => entry.name.toLowerCase() === name.trim().toLowerCase());
  if (!item) return showToast("Эмодзи", "Эмодзи не найден.");
  await apiPost("/api/social/emoji/send", { targetId: activeFriend.id, emojiId: item.id });
  await refreshChat();
};

document.getElementById("chat-more-button").onclick = async () => {
  if (!activeFriend) return;
  const action = prompt("Действие: block / remove / role");
  if (!action) return;

  try {
    if (action === "block") {
      await apiPost("/api/messenger/block", { targetId: activeFriend.id });
      closeChat();
      await loadFriends();
    } else if (action === "remove") {
      await apiPost("/api/messenger/remove", { targetId: activeFriend.id });
      closeChat();
      await loadFriends();
    } else if (action === "role" && canManageRoles) {
      const role = prompt("Ключ роли:\n" + ROLE_KEYS.join(", "));
      if (!role) return;
      await apiPost("/api/messenger/set-role", { targetId: activeFriend.id, role: role.trim() });
      await loadFriends();
      showToast("Роли", "Роль обновлена.");
    } else {
      showToast("Мессенджер", "Действие недоступно.");
    }
  } catch (error) {
    showToast("Мессенджер", String(error));
  }
};

function startMessengerRefresh() {
  stopMessengerRefresh();
  messengerRefreshTimer = setInterval(async () => {
    if (!currentMe) return;
    try {
      await apiPost("/api/messenger/heartbeat", {});
      await refreshMessengerSummary();
      if (activeFriend) await refreshChat();
      await loadRequests();
    } catch {}
  }, 5000);
}

function stopMessengerRefresh() {
  if (messengerRefreshTimer) clearInterval(messengerRefreshTimer);
  messengerRefreshTimer = null;
}

function showHubError(error) {
  hubContent.innerHTML = `<div class="hub-error">${esc(String(error))}</div>`;
}

async function loadHub(name) {
  hubContent.innerHTML = '<div class="hub-loading">Загрузка...</div>';
  if (name === "overview") return loadHubOverview();
  if (name === "groups") return loadHubGroups();
  if (name === "forum") return loadHubForum();
  if (name === "security") return loadHubSecurity();
  if (name === "sessions") return loadHubSessions();
  if (name === "invites") return loadHubInvites();
  if (name === "extras") return loadHubExtras();
  if (name === "changelog") return loadHubChangelog();
  if (name === "admin") return loadHubAdmin();
}

async function loadHubOverview() {
  const payload = await apiGet("/api/social/dashboard");
  currentDashboard = payload;

  const achievements = payload.achievements || [];
  const shop = payload.shop || [];
  const earned = achievements.filter((item) => item.earned_at);

  hubContent.innerHTML = `
    <div class="hub-stats">
      <div class="hub-stat"><span>ОЧКИ</span><strong>${Number(payload.me?.points || 0)}</strong></div>
      <div class="hub-stat"><span>РЕПУТАЦИЯ</span><strong>${Number(payload.me?.reputation || 0)}</strong></div>
      <div class="hub-stat"><span>ДОСТИЖЕНИЯ</span><strong>${earned.length}/${achievements.length}</strong></div>
      <div class="hub-stat"><span>2FA</span><strong>${payload.me?.twoFactor ? "ON" : "OFF"}</strong></div>
    </div>
    <div class="hub-columns">
      <section class="hub-card">
        <div class="hub-card-head"><strong>Достижения</strong><span>${earned.length}</span></div>
        <div id="achievement-list" class="hub-list"></div>
      </section>
      <section class="hub-card">
        <div class="hub-card-head"><strong>Магазин</strong><span>${shop.length}</span></div>
        <div id="shop-list" class="hub-list"></div>
      </section>
    </div>
  `;

  const achievementList = document.getElementById("achievement-list");
  for (const item of achievements) {
    const row = document.createElement("div");
    row.className = "hub-row";
    row.innerHTML = `<span class="hub-row-icon">${esc(item.icon || "◇")}</span><span class="hub-row-main"><strong>${esc(item.name)}</strong><small>${esc(item.description)}</small></span><span class="hub-row-side">${item.earned_at ? "✓" : "+" + Number(item.points || 0)}</span>`;
    achievementList.append(row);
  }

  const shopList = document.getElementById("shop-list");
  for (const item of shop) {
    const row = document.createElement("div");
    row.className = "hub-row";
    const action = document.createElement("button");
    action.className = "mini-button";
    action.textContent = item.equipped ? "Надето" : item.owned ? "Надеть" : "Купить · " + Number(item.cost || 0);
    action.disabled = Boolean(item.equipped);
    action.onclick = async () => {
      try {
        if (!item.owned) await apiPost("/api/social/shop/buy", { itemId: item.id });
        await apiPost("/api/social/shop/equip", { itemId: item.id });
        await Promise.all([loadHubOverview(), loadProfile()]);
      } catch (error) {
        showToast("Магазин", String(error));
      }
    };
    row.innerHTML = `<span class="hub-row-icon">✧</span><span class="hub-row-main"><strong>${esc(item.name)}</strong><small>${esc(item.kind)} · ${esc(item.value)}</small></span>`;
    row.append(action);
    shopList.append(row);
  }
}

async function loadHubGroups() {
  const [groupsPayload, invitesPayload] = await Promise.all([
    apiGet("/api/social/groups"),
    apiGet("/api/social/group-invites"),
  ]);

  const groups = groupsPayload.groups || [];
  const invites = invitesPayload.invites || [];

  hubContent.innerHTML = `
    <div class="hub-actions-line">
      <button id="create-group-button" class="primary-button compact-action"><span>Создать группу</span><span>+</span></button>
      <span class="hub-muted">${invites.length} приглашений</span>
    </div>
    <div id="group-invites-list" class="hub-list"></div>
    <div id="groups-list" class="hub-grid"></div>
  `;

  document.getElementById("create-group-button").onclick = async () => {
    const name = prompt("Название группы:");
    if (!name?.trim()) return;
    await apiPost("/api/social/group/create", { name: name.trim() });
    await loadHubGroups();
  };

  const inviteList = document.getElementById("group-invites-list");
  for (const invite of invites) {
    const row = document.createElement("div");
    row.className = "hub-row";
    row.innerHTML = `<span class="hub-row-main"><strong>${esc(invite.name)}</strong><small>от ${esc(invite.inviter || "пользователя")}</small></span>`;
    const accept = document.createElement("button");
    accept.className = "mini-button";
    accept.textContent = "Принять";
    accept.onclick = async () => {
      await apiPost("/api/social/group/accept", { inviteId: invite.id });
      await loadHubGroups();
    };
    row.append(accept);
    inviteList.append(row);
  }

  const list = document.getElementById("groups-list");
  for (const group of groups) {
    const card = document.createElement("button");
    card.className = "hub-tile";
    card.innerHTML = `<span>ГРУППА</span><strong>${esc(group.name)}</strong><small>${Number(group.members || 0)} участников · ${esc(group.member_role || "member")}</small><p>${esc(group.last_message || "Сообщений пока нет")}</p>`;
    card.onclick = () => openGroup(group.id);
    list.append(card);
  }
}

async function openGroup(groupId) {
  activeGroup = groupId;
  const [payload, polls] = await Promise.all([
    apiGet("/api/social/group", { id: groupId }),
    apiGet("/api/social/polls", { contextType: "group", contextId: groupId }),
  ]);

  hubContent.innerHTML = `
    <div class="group-header">
      <button id="group-back" class="mini-button">← Назад</button>
      <div><span>ГРУППА</span><h3>${esc(payload.group?.name || "Группа")}</h3></div>
      <div class="group-header-actions">
        <button id="group-invite" class="mini-button">Пригласить</button>
        <button id="group-poll" class="mini-button">Опрос</button>
      </div>
    </div>
    <div class="hub-columns group-columns">
      <section class="hub-card">
        <div class="hub-card-head"><strong>Сообщения</strong><span>${(payload.messages || []).length}</span></div>
        <div id="group-messages" class="group-messages"></div>
        <div class="group-compose"><input id="group-message-input" placeholder="Сообщение группе..."><button id="group-send" class="mini-button">Отправить</button></div>
      </section>
      <section class="hub-card">
        <div class="hub-card-head"><strong>Участники</strong><span>${(payload.members || []).length}</span></div>
        <div id="group-members" class="hub-list"></div>
        <div class="hub-card-head polls-head"><strong>Опросы</strong><span>${(polls.polls || []).length}</span></div>
        <div id="group-polls" class="hub-list"></div>
      </section>
    </div>
  `;

  document.getElementById("group-back").onclick = () => loadHubGroups();
  document.getElementById("group-invite").onclick = async () => {
    const username = prompt("Ник пользователя:");
    if (!username?.trim()) return;
    await apiPost("/api/social/group/invite", { groupId, username: username.trim() });
    showToast("Группа", "Приглашение отправлено.");
  };
  document.getElementById("group-poll").onclick = async () => {
    const question = prompt("Вопрос:");
    if (!question?.trim()) return;
    const optionsText = prompt("Варианты через запятую:");
    const options = (optionsText || "").split(",").map((item) => item.trim()).filter(Boolean).slice(0, 6);
    if (options.length < 2) return showToast("Опрос", "Нужно минимум 2 варианта.");
    await apiPost("/api/social/poll/create", { contextType: "group", contextId: groupId, question, options });
    await openGroup(groupId);
  };
  document.getElementById("group-send").onclick = async () => {
    const input = document.getElementById("group-message-input");
    const body = input.value.trim();
    if (!body) return;
    await apiPost("/api/social/group/message", { groupId, body });
    await openGroup(groupId);
  };

  const messages = document.getElementById("group-messages");
  for (const message of payload.messages || []) {
    const row = document.createElement("div");
    row.className = "group-message";
    row.innerHTML = `<strong>${esc(message.username || "Игрок")}</strong><span>${esc(message.body || "Вложение")}</span><small>${fmtTime(message.created_at)}</small>`;
    messages.append(row);
  }

  const members = document.getElementById("group-members");
  for (const member of payload.members || []) {
    const row = document.createElement("div");
    row.className = "hub-row";
    row.innerHTML = `<span class="hub-row-main"><strong>${esc(member.username)}</strong><small>${esc(member.role || "Игрок")} · ${esc(member.member_role || "member")}</small></span>`;
    members.append(row);
  }

  const pollsList = document.getElementById("group-polls");
  for (const poll of polls.polls || []) {
    const box = document.createElement("div");
    box.className = "poll-box";
    const title = document.createElement("strong");
    title.textContent = poll.question;
    box.append(title);
    (poll.options || []).forEach((option, index) => {
      const vote = document.createElement("button");
      vote.className = "poll-option" + (poll.myVote === index ? " selected" : "");
      vote.textContent = `${option} · ${Number(poll.counts?.[index] || 0)}`;
      vote.onclick = async () => {
        await apiPost("/api/social/poll/vote", { pollId: poll.id, optionIndex: index });
        await openGroup(groupId);
      };
      box.append(vote);
    });
    pollsList.append(box);
  }
}

async function loadHubForum() {
  const payload = await apiGet("/api/forum");
  const posts = payload.posts || [];

  hubContent.innerHTML = `
    <section class="hub-card forum-create">
      <textarea id="forum-new-body" maxlength="1000" placeholder="Предложить идею для Laminari..."></textarea>
      <button id="forum-new-button" class="primary-button compact-action"><span>Опубликовать</span><span>→</span></button>
    </section>
    <div id="forum-list" class="forum-list"></div>
  `;

  document.getElementById("forum-new-button").onclick = async () => {
    const body = document.getElementById("forum-new-body").value.trim();
    if (!body) return;
    await apiPost("/api/forum/post", { body });
    await loadHubForum();
  };

  const list = document.getElementById("forum-list");
  for (const post of posts) {
    const card = document.createElement("article");
    card.className = "forum-card";
    card.innerHTML = `
      <div class="forum-head"><div><strong>${esc(post.username)}</strong><span>${esc(post.role || "Игрок")}</span></div><small>${fmtTime(post.created_at)}</small></div>
      <p>${esc(post.body)}</p>
      <div class="forum-status">Статус: ${esc(post.status || "proposed")}</div>
      <div class="forum-actions"></div>
      <div class="forum-replies"></div>
    `;

    const actions = card.querySelector(".forum-actions");
    const like = document.createElement("button");
    like.className = "mini-button";
    like.textContent = (post.liked ? "♥" : "♡") + " " + Number(post.likes || 0);
    like.onclick = async () => {
      await apiPost("/api/forum/like", { postId: post.id, liked: !post.liked });
      await loadHubForum();
    };
    actions.append(like);

    if (payload.isAdmin) {
      const reply = document.createElement("button");
      reply.className = "mini-button";
      reply.textContent = "Ответить";
      reply.onclick = async () => {
        const body = prompt("Ответ администрации:");
        if (!body?.trim()) return;
        await apiPost("/api/forum/reply", { postId: post.id, body });
        await loadHubForum();
      };
      actions.append(reply);

      const status = document.createElement("button");
      status.className = "mini-button";
      status.textContent = "Статус";
      status.onclick = async () => {
        const value = prompt("proposed / review / development / added / rejected", post.status || "proposed");
        if (!value) return;
        await apiPost("/api/forum/status", { postId: post.id, status: value });
        await loadHubForum();
      };
      actions.append(status);
    }

    if (post.canDelete) {
      const remove = document.createElement("button");
      remove.className = "mini-button danger-mini";
      remove.textContent = "Удалить";
      remove.onclick = async () => {
        await apiPost("/api/forum/delete", { postId: post.id });
        await loadHubForum();
      };
      actions.append(remove);
    }

    const replies = card.querySelector(".forum-replies");
    for (const item of post.replies || []) {
      const row = document.createElement("div");
      row.className = "forum-reply";
      row.innerHTML = `<strong>${esc(item.username)}</strong><span>${esc(item.body)}</span><small>${fmtTime(item.created_at)}</small>`;
      replies.append(row);
    }

    list.append(card);
  }
}

async function loadHubSecurity() {
  const [dashboard, blocked] = await Promise.all([
    apiGet("/api/social/dashboard"),
    apiGet("/api/messenger/blocked"),
  ]);

  hubContent.innerHTML = `
    <div class="hub-columns">
      <section class="hub-card">
        <div class="hub-card-head"><strong>Двухфакторная защита</strong><span>${dashboard.me?.twoFactor ? "Включена" : "Выключена"}</span></div>
        <p class="hub-muted">TOTP-коды работают и на сайте, и в лаунчере.</p>
        <div class="hub-actions-line">
          <button id="twofa-setup" class="mini-button">Настроить 2FA</button>
          <button id="twofa-disable" class="mini-button">Отключить 2FA</button>
        </div>
        <div id="twofa-secret" class="secret-box hidden"></div>
      </section>
      <section class="hub-card">
        <div class="hub-card-head"><strong>Заблокированные</strong><span>${(blocked.users || []).length}</span></div>
        <div id="blocked-list-hub" class="hub-list"></div>
      </section>
    </div>
    <section class="hub-card export-card">
      <div><strong>Экспорт данных</strong><p class="hub-muted">Получить JSON с данными аккаунта, друзьями и сообщениями.</p></div>
      <button id="export-data-button" class="mini-button">Показать экспорт</button>
    </section>
  `;

  document.getElementById("twofa-setup").onclick = async () => {
    try {
      const setup = await apiPost("/api/social/2fa/setup", {});
      const box = document.getElementById("twofa-secret");
      box.classList.remove("hidden");
      box.textContent = "SECRET: " + setup.secret;
      const code = prompt("Добавь secret в приложение-аутентификатор и введи код:");
      if (!code) return;
      await apiPost("/api/social/2fa/enable", { code: code.trim() });
      showToast("2FA", "Двухфакторная защита включена.");
      await loadHubSecurity();
    } catch (error) {
      showToast("2FA", String(error));
    }
  };

  document.getElementById("twofa-disable").onclick = async () => {
    const code = prompt("Код 2FA:");
    if (code === null) return;
    try {
      await apiPost("/api/social/2fa/disable", { code: code.trim() });
      showToast("2FA", "2FA отключена.");
      await loadHubSecurity();
    } catch (error) {
      showToast("2FA", String(error));
    }
  };

  const list = document.getElementById("blocked-list-hub");
  for (const user of blocked.users || []) {
    const row = document.createElement("div");
    row.className = "hub-row";
    row.innerHTML = `<span class="hub-row-main"><strong>${esc(user.username)}</strong><small>${esc(user.role || "Игрок")}</small></span>`;
    const button = document.createElement("button");
    button.className = "mini-button";
    button.textContent = "Разблокировать";
    button.onclick = async () => {
      await apiPost("/api/messenger/unblock", { targetId: user.id });
      await loadHubSecurity();
    };
    row.append(button);
    list.append(row);
  }

  document.getElementById("export-data-button").onclick = async () => {
    try {
      const text = await invoke("api_get_text", { path: "/api/social/export", query: {} });
      const overlay = document.createElement("div");
      overlay.className = "media-overlay";
      const box = document.createElement("div");
      box.className = "export-overlay";
      const close = document.createElement("button");
      close.className = "media-close";
      close.textContent = "×";
      close.onclick = () => overlay.remove();
      const pre = document.createElement("pre");
      pre.textContent = text;
      box.append(close, pre);
      overlay.append(box);
      document.body.append(overlay);
    } catch (error) {
      showToast("Экспорт", String(error));
    }
  };
}

async function loadHubSessions() {
  const payload = await apiGet("/api/social/sessions");

  hubContent.innerHTML = `
    <div class="hub-actions-line">
      <button id="logout-all-button" class="mini-button danger-mini">Выйти со всех устройств</button>
    </div>
    <div class="hub-columns">
      <section class="hub-card">
        <div class="hub-card-head"><strong>Активные сессии</strong><span>${(payload.sessions || []).length}</span></div>
        <div id="sessions-list" class="hub-list"></div>
      </section>
      <section class="hub-card">
        <div class="hub-card-head"><strong>История входов</strong><span>${(payload.history || []).length}</span></div>
        <div id="history-list" class="hub-list"></div>
      </section>
    </div>
  `;

  document.getElementById("logout-all-button").onclick = async () => {
    if (!confirm("Выйти со всех устройств?")) return;
    try {
      await apiPost("/api/messenger/logout-all", {});
    } catch {}
    try {
      await invoke("auth_logout");
    } catch {}
    stopMessengerRefresh();
    authGate.classList.remove("hidden");
    setAuthMode("login");
    showToast("Laminari", "Все сессии завершены.");
  };

  const sessionsList = document.getElementById("sessions-list");
  for (const session of payload.sessions || []) {
    const row = document.createElement("div");
    row.className = "hub-row";
    row.innerHTML = `<span class="hub-row-main"><strong>${esc(session.device_label || "Устройство")}${session.session_id === payload.current ? " · текущая" : ""}</strong><small>${esc(session.user_agent || "")}<br>${fmtTime(session.last_seen_at || session.created_at)}</small></span>`;
    if (session.session_id !== payload.current) {
      const revoke = document.createElement("button");
      revoke.className = "mini-button danger-mini";
      revoke.textContent = "Завершить";
      revoke.onclick = async () => {
        await apiPost("/api/social/session/revoke", { sessionId: session.session_id });
        await loadHubSessions();
      };
      row.append(revoke);
    }
    sessionsList.append(row);
  }

  const historyList = document.getElementById("history-list");
  for (const item of payload.history || []) {
    const row = document.createElement("div");
    row.className = "hub-row";
    row.innerHTML = `<span class="hub-row-main"><strong>${item.successful ? "Успешный вход" : "Ошибка входа"}</strong><small>${esc(item.user_agent || "")}<br>${fmtTime(item.created_at)}</small></span>`;
    historyList.append(row);
  }
}

async function loadHubInvites() {
  const foldersPayload = await apiGet("/api/social/folders");

  hubContent.innerHTML = `
    <div class="hub-columns">
      <section class="hub-card">
        <div class="hub-card-head"><strong>Приглашение в друзья</strong><span>7 дней</span></div>
        <p class="hub-muted">Создай код, которым другой пользователь сможет добавить тебя в друзья.</p>
        <button id="create-invite-button" class="primary-button compact-action"><span>Создать код</span><span>+</span></button>
        <div id="invite-result" class="secret-box hidden"></div>
        <button id="invite-qr-button" class="mini-button hidden">Показать QR</button>
      </section>
      <section class="hub-card">
        <div class="hub-card-head"><strong>Принять код</strong><span>INVITE</span></div>
        <div class="inline-form"><input id="invite-code-input" placeholder="XXXXXXXXXX"><button id="accept-invite-button" class="mini-button">Принять</button></div>
      </section>
    </div>
    <section class="hub-card">
      <div class="hub-card-head"><strong>Папки друзей</strong><span>${(foldersPayload.folders || []).length}</span></div>
      <div class="hub-actions-line"><button id="create-folder-button" class="mini-button">+ Новая папка</button></div>
      <div id="folders-list" class="hub-list"></div>
    </section>
  `;

  document.getElementById("create-invite-button").onclick = async () => {
    const payload = await apiPost("/api/social/invite/create", {});
    const box = document.getElementById("invite-result");
    box.classList.remove("hidden");
    box.dataset.url = payload.url || "";
    box.textContent = "Код: " + payload.code;
    document.getElementById("invite-qr-button").classList.remove("hidden");
  };

  document.getElementById("invite-qr-button").onclick = async () => {
    const url = document.getElementById("invite-result").dataset.url;
    if (!url) return;
    try {
      const payload = await invoke("api_media", { path: "/api/social/qr", query: { text: url } });
      const overlay = document.createElement("div");
      overlay.className = "media-overlay";
      const box = document.createElement("div");
      box.className = "media-box";
      const close = document.createElement("button");
      close.className = "media-close";
      close.textContent = "×";
      close.onclick = () => overlay.remove();
      const image = document.createElement("img");
      image.src = `data:${payload.mime};base64,${payload.data}`;
      image.alt = "QR приглашения";
      box.append(close, image);
      overlay.append(box);
      document.body.append(overlay);
    } catch (error) {
      showToast("QR", String(error));
    }
  };

  document.getElementById("accept-invite-button").onclick = async () => {
    const code = document.getElementById("invite-code-input").value.trim();
    if (!code) return;
    await apiPost("/api/social/invite/accept", { code });
    showToast("Приглашение", "Пользователь добавлен в друзья.");
    await loadFriends();
  };

  document.getElementById("create-folder-button").onclick = async () => {
    const name = prompt("Название папки:");
    if (!name?.trim()) return;
    await apiPost("/api/social/folder/create", { name });
    await loadHubInvites();
  };

  const list = document.getElementById("folders-list");
  for (const folder of foldersPayload.folders || []) {
    const row = document.createElement("div");
    row.className = "hub-row";
    row.innerHTML = `<span class="hub-row-main"><strong>${esc(folder.name)}</strong><small>${Number(folder.count || 0)} друзей</small></span>`;
    const add = document.createElement("button");
    add.className = "mini-button";
    add.textContent = "Добавить друга";
    add.onclick = async () => {
      const username = prompt("Ник друга:");
      if (!username) return;
      const friend = friends.find((item) => item.username.toLowerCase() === username.trim().toLowerCase());
      if (!friend) return showToast("Папки", "Друг не найден.");
      await apiPost("/api/social/folder/add", { folderId: folder.id, friendId: friend.id });
      await loadHubInvites();
    };
    row.append(add);
    list.append(row);
  }
}

async function loadHubExtras() {
  const [stickers, emoji] = await Promise.all([
    apiGet("/api/social/stickers"),
    apiGet("/api/social/emoji"),
  ]);

  hubContent.innerHTML = `
    <div class="hub-columns">
      <section class="hub-card">
        <div class="hub-card-head"><strong>Стикеры</strong><span>${(stickers.items || []).length}</span></div>
        <label class="profile-upload"><input id="sticker-upload" type="file" accept="image/png,image/webp,image/gif" hidden><span>Загрузить стикер</span></label>
        <div id="stickers-list" class="hub-list"></div>
      </section>
      <section class="hub-card">
        <div class="hub-card-head"><strong>Эмодзи</strong><span>${(emoji.items || []).length}</span></div>
        <label class="profile-upload"><input id="emoji-upload" type="file" accept="image/png,image/webp,image/gif" hidden><span>Загрузить эмодзи</span></label>
        <div id="emoji-list" class="hub-list"></div>
      </section>
    </div>
    <section class="hub-card">
      <div class="hub-card-head"><strong>Жалоба</strong><span>REPORT</span></div>
      <p class="hub-muted">Отправить жалобу на пользователя или сообщение.</p>
      <div class="inline-form"><input id="report-user-input" placeholder="Ник пользователя"><input id="report-reason-input" placeholder="Причина"><button id="report-send-button" class="mini-button">Отправить</button></div>
    </section>
  `;

  function renderAssets(id, items) {
    const list = document.getElementById(id);
    for (const item of items || []) {
      const row = document.createElement("div");
      row.className = "hub-row";
      row.innerHTML = `<span class="hub-row-main"><strong>${esc(item.name)}</strong><small>${item.mine ? "Твой" : "Общий"}</small></span>`;
      list.append(row);
    }
  }

  renderAssets("stickers-list", stickers.items);
  renderAssets("emoji-list", emoji.items);

  document.getElementById("sticker-upload").onchange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    await apiUpload("/api/social/sticker-upload", file);
    showToast("Стикер", "Стикер загружен.");
    await loadHubExtras();
  };

  document.getElementById("emoji-upload").onchange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    await apiUpload("/api/social/emoji-upload", file);
    showToast("Эмодзи", "Эмодзи загружен.");
    await loadHubExtras();
  };

  document.getElementById("report-send-button").onclick = async () => {
    const username = document.getElementById("report-user-input").value.trim();
    const reason = document.getElementById("report-reason-input").value.trim();
    if (!username || !reason) return;
    const search = await apiGet("/api/messenger/search", { q: username });
    const user = (search.users || []).find((item) => item.username.toLowerCase() === username.toLowerCase());
    if (!user) return showToast("Жалоба", "Пользователь не найден.");
    await apiPost("/api/social/report", { targetId: user.id, reason });
    showToast("Жалоба", "Жалоба отправлена.");
  };
}

async function loadHubChangelog() {
  const payload = await apiGet("/api/social/changelog");

  hubContent.innerHTML = `
    <div id="changelog-create" class="hub-card ${currentMe?.role === "creator" ? "" : "hidden"}">
      <div class="hub-card-head"><strong>Добавить запись</strong><span>CREATOR</span></div>
      <div class="changelog-form"><input id="changelog-version" placeholder="Версия"><input id="changelog-title" placeholder="Заголовок"><textarea id="changelog-body" placeholder="Изменения"></textarea><button id="changelog-add" class="mini-button">Опубликовать</button></div>
    </div>
    <div id="changelog-list" class="changelog-list"></div>
  `;

  if (currentMe?.role === "creator") {
    document.getElementById("changelog-add").onclick = async () => {
      await apiPost("/api/social/changelog/add", {
        version: document.getElementById("changelog-version").value.trim(),
        title: document.getElementById("changelog-title").value.trim(),
        body: document.getElementById("changelog-body").value.trim(),
      });
      await loadHubChangelog();
    };
  }

  const list = document.getElementById("changelog-list");
  for (const entry of payload.entries || []) {
    const card = document.createElement("article");
    card.className = "hub-card changelog-card";
    card.innerHTML = `<span>${esc(entry.version)}</span><h3>${esc(entry.title)}</h3><p>${esc(entry.body)}</p><small>${fmtTime(entry.created_at)}</small>`;
    list.append(card);
  }
}

async function loadHubAdmin() {
  if (!(currentMe?.isAdmin || currentMe?.role === "creator")) {
    hubContent.innerHTML = '<div class="hub-error">Нет доступа.</div>';
    return;
  }

  const requests = [
    apiGet("/api/social/admin/reports").catch(() => ({ reports: [] })),
    apiGet("/api/social/admin/log").catch(() => ({ entries: [] })),
  ];
  const [reports, log] = await Promise.all(requests);

  hubContent.innerHTML = `
    <section class="hub-card">
      <div class="hub-card-head"><strong>Пользователи</strong><span>ADMIN</span></div>
      <div class="inline-form"><input id="admin-search-input" placeholder="Ник"><button id="admin-search-button" class="mini-button">Найти</button></div>
      <div id="admin-users-list" class="hub-list"></div>
    </section>
    <div class="hub-columns">
      <section class="hub-card"><div class="hub-card-head"><strong>Жалобы</strong><span>${(reports.reports || []).length}</span></div><div id="admin-reports-list" class="hub-list"></div></section>
      <section class="hub-card"><div class="hub-card-head"><strong>Лог модерации</strong><span>${(log.entries || []).length}</span></div><div id="admin-log-list" class="hub-list"></div></section>
    </div>
  `;

  document.getElementById("admin-search-button").onclick = async () => {
    const q = document.getElementById("admin-search-input").value.trim();
    try {
      const payload = await apiGet("/api/social/admin/users", { q });
      renderAdminUsers(payload.users || []);
    } catch (error) {
      showToast("Admin", String(error));
    }
  };

  const reportsList = document.getElementById("admin-reports-list");
  for (const report of reports.reports || []) {
    const row = document.createElement("div");
    row.className = "hub-row";
    row.innerHTML = `<span class="hub-row-main"><strong>${esc(report.target || "Без цели")}</strong><small>${esc(report.reason)} · ${esc(report.status)}</small></span>`;
    const resolve = document.createElement("button");
    resolve.className = "mini-button";
    resolve.textContent = "Закрыть";
    resolve.onclick = async () => {
      await apiPost("/api/social/admin/report", { reportId: report.id, status: "resolved" });
      await loadHubAdmin();
    };
    row.append(resolve);
    reportsList.append(row);
  }

  const logList = document.getElementById("admin-log-list");
  for (const item of log.entries || []) {
    const row = document.createElement("div");
    row.className = "hub-row";
    row.innerHTML = `<span class="hub-row-main"><strong>${esc(item.action)}</strong><small>${esc(item.actor)} → ${esc(item.target || "—")} · ${esc(item.details || "")}</small></span>`;
    logList.append(row);
  }
}

function renderAdminUsers(users) {
  const list = document.getElementById("admin-users-list");
  list.replaceChildren();

  for (const user of users) {
    const row = document.createElement("div");
    row.className = "hub-row admin-user-row";
    row.innerHTML = `<span class="hub-row-main"><strong>${esc(user.username)}</strong><small>${esc(user.role || "player")} · ${user.frozen ? "заморожен" : "активен"} · ${Number(user.points || 0)} pts</small></span>`;

    const role = document.createElement("button");
    role.className = "mini-button";
    role.textContent = "Роль";
    role.onclick = async () => {
      const value = prompt("Ключ роли:\n" + ROLE_KEYS.join(", "), user.role || "player");
      if (!value) return;
      await apiPost("/api/social/admin/user", { targetId: user.id, action: "role", role: value.trim() });
      showToast("Admin", "Роль обновлена.");
    };

    const freeze = document.createElement("button");
    freeze.className = "mini-button";
    freeze.textContent = user.frozen ? "Разморозить" : "Заморозить";
    freeze.onclick = async () => {
      await apiPost("/api/social/admin/user", { targetId: user.id, action: user.frozen ? "unfreeze" : "freeze" });
      document.getElementById("admin-search-button").click();
    };

    row.append(role, freeze);
    list.append(row);
  }
}

async function initializeBackend() {
  try {
    const status = await invoke("launcher_status");
    backendStatus.textContent = "СИСТЕМА ГОТОВА";
    runtimeVersion.textContent = `Rust · ${status.version}`;
  } catch (error) {
    backendStatus.textContent = "ОШИБКА BACKEND";
    authError.textContent = String(error);
  }
}

initializeBackend();
