// ===== UI helpers =====
function setStatus(text) {
  const el = document.getElementById("status-line");
  if (el) {
    el.textContent = text;
  }
}

function formatDateTime(value) {
  if (!value) return "";
  try {
    const d = new Date(value);
    if (isNaN(d.getTime())) return value;
    return d.toLocaleString();
  } catch {
    return value;
  }
}

// ===== Load server status =====
async function loadStatus() {
  try {
    const res = await fetch("/status");
    const json = await res.json();

    if (json.ok) {
      setStatus("Server Status: Good");
    } else {
      const msg = json.message || "Unknown error";
      setStatus("Server Status: Not Good - " + msg);
    }
  } catch (err) {
    setStatus("Server Status: Not Good - " + err.message);
  }
}

// ===== Load danh sách email (folders) =====
async function loadEmails() {
  const tbody = document.getElementById("email-table-body");
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="4">Loading...</td></tr>`;

  try {
    const res = await fetch("/api/admin/emails");
    const json = await res.json();

    if (!json.success) {
      tbody.innerHTML = `<tr><td colspan="4">Error: ${json.message || "Unknown"}</td></tr>`;
      return;
    }

    const emails = json.emails || [];
    if (emails.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4">Không có email nào.</td></tr>`;
      return;
    }

    tbody.innerHTML = "";

    emails.forEach((item) => {
      const tr = document.createElement("tr");

      const tdEmail = document.createElement("td");
      tdEmail.textContent = item.email;

      const tdCount = document.createElement("td");
      tdCount.textContent = item.saveCount;

      const tdLatest = document.createElement("td");
      tdLatest.textContent = formatDateTime(item.latestUpdatedAt);

      const tdActions = document.createElement("td");
      tdActions.style.textAlign = "right";

      const btn = document.createElement("button");
      btn.className = "mini-btn";
      btn.textContent = "Delete";
      btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        onDeleteEmailClicked(item.email);
      });
      tdActions.appendChild(btn);


      tr.appendChild(tdEmail);
      tr.appendChild(tdCount);
      tr.appendChild(tdLatest);
      tr.appendChild(tdActions);

      tr.addEventListener("click", () => {
        onEmailRowClicked(item.email);
      });

      tbody.appendChild(tr);
    });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="4">Error: ${err.message}</td></tr>`;
  }
}

function showEmailView() {
  const emailView = document.getElementById("email-view");
  const savesView = document.getElementById("saves-view");
  if (emailView) emailView.classList.remove("hidden");
  if (savesView) savesView.classList.add("hidden");
}

function showSavesView() {
  const emailView = document.getElementById("email-view");
  const savesView = document.getElementById("saves-view");
  if (emailView) emailView.classList.add("hidden");
  if (savesView) savesView.classList.remove("hidden");
}

let currentSelectedEmail = null;
// Khi click vào 1 email
function onEmailRowClicked(email) {
  currentSelectedEmail = email;

  const titleSpan = document.getElementById("saves-title");
  if (titleSpan) {
    titleSpan.textContent = `Save files of: ${email}`;
  }

  showSavesView();
  loadSavesForEmail(email);
}


// Xoá toàn bộ save của 1 email
async function onDeleteEmailClicked(email) {
  const ok = window.confirm(
    `Xoá TẤT CẢ save của email:\n\n${email}\n\nThao tác này không thể hoàn tác. Tiếp tục?`
  );
  if (!ok) return;

  try {
    const res = await fetch(`/api/admin/email/${encodeURIComponent(email)}`, {
      method: "DELETE",
    });
    const json = await res.json();

    if (!json.success) {
      alert("Xoá thất bại: " + (json.message || "Unknown"));
      return;
    }

    alert(`Đã xoá ${json.deletedCount} save(s) của ${json.email}`);
    // Reload danh sách email
    loadEmails();

    // Nếu đang xem email này thì clear bảng saves
    if (currentSelectedEmail === email) {
      currentSelectedEmail = null;
      const saveBody = document.getElementById("save-table-body");
      if (saveBody) {
        saveBody.innerHTML = "";
      }
    }
  } catch (err) {
    alert("Lỗi khi xoá: " + err.message);
  }
}

// ===== Load danh sách saves của 1 email =====
async function loadSavesForEmail(email) {
  const tbody = document.getElementById("save-table-body");
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="3">Loading...</td></tr>`;

  try {
    const res = await fetch(
      `/api/admin/saves?email=${encodeURIComponent(email)}`
    );
    const json = await res.json();

    if (!json.success) {
      tbody.innerHTML = `<tr><td colspan="3">Error: ${json.message || "Unknown"}</td></tr>`;
      return;
    }

    const saves = json.saves || [];
    if (saves.length === 0) {
      tbody.innerHTML = `<tr><td colspan="3">Không có save nào.</td></tr>`;
      return;
    }

    tbody.innerHTML = "";

    saves.forEach((item) => {
      const tr = document.createElement("tr");

      const tdUser = document.createElement("td");
      tdUser.textContent = item.username;

      const tdUpdated = document.createElement("td");
      tdUpdated.textContent = formatDateTime(item.updatedAt);

      const tdActions = document.createElement("td");
      tdActions.style.textAlign = "right";

      const btn = document.createElement("button");
      btn.className = "mini-btn";
      btn.textContent = "Delete";
      btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        onDeleteSaveClicked(email, item.username);
      });
      tdActions.appendChild(btn);

      tr.appendChild(tdUser);
      tr.appendChild(tdUpdated);
      tr.appendChild(tdActions);

      tbody.appendChild(tr);
    });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="3">Error: ${err.message}</td></tr>`;
  }
}

// Xoá 1 save cụ thể
async function onDeleteSaveClicked(email, username) {
  const ok = window.confirm(
    `Xoá save của username:\n\n${username}\n(email: ${email})\n\nKhông thể hoàn tác. Tiếp tục?`
  );
  if (!ok) return;

  try {
    const url =
      `/api/admin/save?email=${encodeURIComponent(email)}` +
      `&username=${encodeURIComponent(username)}`;

    const res = await fetch(url, { method: "DELETE" });
    const json = await res.json();

    if (!json.success) {
      alert("Xoá thất bại: " + (json.message || "Unknown"));
      return;
    }

    alert(`Đã xoá save của ${json.username}`);
    // Reload lại danh sách saves cho email hiện tại
    if (currentSelectedEmail === email) {
      loadSavesForEmail(email);
    }
  } catch (err) {
    alert("Lỗi khi xoá: " + err.message);
  }
}

// ===== Init =====
document.addEventListener("DOMContentLoaded", () => {
  loadStatus();
  loadEmails();
  showEmailView(); // đảm bảo mở đầu ở view email

  const backBtn = document.getElementById("back-to-emails-btn");
    if (backBtn) {
    backBtn.addEventListener("click", () => {
        currentSelectedEmail = null;

        const titleSpan = document.getElementById("saves-title");
        if (titleSpan) {
        titleSpan.textContent = "Save files of: (none)";
        }

        const saveBody = document.getElementById("save-table-body");
        if (saveBody) {
        saveBody.innerHTML = "";
        }
        showEmailView();
    });
    }
});

