let __allOrders = [];
let __allKeys = [];
let __pollTimer = null;

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  const text = await res.text();
  let data = {};
  try { data = JSON.parse(text); } catch { data = {}; }
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function formatNumber(n) {
  const x = Number(n || 0);
  return x.toLocaleString("vi-VN");
}
function formatDateTimeLocal(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return String(iso);
  }
}


function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function renderKeyItem(container, k) {
  const item = el("div", "log-item");
  const line = el("div", "log-line");
  const time = el("div", "log-time");

  const statusText = k.isActivated ? "activated" : "unactive";
  const statusCls = k.isActivated ? "key-status active" : "key-status inactive";
  const status = el("div", statusCls, statusText);

  const code = el("div", "key-code", k.key || "-");

  line.appendChild(code);
  line.appendChild(status);

  const isAct = !!k.isActivated;
  const label = isAct ? "Activated" : "Created";
  const t = (isAct ? k.activatedAt : k.createdAt) || (k.activatedAt || k.createdAt) || "";
  const email = (k.email || "").trim();
  time.textContent = t
    ? `${label}: ${formatDateTimeLocal(t)}${email ? ` for ${email}` : ""}`
    : "";

  item.appendChild(line);
  item.appendChild(time);
  container.appendChild(item);
}


function renderOrders(tbody, orders) {
  tbody.innerHTML = "";

  if (!orders.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 3;
    td.textContent = "No waiting orders.";
    td.style.opacity = "0.7";
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  for (const o of orders) {
    const tr = document.createElement("tr");
    tr.style.cursor = "default";

    const tdCode = document.createElement("td");
    tdCode.textContent = o.order_code || o.orderCode || "-";

    const tdEmail = document.createElement("td");
    tdEmail.textContent = o.email || "-";

    const tdAction = document.createElement("td");
    tdAction.style.textAlign = "right";
    tdAction.style.whiteSpace = "nowrap";

    const btnDel = el("button", "mini-btn btn-ban", "Delete");
    btnDel.onclick = () => onDeleteOrder(o.id);

    const btnOk = el("button", "mini-btn btn-unban", "Approve");
    btnOk.onclick = () => onApproveOrder(o.id);

    tdAction.appendChild(btnDel);
    tdAction.appendChild(btnOk);

    tr.appendChild(tdCode);
    tr.appendChild(tdEmail);
    tr.appendChild(tdAction);

    tbody.appendChild(tr);
  }
}

async function onApproveOrder(id) {
  if (!id) return;
  try {
    const data = await fetchJson("/api/admin/orders/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });

    // approve OK, reload
    await loadAll();
  } catch (e) {
    alert("Approve failed: " + e.message);
  }
}

async function onDeleteOrder(id) {
  if (!id) return;
  if (!confirm("Delete this order?")) return;

  try {
    await fetchJson("/api/admin/orders/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    await loadAll();
  } catch (e) {
    alert("Delete failed: " + e.message);
  }
}

async function loadSummary(keys, waitingOrders) {
  const totalKeys = keys.length;
  const activatedKeys = keys.filter(k => k.isActivated).length;

  document.getElementById("sum-keys").textContent = formatNumber(totalKeys);
  document.getElementById("sum-revenue").textContent = formatNumber(totalKeys * 50000);
  document.getElementById("sum-activated").textContent = formatNumber(activatedKeys);
  document.getElementById("sum-waiting").textContent = formatNumber(waitingOrders.length);
}

async function loadAll() {
  // keys
  const keyList = document.getElementById("key-list");
  keyList.innerHTML = "";

  const keysRes = await fetchJson("/api/admin/license-keys?limit=200");
  const keys = [...(keysRes.keys || [])].reverse();

  __allKeys = keys.map(k => ({
    id: k.id,
    key: k.key,
    email: k.email,
    isActivated: !!k.isActivated,
    createdAt: k.createdAt,
    activatedAt: k.activatedAt,
  }));

  applyKeyFilter();

  // waiting orders
  const ordersRes = await fetchJson("/api/admin/orders?status=pending");
  __allOrders = (ordersRes.orders || []).map(o => ({
    id: o.id,
    email: o.email,
    order_code: o.order_code,
  }));

  applyOrderFilter(); // render theo search
  await loadSummary(keys, __allOrders);
}
function applyOrderFilter() {
  const q = String(document.getElementById("order-search")?.value || "")
    .trim()
    .toLowerCase();

  const filtered = !q
    ? __allOrders
    : __allOrders.filter(o => {
        const code = String(o.order_code || "").toLowerCase();
        const email = String(o.email || "").toLowerCase();
        return code.includes(q) || email.includes(q);
      });

  renderOrders(document.getElementById("orders-tbody"), filtered);
}
async function refreshWaitingOrders() {
  try {
    const ordersRes = await fetchJson("/api/admin/orders?status=pending");
    const newOrders = (ordersRes.orders || []).map(o => ({
      id: o.id,
      email: o.email,
      order_code: o.order_code,
    }));
    const oldSig = JSON.stringify(__allOrders.map(x => [x.id, x.order_code, x.email]));
    const newSig = JSON.stringify(newOrders.map(x => [x.id, x.order_code, x.email]));
    if (oldSig === newSig) return;

    __allOrders = newOrders;
    applyOrderFilter();

    // cập nhật Summary: Waiting Orders
    const elWaiting = document.getElementById("sum-waiting");
    if (elWaiting) elWaiting.textContent = formatNumber(__allOrders.length);
  } catch (e) {
    console.warn("Polling orders failed:", e.message);
  }
}

async function refreshKeys() {
  try {
    const keysRes = await fetchJson("/api/admin/license-keys?limit=200");

    const newKeys = [...(keysRes.keys || [])].reverse().map(k => ({
      id: k.id,
      key: k.key,
      email: k.email,
      isActivated: !!k.isActivated,
      createdAt: k.createdAt,
      activatedAt: k.activatedAt,
    }));

    const oldSig = JSON.stringify(__allKeys.map(x => [x.id, x.isActivated, x.activatedAt, x.createdAt, x.email, x.key]));
    const newSig = JSON.stringify(newKeys.map(x => [x.id, x.isActivated, x.activatedAt, x.createdAt, x.email, x.key]));
    if (oldSig === newSig) return;

    __allKeys = newKeys;

    applyKeyFilter();

    const activatedKeys = __allKeys.filter(k => k.isActivated).length;

    const elKeys = document.getElementById("sum-keys");
    if (elKeys) elKeys.textContent = formatNumber(__allKeys.length);

    const elRevenue = document.getElementById("sum-revenue");
    if (elRevenue) elRevenue.textContent = formatNumber(__allKeys.length * 50000);

    const elActivated = document.getElementById("sum-activated");
    if (elActivated) elActivated.textContent = formatNumber(activatedKeys);

  } catch (e) {
    console.warn("Polling keys failed:", e.message);
  }
}

function applyKeyFilter() {
  const q = String(document.getElementById("key-search")?.value || "")
    .trim()
    .toLowerCase();

  const keyList = document.getElementById("key-list");
  if (!keyList) return;

  keyList.innerHTML = "";

  const filtered = !q
    ? __allKeys
    : __allKeys.filter(k => {
        const code = String(k.key || "").toLowerCase();
        const email = String(k.email || "").toLowerCase();
        return code.includes(q) || email.includes(q);
      });

  for (const k of filtered) renderKeyItem(keyList, k);
  keyList.scrollTop = keyList.scrollHeight;
}

// setup search
document.addEventListener("DOMContentLoaded", () => {
  const input = document.getElementById("order-search");
  if (input) input.addEventListener("input", applyOrderFilter);
  
  const keyInput = document.getElementById("key-search");
  if (keyInput) keyInput.addEventListener("input", applyKeyFilter);


  if (__pollTimer) clearInterval(__pollTimer);
  __pollTimer = setInterval(() => {
    refreshWaitingOrders();
    refreshKeys();
  }, 5000);
});


loadAll().catch(err => {
  console.error(err);
  alert("Load failed: " + err.message);
});
