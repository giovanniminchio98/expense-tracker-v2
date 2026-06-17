// ---------------------------------------------------------------------------
// Expense Tracker — calendar + stats.
// Auth: Firebase (Google). Storage: the user's own Google Drive appDataFolder.
// ---------------------------------------------------------------------------

import { signIn, logout, watchAuth } from "./auth.js";
import * as store from "./drive-store.js";

const el = (id) => document.getElementById(id);

// Fixed categories — no custom ones.
const CATEGORIES = [
  { id: "food", label: "Food", icon: "🍔" },
  { id: "transport", label: "Transport", icon: "🚗" },
  { id: "shopping", label: "Shopping", icon: "🛒" },
  { id: "bills", label: "Bills", icon: "🧾" },
  { id: "fun", label: "Fun", icon: "🎉" },
  { id: "other", label: "Other", icon: "🔖" },
];
const catById = (id) => CATEGORIES.find((c) => c.id === id) || CATEGORIES[CATEGORIES.length - 1];

const MONTHS = ["January","February","March","April","May","June","July",
  "August","September","October","November","December"];
const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// --- State ---
let expenses = [];                 // [{ id, date, amount, note, category, createdAt }]
let viewYear, viewMonth;           // month shown in the calendar (month: 0-11)
let amountStr = "";                // amount being typed on the dial pad
let activeDate = null;             // date the add-modal is adding to (YYYY-MM-DD)
let selectedCategory = "food";     // category chosen in the add-modal
let dayModalDate = null;
let entered = false;               // already inside the app?

// --- Drive token cache (so a reopened web app doesn't re-prompt for login) ---
const TOKEN_KEY = "et_drive_token";
function cacheToken(token) {
  try {
    // Google access tokens last ~1h; keep ours valid for 55 min to be safe.
    localStorage.setItem(TOKEN_KEY, JSON.stringify({ token, exp: Date.now() + 55 * 60 * 1000 }));
  } catch {}
}
function getCachedToken() {
  try {
    const o = JSON.parse(localStorage.getItem(TOKEN_KEY) || "null");
    if (o && o.token && o.exp > Date.now()) return o.token;
  } catch {}
  return null;
}
function clearCachedToken() {
  try { localStorage.removeItem(TOKEN_KEY); } catch {}
}

// --- Utilities ---
const pad = (n) => String(n).padStart(2, "0");
const toKey = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
const monthKey = (dateStr) => dateStr.slice(0, 7);
const todayKey = () => {
  const t = new Date();
  return toKey(t.getFullYear(), t.getMonth(), t.getDate());
};

function fmtMoney(n) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "EUR" }).format(n || 0);
}
function fmtMoneyShort(n) {
  return "€" + Math.round(n || 0);
}
function fmtDateLabel(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });
}

function totalsByDate() {
  const map = {};
  for (const e of expenses) map[e.date] = (map[e.date] || 0) + Number(e.amount || 0);
  return map;
}

function show(view) {
  el("login-view").classList.toggle("hidden", view !== "login");
  el("app-view").classList.toggle("hidden", view !== "app");
  el("loading").classList.toggle("hidden", view !== "loading");
  // The top-right user area belongs only to the app screen, so it can never
  // appear next to the login button.
  el("user-area").classList.toggle("hidden", view !== "app");
}

function toast(msg) {
  const t = el("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add("hidden"), 2800);
}

// --- Tabs ---
function switchTab(tab) {
  const isCal = tab === "calendar";
  el("calendar-panel").classList.toggle("hidden", !isCal);
  el("stats-panel").classList.toggle("hidden", isCal);
  el("tab-calendar").classList.toggle("active", isCal);
  el("tab-stats").classList.toggle("active", !isCal);
  if (!isCal) renderStats();
}

// --- Calendar rendering ---
function renderCalendar() {
  el("month-label").textContent = `${MONTHS[viewMonth]} ${viewYear}`;

  const totals = totalsByDate();
  const grid = el("calendar");
  grid.innerHTML = "";

  const firstWeekday = (new Date(viewYear, viewMonth, 1).getDay() + 6) % 7; // Mon-first
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const tKey = todayKey();

  for (let i = 0; i < firstWeekday; i++) {
    const blank = document.createElement("div");
    blank.className = "day blank";
    grid.appendChild(blank);
  }

  let monthTotal = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const key = toKey(viewYear, viewMonth, d);
    const amt = totals[key] || 0;
    monthTotal += amt;

    const cell = document.createElement("div");
    cell.className = "day" + (key === tKey ? " today" : "");
    const num = document.createElement("span");
    num.className = "day-num";
    num.textContent = String(d);
    cell.appendChild(num);
    if (amt > 0) {
      const a = document.createElement("span");
      a.className = "day-amt";
      a.textContent = fmtMoneyShort(amt);
      cell.appendChild(a);
    }
    cell.addEventListener("click", () => openDayModal(key));
    grid.appendChild(cell);
  }

  el("month-total-value").textContent = fmtMoney(monthTotal);
}

// --- Stats rendering ---
function renderStats() {
  if (!expenses.length) {
    el("stat-empty").classList.remove("hidden");
  } else {
    el("stat-empty").classList.add("hidden");
  }

  const allTotal = expenses.reduce((s, e) => s + Number(e.amount || 0), 0);
  el("stat-alltime").textContent = fmtMoney(allTotal);
  el("stat-count").textContent = String(expenses.length);

  // Monthly totals
  const byMonth = {};
  for (const e of expenses) byMonth[monthKey(e.date)] = (byMonth[monthKey(e.date)] || 0) + Number(e.amount || 0);
  const monthCount = Object.keys(byMonth).length || 1;
  el("stat-avg").textContent = fmtMoney(allTotal / monthCount);

  const now = new Date();
  const curMonthKey = toKey(now.getFullYear(), now.getMonth(), 1).slice(0, 7);
  el("stat-thismonth").textContent = fmtMoney(byMonth[curMonthKey] || 0);

  // Last 6 months bar list
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const k = toKey(d.getFullYear(), d.getMonth(), 1).slice(0, 7);
    months.push({ key: k, label: `${MONTHS_SHORT[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`, value: byMonth[k] || 0 });
  }
  renderBars(el("stat-months"), months);

  // By category for the currently viewed month
  el("stat-cat-title").textContent = `${MONTHS[viewMonth]} ${viewYear} by category`;
  const viewKey = toKey(viewYear, viewMonth, 1).slice(0, 7);
  const byCat = {};
  for (const e of expenses) {
    if (monthKey(e.date) !== viewKey) continue;
    const id = catById(e.category).id;
    byCat[id] = (byCat[id] || 0) + Number(e.amount || 0);
  }
  const catRows = CATEGORIES
    .map((c) => ({ key: c.id, label: `${c.icon} ${c.label}`, value: byCat[c.id] || 0 }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value);
  renderBars(el("stat-cats"), catRows, "No expenses this month.");
}

function renderBars(container, rows, emptyMsg) {
  container.innerHTML = "";
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length && emptyMsg) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = emptyMsg;
    container.appendChild(p);
    return;
  }
  for (const r of rows) {
    const row = document.createElement("div");
    row.className = "bar-row";
    row.innerHTML = `
      <span class="bar-label"></span>
      <span class="bar-track"><span class="bar-fill"></span></span>
      <span class="bar-value"></span>`;
    row.querySelector(".bar-label").textContent = r.label;
    row.querySelector(".bar-fill").style.width = (r.value / max * 100) + "%";
    row.querySelector(".bar-value").textContent = fmtMoney(r.value);
    container.appendChild(row);
  }
}

// --- Add-expense modal (dial pad) ---
function renderCatChips() {
  const wrap = el("cat-chips");
  wrap.innerHTML = "";
  for (const c of CATEGORIES) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip" + (c.id === selectedCategory ? " active" : "");
    chip.innerHTML = `<span>${c.icon}</span> ${c.label}`;
    chip.addEventListener("click", () => {
      selectedCategory = c.id;
      renderCatChips();
    });
    wrap.appendChild(chip);
  }
}

function refreshAmountDisplay() {
  el("amount-display").textContent = amountStr === "" ? "€0" : "€" + amountStr;
}

function openAddModal(dateKey) {
  // If the day-detail sheet is open, close it first so the add sheet is on top.
  closeDayModal();
  activeDate = dateKey;
  amountStr = "";
  selectedCategory = "food";
  el("note-input").value = "";
  el("add-date-label").textContent = fmtDateLabel(dateKey);
  renderCatChips();
  refreshAmountDisplay();
  el("add-modal").classList.remove("hidden");
}

function closeAddModal() {
  el("add-modal").classList.add("hidden");
}

function pressKey(key) {
  if (key === "del") {
    amountStr = amountStr.slice(0, -1);
  } else if (key === ".") {
    if (!amountStr.includes(".")) amountStr = (amountStr || "0") + ".";
  } else {
    if (amountStr.includes(".")) {
      const decimals = amountStr.split(".")[1];
      if (decimals.length >= 2) return;
    }
    if (amountStr === "0") amountStr = "";
    amountStr += key;
  }
  refreshAmountDisplay();
}

async function saveExpense() {
  const amount = parseFloat(amountStr);
  if (!(amount > 0)) {
    toast("Enter an amount");
    return;
  }
  expenses.push({
    id: crypto.randomUUID(),
    date: activeDate,
    amount,
    category: selectedCategory,
    note: el("note-input").value.trim(),
    createdAt: new Date().toISOString(),
  });
  closeAddModal();
  renderCalendar();
  await persist();
}

// --- Day-detail modal ---
function openDayModal(dateKey) {
  dayModalDate = dateKey;
  renderDayModal(dateKey);
  el("day-modal").classList.remove("hidden");
}

function renderDayModal(dateKey) {
  el("day-date-label").textContent = fmtDateLabel(dateKey);
  const items = expenses
    .filter((e) => e.date === dateKey)
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));

  const list = el("day-list");
  list.innerHTML = "";
  let total = 0;
  for (const e of items) {
    total += Number(e.amount || 0);
    const cat = catById(e.category);
    const li = document.createElement("li");
    li.className = "expense-item";
    li.innerHTML = `
      <span class="expense-cat-icon"></span>
      <span class="expense-main">
        <span class="expense-cat-name"></span>
        <span class="expense-note"></span>
      </span>
      <span class="expense-right">
        <span class="expense-amount"></span>
        <button class="del-btn" title="Delete" aria-label="Delete">🗑️</button>
      </span>`;
    li.querySelector(".expense-cat-icon").textContent = cat.icon;
    li.querySelector(".expense-cat-name").textContent = cat.label;
    const note = li.querySelector(".expense-note");
    if (e.note) note.textContent = e.note;
    else note.remove();
    li.querySelector(".expense-amount").textContent = fmtMoney(e.amount);
    li.querySelector(".del-btn").addEventListener("click", () => removeExpense(e.id));
    list.appendChild(li);
  }
  el("day-total-value").textContent = fmtMoney(total);
  el("day-empty").classList.toggle("hidden", items.length > 0);
}

function closeDayModal() {
  el("day-modal").classList.add("hidden");
  dayModalDate = null;
}

async function removeExpense(id) {
  expenses = expenses.filter((e) => e.id !== id);
  renderCalendar();
  if (dayModalDate) renderDayModal(dayModalDate);
  await persist();
}

// --- Persistence ---
async function persist() {
  el("sync-status").textContent = "Saving…";
  try {
    await store.save(expenses);
    el("sync-status").textContent = "Saved to Drive";
  } catch (err) {
    if (err instanceof store.AuthExpiredError) {
      clearCachedToken();
      el("sync-status").textContent = "";
      toast("Session expired — please sign in again");
      entered = false;
      show("login");
      return;
    }
    console.error(err);
    el("sync-status").textContent = "Save failed";
    toast("Could not save to Drive");
  }
}

// --- Auth flow ---
async function handleSignIn() {
  el("login-btn").disabled = true;
  try {
    const { accessToken } = await signIn();
    if (!accessToken) {
      toast("Google did not return Drive access — try again");
      el("login-btn").disabled = false;
      return;
    }
    store.setAccessToken(accessToken);
    cacheToken(accessToken);
    await enterApp(true);
  } catch (err) {
    console.error(err);
    if (err?.code !== "auth/popup-closed-by-user") toast("Sign-in failed");
    el("login-btn").disabled = false;
  }
}

async function enterApp(promptToday) {
  if (entered) return;
  show("loading");
  try {
    expenses = await store.load();
  } catch (err) {
    if (err instanceof store.AuthExpiredError) { clearCachedToken(); show("login"); return; }
    console.error(err);
    toast("Could not load your data");
  }
  entered = true;
  const now = new Date();
  viewYear = now.getFullYear();
  viewMonth = now.getMonth();
  switchTab("calendar");
  renderCalendar();
  show("app");
  if (promptToday) openAddModal(todayKey());
}

function setUserUI(user) {
  if (user && user.photoURL) el("user-photo").src = user.photoURL;
}

// --- Init ---
function init() {
  el("login-btn").addEventListener("click", handleSignIn);
  el("logout-btn").addEventListener("click", async () => {
    clearCachedToken();
    entered = false;
    expenses = [];
    store.setAccessToken(null);
    await logout();
    show("login");
    el("login-btn").disabled = false;
  });

  // Month / year navigation
  const reRender = () => { renderCalendar(); if (!el("stats-panel").classList.contains("hidden")) renderStats(); };
  el("prev-month").addEventListener("click", () => { viewMonth--; if (viewMonth < 0) { viewMonth = 11; viewYear--; } reRender(); });
  el("next-month").addEventListener("click", () => { viewMonth++; if (viewMonth > 11) { viewMonth = 0; viewYear++; } reRender(); });
  el("prev-year").addEventListener("click", () => { viewYear--; reRender(); });
  el("next-year").addEventListener("click", () => { viewYear++; reRender(); });
  el("today-btn").addEventListener("click", () => {
    const now = new Date(); viewYear = now.getFullYear(); viewMonth = now.getMonth(); reRender();
  });

  // Tabs
  el("tab-calendar").addEventListener("click", () => switchTab("calendar"));
  el("tab-stats").addEventListener("click", () => switchTab("stats"));

  // Add modal
  el("add-close").addEventListener("click", closeAddModal);
  el("save-expense").addEventListener("click", saveExpense);
  document.querySelectorAll(".dialpad .key").forEach((btn) =>
    btn.addEventListener("click", () => pressKey(btn.dataset.key))
  );
  el("add-modal").addEventListener("click", (e) => { if (e.target.id === "add-modal") closeAddModal(); });

  // Day modal
  el("day-close").addEventListener("click", closeDayModal);
  el("day-add").addEventListener("click", () => openAddModal(dayModalDate));
  el("day-modal").addEventListener("click", (e) => { if (e.target.id === "day-modal") closeDayModal(); });

  // Restore a cached Drive token so a reopened web app skips the login screen.
  const cached = getCachedToken();
  if (cached) {
    store.setAccessToken(cached);
    enterApp(false);
  }

  watchAuth((user) => {
    setUserUI(user);
    if (store.hasAccessToken()) return; // already in (cached or fresh sign-in)
    const heading = el("login-view").querySelector("h2");
    if (user) {
      heading.textContent = `Welcome back${user.displayName ? ", " + user.displayName.split(" ")[0] : ""}`;
      el("login-btn").lastChild.textContent = " Continue with Google";
    }
    show("login");
    el("login-btn").disabled = false;
  });
}

init();
