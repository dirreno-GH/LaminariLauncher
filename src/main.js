const tauri = window.__TAURI__;
const invoke = tauri?.core?.invoke;
const currentWindow = tauri?.window?.getCurrentWindow ? tauri.window.getCurrentWindow() : null;

const pages = {
  home: document.getElementById("home-page"),
  library: document.getElementById("library-page"),
  mods: document.getElementById("mods-page"),
  messenger: document.getElementById("messenger-page"),
  profile: document.getElementById("profile-page"),
  settings: document.getElementById("settings-page"),
};

const pageNames = {
  home: "Главная",
  library: "Библиотека",
  mods: "Моды",
  messenger: "Мессенджер",
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

let toastTimer;
let friends = [];
let currentProfile = null;

function showToast(title, message) {
  clearTimeout(toastTimer);
  toastTitle.textContent = title;
  toastMessage.textContent = message;
  toast.classList.add("show");
  toastTimer = setTimeout(() => toast.classList.remove("show"), 3400);
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
  const me = await invoke("account_me");
  authGate.classList.add("hidden");
  await loadProfile(me);
  await loadFriends();
  backendStatus.textContent = "АККАУНТ ПОДКЛЮЧЁН";
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
    loadFriends().catch((error) => showToast("Мессенджер", String(error)));
  }

  if (page === "profile") {
    loadProfile().catch((error) => showToast("Профиль", String(error)));
  }
}

navItems.forEach((item) => {
  item.addEventListener("click", () => openPage(item.dataset.page));
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
  try {
    await currentWindow?.minimize();
  } catch (error) {
    showToast("Окно", String(error));
  }
});

document.getElementById("maximize-button").addEventListener("click", async () => {
  try {
    await currentWindow?.toggleMaximize();
  } catch (error) {
    showToast("Окно", String(error));
  }
});

document.getElementById("close-button").addEventListener("click", async () => {
  try {
    await currentWindow?.close();
  } catch (error) {
    showToast("Окно", String(error));
  }
});

function applyFrame(frameStyle) {
  profileFrame.className = "profile-frame frame-" + (frameStyle || "classic");
}

async function loadProfile(meOverride = null) {
  const me = meOverride || await invoke("account_me");
  const settings = await invoke("account_profile");

  currentProfile = { ...me, ...settings };
  profilePreviewName.textContent = me.username || "Laminari";
  profilePreviewRole.textContent = me.roleLabel || me.role || "Игрок";
  profilePreviewStatus.textContent = settings.status || "В Laminari";
  profileAccountName.textContent = me.username || "—";
  profileAccountRole.textContent = me.roleLabel || me.role || "—";
  profileAvatar.textContent = ((me.username || "L")[0] || "L").toUpperCase();
  profileStatusInput.value = settings.status || "";
  profileBioInput.value = settings.bio || "";
  profileFrameInput.value = settings.frameStyle || "classic";
  applyFrame(settings.frameStyle || "classic");
}

profileFrameInput.addEventListener("change", () => applyFrame(profileFrameInput.value));

document.getElementById("save-profile-button").addEventListener("click", async () => {
  try {
    await invoke("account_save_profile", {
      status: profileStatusInput.value.trim(),
      bio: profileBioInput.value.trim(),
      frameStyle: profileFrameInput.value,
      privacyMessages: currentProfile?.privacyMessages || "friends",
      privacyRequests: currentProfile?.privacyRequests || "everyone",
    });
    await loadProfile();
    showToast("Профиль", "Профиль синхронизирован с сайтом.");
  } catch (error) {
    showToast("Профиль", String(error));
  }
});

document.getElementById("logout-button").addEventListener("click", async () => {
  try {
    await invoke("auth_logout");
  } catch {}

  friends = [];
  renderFriends();
  authGate.classList.remove("hidden");
  setAuthMode("login");
  showToast("Laminari", "Ты вышел из аккаунта.");
});

async function loadFriends() {
  const payload = await invoke("account_friends");
  friends = Array.isArray(payload.friends) ? payload.friends : [];
  renderFriends(friendSearchInput.value);
}

function renderFriends(filter = "") {
  const query = filter.trim().toLocaleLowerCase("ru-RU");
  const visibleFriends = friends.filter((friend) =>
    String(friend.username || "").toLocaleLowerCase("ru-RU").includes(query)
  );

  friendsList.replaceChildren();
  friendsCount.textContent = String(friends.length);
  friendsEmpty.style.display = visibleFriends.length ? "none" : "flex";

  if (!visibleFriends.length && query) {
    friendsEmpty.querySelector("strong").textContent = "Ничего не найдено";
    friendsEmpty.querySelector("span").textContent = "Попробуй другой ник.";
  } else if (!friends.length) {
    friendsEmpty.querySelector("strong").textContent = "Список друзей пуст";
    friendsEmpty.querySelector("span").textContent = "Добавь пользователя сайта Laminari в друзья.";
  }

  visibleFriends.forEach((friend) => {
    const card = document.createElement("button");
    card.className = "friend-card";

    const avatar = document.createElement("span");
    avatar.className = "friend-avatar frame-" + (friend.frameStyle || "classic");
    avatar.textContent = ((friend.username || "L")[0] || "L").toUpperCase();

    const copy = document.createElement("span");
    copy.className = "friend-copy";

    const name = document.createElement("strong");
    name.textContent = friend.username || "Пользователь";

    const details = document.createElement("span");
    details.textContent = (friend.role || "Игрок") + " · " + (friend.online ? "В сети" : "Не в сети");

    copy.append(name, details);

    const action = document.createElement("span");
    action.className = "friend-action";
    action.textContent = "›";

    card.append(avatar, copy, action);
    card.addEventListener("click", () => {
      showToast(friend.username || "Друг", "Личный чат подключим следующим этапом.");
    });

    friendsList.append(card);
  });
}

friendSearchInput.addEventListener("input", () => renderFriends(friendSearchInput.value));

document.getElementById("add-friend-button").addEventListener("click", async () => {
  const username = window.prompt("Введите ник пользователя Laminari:");
  if (!username?.trim()) {
    return;
  }

  try {
    const payload = await invoke("account_search_users", { query: username.trim() });
    const users = Array.isArray(payload.users) ? payload.users : [];
    const exact = users.find((user) =>
      String(user.username || "").toLocaleLowerCase("ru-RU") === username.trim().toLocaleLowerCase("ru-RU")
    );
    const target = exact || (users.length === 1 ? users[0] : null);

    if (!target) {
      throw new Error(users.length ? "Найдено несколько пользователей. Уточни ник." : "Пользователь не найден.");
    }

    if (target.isFriend) {
      throw new Error("Этот пользователь уже у тебя в друзьях.");
    }

    if (target.outgoing) {
      throw new Error("Заявка этому пользователю уже отправлена.");
    }

    await invoke("account_send_friend_request", { targetId: target.id });
    showToast("Друзья", "Заявка отправлена пользователю " + target.username + ".");
  } catch (error) {
    showToast("Друзья", String(error));
  }
});

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
