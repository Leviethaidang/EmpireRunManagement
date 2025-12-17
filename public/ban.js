const searchInput = document.getElementById("ban-search");
const tbody = document.getElementById("ban-tbody");

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, m => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[m]));
}

function playerLabel(email, username) {
  const prefix = (email || "").split("@")[0];
  return `${prefix}-${username}`;
}

async function apiGet(url) {
  const r = await fetch(url);
  return await r.json();
}
async function apiPost(url, body) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  return await r.json();
}

function createRow(item) {
  const tr = document.createElement("tr");

  const pName = playerLabel(item.email, item.username);
  const warnText = item.isWarned ? "TRUE" : "FALSE";
  const banText = item.isBanned ? "TRUE" : "FALSE";

  tr.innerHTML = `
    <td>${esc(pName)}</td>
    <td>${esc(item.deviceId)}</td>
    <td>${esc(warnText)}</td>
    <td>${esc(banText)}</td>
    <td class="ban-actions"></td>
  `;

  const actionTd = tr.querySelector(".ban-actions");

  const btnWarn = document.createElement("button");
  btnWarn.className = "mini-btn";
  btnWarn.textContent = "Warn (Device)";
  btnWarn.onclick = async () => {
    await apiPost("/api/admin/ban/warn-device", { deviceId: item.deviceId });
    await refresh();
  };

  const btnClearWarn = document.createElement("button");
  btnClearWarn.className = "mini-btn";
  btnClearWarn.textContent = "UnWarn (Player)";
  btnClearWarn.onclick = async () => {
    await apiPost("/api/admin/ban/clear-warn", { email: item.email, username: item.username });
    await refresh();
  };

  const btnBan = document.createElement("button");
  btnBan.className = "mini-btn";
  btnBan.textContent = item.isBanned ? "Unban" : "Ban";
  btnBan.style.minWidth = "60px";
  btnBan.onclick = async () => {
    await apiPost("/api/admin/ban/set-ban", { deviceId: item.deviceId, isBanned: !item.isBanned });
    await refresh();
  };

  actionTd.appendChild(btnWarn);
  actionTd.appendChild(btnClearWarn);
  actionTd.appendChild(btnBan);

  return tr;
}

let _timer = null;
async function refresh() {
  const q = (searchInput?.value || "").trim();
  const data = await apiGet(`/api/admin/ban/search?limit=200&q=${encodeURIComponent(q)}`);

  if (!data.success) return;

  tbody.innerHTML = "";
  for (const it of data.items || []) {
    tbody.appendChild(createRow(it));
  }
}

if (searchInput) {
  searchInput.addEventListener("input", () => {
    clearTimeout(_timer);
    _timer = setTimeout(refresh, 250);
  });
}

// initial
refresh();

setInterval(() => {
  refresh();
}, 3000);