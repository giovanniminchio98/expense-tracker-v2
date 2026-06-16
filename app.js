// ---------------------------------------------------------------------------
// Expense Tracker — calendar-first UI.
// Auth: Firebase (Google). Storage: the user's own Google Drive appDataFolder.
// ---------------------------------------------------------------------------

import { signIn, logout, watchAuth } from "./auth.js";
import * as store from "./drive-store.js";

const el = (id) => document.getElementById(id);

// --- State ---
let expenses = [];                 // [{ id, date:"YYYY-MM-DD", amount, note, createdAt }]
let viewYear, viewMonth;           // month currently shown in the calendar (month: 0-11)
let amountStr = "";                // amount being typed on the dial pad
let activeDate = null;             // date the add-modal is adding to (YYYY-MM-DD)

const MONTHS = ["January","February","March","April","May","June","July",
  "August","September","October","November","December"];

// --- Utilities ---
const pad = (n) => String(n).padStart(2, "0");
const toKey = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
const todayKey = () => {
  const t = new Date();
  return toKey(t.getFullYear(), t.getMonth(), t.getDate());
};

function fmtMoney(n) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "EUR" }).format(n || 0);
}

function fmtDateLabel(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });
}

// Sum of expenses per date key, for fast calendar rendering.
function totalsByDate() {
  const map = {};
  for (const e of expenses) map[e.date] = (map[e.date] || 0) + Number(e.amount || 0);
  return map;
}

function show(view) {
  el("login-view").classList.toggle("hidden", view !== "login");
  el("app-view").classList.toggle("hidden", view !== "app");
  el("loading").classList.toggle("hidden", view !== "loading");
}

function toast(msg) {
  const t = el("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add("hidden"), 2800);
}

// --- Calendar rendering ---
function renderCalendar() {
  el("month-label").textContent = `${MONTHS[viewMonth]} ${viewYear}`;

  const totals = totalsByDate();
  const grid = el("calendar");
  grid.innerHTML = "";

  // Monday-first offset (JS getDay: 0=Sun).
  const firstWeekday = (new Date(viewYear, viewMonth, 1).getDay() + 6) % 7;
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
      a.textContent = fmtMoney(amt);
      cell.appendChild(a);
    }
    cell.addEventListener("click", () => openDayModal(key));
    grid.appendChild(cell);
  }

  el("month-total-value").textContent = fmtMoney(monthTotal);
}

// --- Add-expense modal (dial pad) ---
function refreshAmountDisplay() {
  el("amount-display").textContent =
    amountStr === "" ? "€0" : "€" + amountStr;
}

function openAddModal(dateKey) {
  activeDate = dateKey;
  amountStr = "";
  el("note-input").value = "";
  el("add-date-label").textContent = fmtDateLabel(dateKey);
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
    // digit
    if (amountStr.includes(".")) {
      const decimals = amountStr.split(".")[1];
      if (decimals.length >= 2) return;       // max 2 decimal places
    }
    if (amountStr === "0") amountStr = "";     // avoid leading zero
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
    note: el("note-input").value.trim(),
    createdAt: new Date().toISOString(),
  });
  closeAddModal();
  renderCalendar();
  // If the day modal is open for this date, refresh it.
  if (!el("day-modal").classList.contains("hidden")) renderDayModal(activeDate);
  await persist();
}

// --- Day-detail modal ---
let dayModalDate = null;

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
    const li = document.createElement("li");
    li.className = "expense-item";
    li.innerHTML = `
      <span class="expense-note"></span>
      <span class="expense-right">
        <span class="expense-amount"></span>
        <button class="del-btn" title="Delete" aria-label="Delete">🗑️</button>
      </span>`;
    const note = li.querySelector(".expense-note");
    if (e.note) note.textContent = e.note;
    else { note.textContent = "(no note)"; note.classList.add("empty-note"); }
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
      el("sync-status").textContent = "";
      toast("Session expired — please sign in again");
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
    await enterApp();
  } catch (err) {
    console.error(err);
    if (err?.code !== "auth/popup-closed-by-user") toast("Sign-in failed");
    el("login-btn").disabled = false;
  }
}

async function enterApp() {
  show("loading");
  try {
    expenses = await store.load();
  } catch (err) {
    if (err instanceof store.AuthExpiredError) { show("login"); return; }
    console.error(err);
    toast("Could not load your data");
  }
  const now = new Date();
  viewYear = now.getFullYear();
  viewMonth = now.getMonth();
  renderCalendar();
  show("app");
  // Suggest adding today's expense right away.
  openAddModal(todayKey());
}

function setUserUI(user) {
  const area = el("user-area");
  if (user) {
    if (user.photoURL) el("user-photo").src = user.photoURL;
    area.classList.remove("hidden");
  } else {
    area.classList.add("hidden");
  }
}

// --- Init ---
function init() {
  el("login-btn").addEventListener("click", handleSignIn);
  el("logout-btn").addEventListener("click", async () => {
    await logout();
    expenses = [];
    store.setAccessToken(null);
  });

  // Month navigation
  el("prev-month").addEventListener("click", () => {
    viewMonth--; if (viewMonth < 0) { viewMonth = 11; viewYear--; }
    renderCalendar();
  });
  el("next-month").addEventListener("click", () => {
    viewMonth++; if (viewMonth > 11) { viewMonth = 0; viewYear++; }
    renderCalendar();
  });

  // Add modal
  el("add-close").addEventListener("click", closeAddModal);
  el("save-expense").addEventListener("click", saveExpense);
  document.querySelectorAll(".dialpad .key").forEach((btn) =>
    btn.addEventListener("click", () => pressKey(btn.dataset.key))
  );
  el("add-modal").addEventListener("click", (e) => {
    if (e.target.id === "add-modal") closeAddModal();
  });

  // Day modal
  el("day-close").addEventListener("click", closeDayModal);
  el("day-add").addEventListener("click", () => openAddModal(dayModalDate));
  el("day-modal").addEventListener("click", (e) => {
    if (e.target.id === "day-modal") closeDayModal();
  });

  watchAuth((user) => {
    setUserUI(user);
    if (user && store.hasAccessToken()) return;
    // No user, or restored session without a Drive token (page reload):
    // user must sign in to re-authorize Drive access.
    show("login");
    el("login-btn").disabled = false;
  });
}

init();
