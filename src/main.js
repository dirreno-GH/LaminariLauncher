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

const navItems = [...document.querySelectorAll(".nav-item")];
const pageTitle = document.getElementById("page-title");
const toast = document.getElementById("toast");
const toastTitle = document.getElementById("toast-title");
const toastMessage = document.getElementById("toast-message");
const backendStatus = document.getElementById("backend-status");
const runtimeVersion = document.getElementById("runtime-version");

const profileNameInput = document.getElementById("profile-name-input");
const profileStatusInput = document.getElementById("profile-status-input");
const profileRoleInput = document.getElementById("profile-role-input");
const profilePreviewName = document.getElementById("profile-preview-name");
const profilePreviewStatus = document.getElementById("profile-preview-status");
const profilePreviewRole = document.getElementById("profile-preview-role");
const profileAvatar = document.getElementById("profile-avatar");

const friendSearchInput = document.getElementById("friend-search-input");
const friendsList = document.getElementById("friends-list");
const friendsEmpty = document.getElementById("friends-empty");
const friendsCount = document.getElementById("friends-count");

let toastTimer;
let friends = loadFriends();

function showToast(title, message) {
  clearTimeout(toastTimer);
  toastTitle.textContent = title;
  toastMessage.textContent = message;
  toast.classList.add("show");
  toastTimer = setTimeout(() => toast.classList.remove("show"), 3200);
}

function openPage(page) {
  Object.entries(pages).forEach(([key, element]) => {
    element.classList.toggle("active-page", key === page);
  });

  navItems.forEach((item) => {
    item.classList.toggle("active", item.dataset.page === page);
  });

  pageTitle.textContent = pageNames[page] ?? "Laminari";
}

navItems.forEach((item) => {
  item.addEventListener("click", () => openPage(item.dataset.page));
});

document.getElementById("library-card").addEventListener("click", () => openPage("library"));

async function requestImport() {
  if (!invoke) {
    showToast("Импорт сборки", "Tauri API пока недоступен.");
    return;
  }

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
    showToast("Окно", "Не удалось свернуть: " + String(error));
  }
});

document.getElementById("maximize-button").addEventListener("click", async () => {
  try {
    await currentWindow?.toggleMaximize();
  } catch (error) {
    showToast("Окно", "Не удалось изменить размер: " + String(error));
  }
});

document.getElementById("close-button").addEventListener("click", async () => {
  try {
    await currentWindow?.close();
  } catch (error) {
    showToast("Окно", "Не удалось закрыть: " + String(error));
  }
});

function loadProfile() {
  const saved = JSON.parse(localStorage.getItem("laminari_profile") || "{}");
  const profile = {
    name: saved.name || "dirreno",
    status: saved.status || "В Laminari",
    role: saved.role || "Игрок",
  };

  profileNameInput.value = profile.name;
  profileStatusInput.value = profile.status;
  profileRoleInput.value = profile.role;
  renderProfile(profile);
}

function renderProfile(profile) {
  profilePreviewName.textContent = profile.name;
  profilePreviewStatus.textContent = profile.status;
  profilePreviewRole.textContent = profile.role;
  profileAvatar.textContent = (profile.name.trim()[0] || "L").toUpperCase();
}

document.getElementById("save-profile-button").addEventListener("click", () => {
  const profile = {
    name: profileNameInput.value.trim() || "dirreno",
    status: profileStatusInput.value.trim() || "В Laminari",
    role: profileRoleInput.value,
  };

  localStorage.setItem("laminari_profile", JSON.stringify(profile));
  renderProfile(profile);
  showToast("Профиль", "Профиль сохранён на этом ПК.");
});

function loadFriends() {
  try {
    const saved = JSON.parse(localStorage.getItem("laminari_friends") || "[]");
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

function saveFriends() {
  localStorage.setItem("laminari_friends", JSON.stringify(friends));
}

function renderFriends(filter = "") {
  const query = filter.trim().toLowerCase();
  const visibleFriends = friends.filter((friend) => friend.name.toLowerCase().includes(query));

  friendsList.innerHTML = "";
  friendsCount.textContent = String(friends.length);
  friendsEmpty.style.display = visibleFriends.length ? "none" : "flex";

  if (!visibleFriends.length && query) {
    friendsEmpty.querySelector("strong").textContent = "Ничего не найдено";
    friendsEmpty.querySelector("span").textContent = "Попробуй другой ник.";
  } else if (!friends.length) {
    friendsEmpty.querySelector("strong").textContent = "Список друзей пуст";
    friendsEmpty.querySelector("span").textContent = "Нажми «Добавить друга», чтобы добавить первый локальный контакт.";
  }

  visibleFriends.forEach((friend) => {
    const card = document.createElement("button");
    card.className = "friend-card";
    card.innerHTML = `
      <span class="friend-avatar">${escapeHtml((friend.name[0] || "L").toUpperCase())}</span>
      <span class="friend-copy">
        <strong>${escapeHtml(friend.name)}</strong>
        <span>${escapeHtml(friend.status || "Не в сети")}</span>
      </span>
      <span class="friend-action">›</span>
    `;

    card.addEventListener("click", () => {
      showToast(friend.name, "Личный чат подключим следующим этапом.");
    });

    friendsList.appendChild(card);
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

friendSearchInput.addEventListener("input", () => renderFriends(friendSearchInput.value));

document.getElementById("add-friend-button").addEventListener("click", () => {
  const name = window.prompt("Введите ник друга:");
  if (!name?.trim()) {
    return;
  }

  const cleanName = name.trim().slice(0, 24);
  const exists = friends.some((friend) => friend.name.toLowerCase() === cleanName.toLowerCase());

  if (exists) {
    showToast("Друзья", "Этот пользователь уже есть в списке.");
    return;
  }

  friends.push({ name: cleanName, status: "Не в сети" });
  saveFriends();
  renderFriends(friendSearchInput.value);
  showToast("Друзья", cleanName + " добавлен в список.");
});

async function initializeBackend() {
  if (!invoke) {
    backendStatus.textContent = "TAURI НЕДОСТУПЕН";
    return;
  }

  try {
    const status = await invoke("launcher_status");
    backendStatus.textContent = "СИСТЕМА ГОТОВА";
    runtimeVersion.textContent = `Rust · ${status.version}`;
  } catch (error) {
    backendStatus.textContent = "ОШИБКА BACKEND";
    showToast("Rust backend", String(error));
  }
}

loadProfile();
renderFriends();
initializeBackend();
