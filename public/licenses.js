let __allOrders = [];
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
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);

  const pad = (x) => String(x).padStart(2, "0");
  const hh = pad(d.getHours());
  const mm = pad(d.getMinutes());
  const ss = pad(d.getSeconds());
  const dd = pad(d.getDate());
  const MM = pad(d.getMonth() + 1);
  const yyyy = d.getFullYear();

  return ` ${hh}:${mm}:${ss} ${dd}/${MM}/${yyyy}`;
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
  time.textContent = t ? `${label}: ${formatDateTimeLocal(t)}` : "";

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

    // nếu approve OK, reload
    await loadAll();
    alert(`Approved!\nKey: ${data.issuedKey || "(no key)"}`);
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
  const keys = keysRes.keys || [];

  for (const k of keys) renderKeyItem(keyList, k);

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

// setup search
document.addEventListener("DOMContentLoaded", () => {
  const input = document.getElementById("order-search");
  if (input) input.addEventListener("input", applyOrderFilter);

  if (__pollTimer) clearInterval(__pollTimer);
  __pollTimer = setInterval(refreshWaitingOrders, 5000);
});


loadAll().catch(err => {
  console.error(err);
  alert("Load failed: " + err.message);
});
