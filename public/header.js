// ===== Header loader + Lock=====
const ADMIN_PASS = "123";
const LOCK_KEY = "ERS_ADMIN_UNLOCKED";

function setActiveNav() {
  const path = location.pathname.toLowerCase();

  const isPlayers = path.includes("players");
  const isSaves = path.includes("saves") || path.includes("admin");

  document.querySelectorAll(".nav-link").forEach(a => a.classList.remove("active"));

  const sel = document.querySelector(`[data-nav="${isSaves ? "saves" : "players"}"]`);
  if (sel) sel.classList.add("active");
}


function showLock() {
  const overlay = document.getElementById("admin-lock-overlay");
  const input = document.getElementById("admin-pass-input");
  if (!overlay || !input) return;

  overlay.classList.add("show");
  input.value = "";

  setTimeout(() => input.focus(), 0);
}

function hideLock() {
  const overlay = document.getElementById("admin-lock-overlay");
  if (overlay) overlay.classList.remove("show");
}


function ensureUnlocked() {
  if (sessionStorage.getItem(LOCK_KEY) === "1") {
    hideLock();
    return;
  }
  showLock();
}

function wireLockInput() {
  const input = document.getElementById("admin-pass-input");
  if (!input) return;

  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const val = (input.value || "").trim();
    if (val === ADMIN_PASS) {
      sessionStorage.setItem(LOCK_KEY, "1");
      hideLock();
    } else {
      input.value = "";
    }
  });

  // click overlay để focus input
  const overlay = document.getElementById("admin-lock-overlay");
  if (overlay) {
    overlay.addEventListener("click", () => input.focus());
  }
}

window.__ERS_Header = {
  init: () => {
    setActiveNav();
    wireLockInput();
    ensureUnlocked();
  }
};
