const tauri = window.__TAURI__;
const invoke = tauri?.core?.invoke;
const currentWindow = tauri?.window?.getCurrentWindow?.();

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

let toastTimer;

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
  await currentWindow?.minimize();
});

document.getElementById("maximize-button").addEventListener("click", async () => {
  await currentWindow?.toggleMaximize();
});

document.getElementById("close-button").addEventListener("click", async () => {
  await currentWindow?.close();
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

initializeBackend();
