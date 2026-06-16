// ---------------------------------------------------------------------------
// Expense Tracker — main app logic.
// Auth: Firebase (Google). Storage: the user's own Google Drive appDataFolder.
// ---------------------------------------------------------------------------

import { signIn, logout, watchAuth } from "./auth.js";
import * as store from "./drive-store.js";

// --- DOM ---
const el = (id) => document.getElementById(id);
const views = {
  login: el("login-view"),
  app: el("app-view"),
  loading: el("loading"),
};

let expenses = [];

// --- View helpers ---
function show(view) {
  views.login.classList.toggle("hidden", view !== "login");
  views.app.classList.toggle("hidden", view !== "app");
  views.loading.classList.toggle("hidden", view !== "loading");
}

function toast(msg) {
  const t = el("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add("hidden"), 2800);
}

function fmtMoney(n) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
  }).format(n || 0);
}

// --- Rendering ---
function render() {
  const list = el("expense-list");
  list.innerHTML = "";

  const sorted = [...expenses].sort((a, b) => b.date.localeCompare(a.date));
  for (const e of sorted) {
    const li = document.createElement("li");
    li.className = "expense-item";
    li.innerHTML = `
      <div class="expense-main">
        <span class="expense-cat"></span>
        <span class="expense-meta"></span>
      </div>
      <div class="expense-right">
        <span class="expense-amount"></span>
        <button class="icon-btn" title="Delete" aria-label="Delete">🗑️</button>
      </div>`;
    li.querySelector(".expense-cat").textContent = e.category;
    li.querySelector(".expense-meta").textContent =
      [e.date, e.description].filter(Boolean).join(" · ");
    li.querySelector(".expense-amount").textContent = fmtMoney(e.amount);
    li.querySelector(".icon-btn").addEventListener("click", () => removeExpense(e.id));
    list.appendChild(li);
  }

  const total = expenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);
  el("total").textContent = fmtMoney(total);
  el("count").textContent = String(expenses.length);
  el("empty-state").classList.toggle("hidden", expenses.length > 0);
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

// --- Actions ---
async function addExpense(evt) {
  evt.preventDefault();
  const amount = parseFloat(el("amount").value);
  if (!(amount > 0)) {
    toast("Enter a valid amount");
    return;
  }
  expenses.push({
    id: crypto.randomUUID(),
    amount,
    category: el("category").value,
    description: el("description").value.trim(),
    date: el("date").value,
    createdAt: new Date().toISOString(),
  });
  render();
  el("expense-form").reset();
  el("date").value = new Date().toISOString().slice(0, 10);
  await persist();
}

async function removeExpense(id) {
  expenses = expenses.filter((e) => e.id !== id);
  render();
  await persist();
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
    if (err?.code !== "auth/popup-closed-by-user") {
      toast("Sign-in failed");
    }
    el("login-btn").disabled = false;
  }
}

async function enterApp() {
  show("loading");
  try {
    expenses = await store.load();
    render();
    show("app");
  } catch (err) {
    if (err instanceof store.AuthExpiredError) {
      show("login");
      return;
    }
    console.error(err);
    toast("Could not load your data");
    show("app");
  }
}

function setUserUI(user) {
  const area = el("user-area");
  if (user) {
    el("user-name").textContent = user.displayName || user.email || "";
    if (user.photoURL) el("user-photo").src = user.photoURL;
    area.classList.remove("hidden");
  } else {
    area.classList.add("hidden");
  }
}

// --- Init ---
function init() {
  el("date").value = new Date().toISOString().slice(0, 10);
  el("login-btn").addEventListener("click", handleSignIn);
  el("logout-btn").addEventListener("click", async () => {
    await logout();
    expenses = [];
    store.setAccessToken(null);
  });
  el("expense-form").addEventListener("submit", addExpense);

  watchAuth((user) => {
    setUserUI(user);
    if (user && store.hasAccessToken()) {
      // Already have a live Drive token (just signed in this session).
      return;
    }
    // No user, or a restored session without a Drive token (e.g. after a
    // page reload): the user must sign in to re-authorize Drive access.
    show("login");
    el("login-btn").disabled = false;
  });
}

init();
