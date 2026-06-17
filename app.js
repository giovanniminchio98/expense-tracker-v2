// ---------------------------------------------------------------------------
// Expense Tracker — calendar + stats + advanced math + themes.
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
const WEEKDAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

// --- State ---
let expenses = [];
let viewYear, viewMonth;
let amountStr = "";
let activeDate = null;
let selectedCategory = "food";
let dayModalDate = null;
let entered = false;

// --- Drive token cache (so a reopened web app doesn't re-prompt for login) ---
const TOKEN_KEY = "et_drive_token";
function cacheToken(token) {
  try { localStorage.setItem(TOKEN_KEY, JSON.stringify({ token, exp: Date.now() + 55 * 60 * 1000 })); } catch {}
}
function getCachedToken() {
  try {
    const o = JSON.parse(localStorage.getItem(TOKEN_KEY) || "null");
    if (o && o.token && o.exp > Date.now()) return o.token;
  } catch {}
  return null;
}
function clearCachedToken() { try { localStorage.removeItem(TOKEN_KEY); } catch {} }

// --- Utilities ---
const pad = (n) => String(n).padStart(2, "0");
const toKey = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
const monthKey = (dateStr) => dateStr.slice(0, 7);
const todayKey = () => { const t = new Date(); return toKey(t.getFullYear(), t.getMonth(), t.getDate()); };

function fmtMoney(n) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "EUR" }).format(n || 0);
}
const fmtMoneyShort = (n) => "€" + Math.round(n || 0);
// Variance is in squared currency units, so it gets its own unit (€²).
const fmtSqEuro = (n) =>
  new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(n || 0) + " €²";
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
  el("user-area").classList.toggle("hidden", view !== "app");
}

function toast(msg) {
  const t = el("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add("hidden"), 2800);
}

// =====================================================================
//  Themes (normal / dark / futuristic) + neuron background
// =====================================================================
const THEME_KEY = "et_theme";
function applyTheme(theme) {
  document.body.dataset.theme = theme;
  try { localStorage.setItem(THEME_KEY, theme); } catch {}
  if (theme === "futuristic") neuro.start();
  else neuro.stop();
}
function initTheme() {
  let saved = "futuristic";
  try { saved = localStorage.getItem(THEME_KEY) || "futuristic"; } catch {}
  applyTheme(saved);

  el("theme-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    el("theme-menu").classList.toggle("hidden");
  });
  document.querySelectorAll("#theme-menu button").forEach((b) =>
    b.addEventListener("click", () => {
      applyTheme(b.dataset.theme);
      el("theme-menu").classList.add("hidden");
    })
  );
  document.addEventListener("click", () => el("theme-menu").classList.add("hidden"));
}

// Animated neural-network background, only running in the futuristic theme.
const neuro = (() => {
  const canvas = el("neuro-bg");
  const ctx = canvas.getContext("2d");
  // A spread of soft, muted pastel colors (not neon) on the dark background.
  const PALETTE = ["#9fb4d4", "#b3a7cf", "#cbb3c9", "#a9c8bd", "#d4c39a", "#a6c0d8", "#a3c7c2", "#c3bcd8"];
  const MAX_DIST = 150;
  let nodes = [], raf = null, w = 0, h = 0;

  function resize() {
    w = canvas.width = window.innerWidth;
    h = canvas.height = window.innerHeight;
  }
  function seed() {
    // Denser field of neurons than before.
    const count = Math.min(160, Math.floor((w * h) / 9000));
    nodes = Array.from({ length: count }, () => ({
      x: Math.random() * w, y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.4, vy: (Math.random() - 0.5) * 0.4,
      color: PALETTE[Math.floor(Math.random() * PALETTE.length)],
    }));
  }
  function frame() {
    ctx.clearRect(0, 0, w, h);
    for (const n of nodes) {
      n.x += n.vx; n.y += n.vy;
      if (n.x < 0 || n.x > w) n.vx *= -1;
      if (n.y < 0 || n.y > h) n.vy *= -1;
    }
    // Links (light, colored by the source neuron, fading with distance)
    ctx.lineWidth = 1;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = nodes[i].x - nodes[j].x, dy = nodes[i].y - nodes[j].y;
        const dist = Math.hypot(dx, dy);
        if (dist < MAX_DIST) {
          ctx.globalAlpha = (1 - dist / MAX_DIST) * 0.28;
          ctx.strokeStyle = nodes[i].color;
          ctx.beginPath();
          ctx.moveTo(nodes[i].x, nodes[i].y);
          ctx.lineTo(nodes[j].x, nodes[j].y);
          ctx.stroke();
        }
      }
    }
    // Neurons (soft, no neon glow)
    ctx.globalAlpha = 0.7;
    for (const n of nodes) {
      ctx.fillStyle = n.color;
      ctx.beginPath();
      ctx.arc(n.x, n.y, 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    raf = requestAnimationFrame(frame);
  }
  function start() {
    canvas.classList.add("on");
    resize(); seed();
    if (!raf) frame();
    window.addEventListener("resize", onResize);
  }
  function stop() {
    canvas.classList.remove("on");
    if (raf) { cancelAnimationFrame(raf); raf = null; }
    ctx.clearRect(0, 0, w, h);
    window.removeEventListener("resize", onResize);
  }
  function onResize() { resize(); seed(); }
  return { start, stop };
})();

// =====================================================================
//  Tabs
// =====================================================================
function switchTab(tab) {
  el("calendar-panel").classList.toggle("hidden", tab !== "calendar");
  el("stats-panel").classList.toggle("hidden", tab !== "stats");
  el("math-panel").classList.toggle("hidden", tab !== "math");
  el("tab-calendar").classList.toggle("active", tab === "calendar");
  el("tab-stats").classList.toggle("active", tab === "stats");
  el("tab-math").classList.toggle("active", tab === "math");
  if (tab === "stats") renderStats();
  if (tab === "math") renderMath();
}

// =====================================================================
//  Calendar
// =====================================================================
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

// =====================================================================
//  Stats (overview)
// =====================================================================
function renderStats() {
  el("stat-empty").classList.toggle("hidden", expenses.length > 0);

  const allTotal = expenses.reduce((s, e) => s + Number(e.amount || 0), 0);
  el("stat-alltime").textContent = fmtMoney(allTotal);
  el("stat-count").textContent = String(expenses.length);

  const byMonth = {};
  for (const e of expenses) byMonth[monthKey(e.date)] = (byMonth[monthKey(e.date)] || 0) + Number(e.amount || 0);
  const monthCount = Object.keys(byMonth).length || 1;
  el("stat-avg").textContent = fmtMoney(allTotal / monthCount);

  const now = new Date();
  const curKey = toKey(now.getFullYear(), now.getMonth(), 1).slice(0, 7);
  el("stat-thismonth").textContent = fmtMoney(byMonth[curKey] || 0);

  // By category for the viewed month
  el("stat-cat-title").textContent = `${MONTHS[viewMonth]} ${viewYear} by category`;
  const viewKey = toKey(viewYear, viewMonth, 1).slice(0, 7);
  const byCat = {};
  for (const e of expenses) {
    if (monthKey(e.date) !== viewKey) continue;
    byCat[catById(e.category).id] = (byCat[catById(e.category).id] || 0) + Number(e.amount || 0);
  }
  const catRows = CATEGORIES
    .map((c) => ({ label: `${c.icon} ${c.label}`, value: byCat[c.id] || 0 }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value);
  renderBars(el("stat-cats"), catRows, "No expenses this month.");

  // Month by month (all months, newest first)
  const monthRows = Object.keys(byMonth)
    .sort((a, b) => b.localeCompare(a))
    .map((k) => {
      const [y, m] = k.split("-").map(Number);
      return { label: `${MONTHS_SHORT[m - 1]} ${y}`, value: byMonth[k] };
    });
  renderBars(el("stat-months"), monthRows, "No data yet.");
}

function renderBars(container, rows, emptyMsg) {
  container.innerHTML = "";
  if (!rows.length) {
    if (emptyMsg) {
      const p = document.createElement("p");
      p.className = "empty";
      p.textContent = emptyMsg;
      container.appendChild(p);
    }
    return;
  }
  const max = Math.max(1, ...rows.map((r) => r.value));
  for (const r of rows) {
    const row = document.createElement("div");
    row.className = "bar-row";
    row.innerHTML = `<span class="bar-label"></span><span class="bar-track"><span class="bar-fill"></span></span><span class="bar-value"></span>`;
    row.querySelector(".bar-label").textContent = r.label;
    row.querySelector(".bar-fill").style.width = (r.value / max * 100) + "%";
    row.querySelector(".bar-value").textContent = fmtMoney(r.value);
    container.appendChild(row);
  }
}

// =====================================================================
//  Math (advanced statistics)
// =====================================================================
const sum = (a) => a.reduce((x, y) => x + y, 0);
const mean = (a) => (a.length ? sum(a) / a.length : 0);
function median(a) {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y), n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}
function stddev(a) {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(sum(a.map((x) => (x - m) ** 2)) / a.length);
}
function percentile(a, p) {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

function renderMath() {
  const list = el("math-list");
  list.innerHTML = "";
  el("math-empty").classList.toggle("hidden", expenses.length > 0);
  if (!expenses.length) return;

  const amounts = expenses.map((e) => Number(e.amount || 0));
  const total = sum(amounts);
  const m = mean(amounts);
  const sd = stddev(amounts);

  // Per-month totals
  const byMonth = {};
  for (const e of expenses) byMonth[monthKey(e.date)] = (byMonth[monthKey(e.date)] || 0) + Number(e.amount || 0);
  const monthTotals = Object.values(byMonth);

  // Per-day totals
  const byDay = totalsByDate();
  const dayTotals = Object.values(byDay);

  // Per weekday
  const byWeekday = Array(7).fill(0);
  for (const e of expenses) {
    const [y, mo, d] = e.date.split("-").map(Number);
    byWeekday[new Date(y, mo - 1, d).getDay()] += Number(e.amount || 0);
  }
  const topWeekdayIdx = byWeekday.indexOf(Math.max(...byWeekday));

  // Categories
  const catSpend = {}, catCount = {};
  for (const e of expenses) {
    const id = catById(e.category).id;
    catSpend[id] = (catSpend[id] || 0) + Number(e.amount || 0);
    catCount[id] = (catCount[id] || 0) + 1;
  }
  const topCatSpend = Object.entries(catSpend).sort((a, b) => b[1] - a[1])[0];
  const topCatCount = Object.entries(catCount).sort((a, b) => b[1] - a[1])[0];

  // This vs last month
  const now = new Date();
  const curK = toKey(now.getFullYear(), now.getMonth(), 1).slice(0, 7);
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevK = toKey(prev.getFullYear(), prev.getMonth(), 1).slice(0, 7);
  const curM = byMonth[curK] || 0, prevM = byMonth[prevK] || 0;
  const momChange = prevM ? ((curM - prevM) / prevM) * 100 : null;

  const cv = m ? (sd / m) * 100 : 0;

  const groups = [
    ["Per expense", [
      ["Expenses tracked", String(amounts.length)],
      ["Total spent", fmtMoney(total)],
      ["Mean per expense", fmtMoney(m)],
      ["Median expense", fmtMoney(median(amounts))],
      ["Std deviation", fmtMoney(sd)],
      ["Variance", fmtSqEuro(sd * sd)],
      ["Coeff. of variation", cv.toFixed(0) + "%"],
      ["Smallest", fmtMoney(Math.min(...amounts))],
      ["Largest", fmtMoney(Math.max(...amounts))],
      ["90th percentile", fmtMoney(percentile(amounts, 90))],
    ]],
    ["Per day / month", [
      ["Active days", String(dayTotals.length)],
      ["Avg per active day", fmtMoney(mean(dayTotals))],
      ["Busiest day total", fmtMoney(Math.max(...dayTotals))],
      ["Months tracked", String(monthTotals.length)],
      ["Avg per month", fmtMoney(mean(monthTotals))],
      ["Monthly volatility (σ)", fmtMoney(stddev(monthTotals))],
      ["Top spending weekday", `${WEEKDAYS[topWeekdayIdx]} (${fmtMoney(byWeekday[topWeekdayIdx])})`],
      ["This vs last month", momChange === null ? "—" : (momChange >= 0 ? "+" : "") + momChange.toFixed(0) + "%"],
    ]],
    ["Categories", [
      ["Top by spend", topCatSpend ? `${catById(topCatSpend[0]).label} (${fmtMoney(topCatSpend[1])})` : "—"],
      ["Top by count", topCatCount ? `${catById(topCatCount[0]).label} (${topCatCount[1]}×)` : "—"],
      ["Categories used", String(Object.keys(catSpend).length)],
    ]],
  ];

  for (const [title, rows] of groups) {
    const h = document.createElement("h3");
    h.textContent = title;
    list.appendChild(h);
    const box = document.createElement("div");
    box.className = "math-grid";
    for (const [label, value] of rows) {
      const item = document.createElement("div");
      item.className = "math-item";
      item.innerHTML = `<span class="math-label"></span><span class="math-value"></span>`;
      item.querySelector(".math-label").textContent = label;
      item.querySelector(".math-value").textContent = value;
      box.appendChild(item);
    }
    list.appendChild(box);
  }
}

// =====================================================================
//  Add-expense modal (dial pad)
// =====================================================================
function renderCatChips() {
  const wrap = el("cat-chips");
  wrap.innerHTML = "";
  for (const c of CATEGORIES) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip" + (c.id === selectedCategory ? " active" : "");
    chip.innerHTML = `<span>${c.icon}</span> ${c.label}`;
    chip.addEventListener("click", () => { selectedCategory = c.id; renderCatChips(); });
    wrap.appendChild(chip);
  }
}
function refreshAmountDisplay() {
  el("amount-display").textContent = amountStr === "" ? "€0" : "€" + amountStr;
}
function openAddModal(dateKey) {
  closeDayModal(); // ensure the add sheet sits on top of any day sheet
  activeDate = dateKey;
  amountStr = "";
  selectedCategory = "food";
  el("note-input").value = "";
  el("add-date-label").textContent = fmtDateLabel(dateKey);
  renderCatChips();
  refreshAmountDisplay();
  el("add-modal").classList.remove("hidden");
}
function closeAddModal() { el("add-modal").classList.add("hidden"); }
function pressKey(key) {
  if (key === "del") amountStr = amountStr.slice(0, -1);
  else if (key === ".") { if (!amountStr.includes(".")) amountStr = (amountStr || "0") + "."; }
  else {
    if (amountStr.includes(".") && amountStr.split(".")[1].length >= 2) return;
    if (amountStr === "0") amountStr = "";
    amountStr += key;
  }
  refreshAmountDisplay();
}
async function saveExpense() {
  const amount = parseFloat(amountStr);
  if (!(amount > 0)) { toast("Enter an amount"); return; }
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

// =====================================================================
//  Day-detail modal
// =====================================================================
function openDayModal(dateKey) {
  dayModalDate = dateKey;
  renderDayModal(dateKey);
  el("day-modal").classList.remove("hidden");
}
function renderDayModal(dateKey) {
  el("day-date-label").textContent = fmtDateLabel(dateKey);
  const items = expenses.filter((e) => e.date === dateKey)
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
    if (e.note) note.textContent = e.note; else note.remove();
    li.querySelector(".expense-amount").textContent = fmtMoney(e.amount);
    li.querySelector(".del-btn").addEventListener("click", () => removeExpense(e.id));
    list.appendChild(li);
  }
  el("day-total-value").textContent = fmtMoney(total);
  el("day-empty").classList.toggle("hidden", items.length > 0);
}
function closeDayModal() { el("day-modal").classList.add("hidden"); dayModalDate = null; }
async function removeExpense(id) {
  expenses = expenses.filter((e) => e.id !== id);
  renderCalendar();
  if (dayModalDate) renderDayModal(dayModalDate);
  await persist();
}

// =====================================================================
//  Persistence
// =====================================================================
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

// =====================================================================
//  Auth flow
// =====================================================================
async function handleSignIn() {
  el("login-btn").disabled = true;
  try {
    const { accessToken } = await signIn();
    if (!accessToken) { toast("Google did not return Drive access — try again"); el("login-btn").disabled = false; return; }
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
function setUserUI(user) { if (user && user.photoURL) el("user-photo").src = user.photoURL; }

// =====================================================================
//  Month/year picker
// =====================================================================
function openMonthPicker() {
  const pop = el("month-popover");
  const input = el("month-input");
  input.value = `${viewYear}-${pad(viewMonth + 1)}`;
  pop.classList.toggle("hidden");
  if (!pop.classList.contains("hidden")) {
    try { input.showPicker(); } catch {}
  }
}

// =====================================================================
//  Init
// =====================================================================
function reRender() {
  renderCalendar();
  if (!el("stats-panel").classList.contains("hidden")) renderStats();
}

function init() {
  initTheme();

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
  el("prev-month").addEventListener("click", () => { viewMonth--; if (viewMonth < 0) { viewMonth = 11; viewYear--; } reRender(); });
  el("next-month").addEventListener("click", () => { viewMonth++; if (viewMonth > 11) { viewMonth = 0; viewYear++; } reRender(); });
  el("prev-year").addEventListener("click", () => { viewYear--; reRender(); });
  el("next-year").addEventListener("click", () => { viewYear++; reRender(); });
  el("today-btn").addEventListener("click", () => { const n = new Date(); viewYear = n.getFullYear(); viewMonth = n.getMonth(); reRender(); });

  // Month picker popover
  el("month-label").addEventListener("click", (e) => { e.stopPropagation(); openMonthPicker(); });
  el("month-input").addEventListener("change", (e) => {
    const v = e.target.value; // "YYYY-MM"
    if (v) { const [y, m] = v.split("-").map(Number); viewYear = y; viewMonth = m - 1; reRender(); }
    el("month-popover").classList.add("hidden");
  });
  document.addEventListener("click", (e) => {
    if (!el("month-popover").contains(e.target) && e.target !== el("month-label"))
      el("month-popover").classList.add("hidden");
  });

  // Tabs
  el("tab-calendar").addEventListener("click", () => switchTab("calendar"));
  el("tab-stats").addEventListener("click", () => switchTab("stats"));
  el("tab-math").addEventListener("click", () => switchTab("math"));

  // Add modal
  el("add-close").addEventListener("click", closeAddModal);
  el("save-expense").addEventListener("click", saveExpense);
  document.querySelectorAll(".dialpad .key").forEach((btn) => btn.addEventListener("click", () => pressKey(btn.dataset.key)));
  el("add-modal").addEventListener("click", (e) => { if (e.target.id === "add-modal") closeAddModal(); });

  // Day modal
  el("day-close").addEventListener("click", closeDayModal);
  el("day-add").addEventListener("click", () => openAddModal(dayModalDate));
  el("day-modal").addEventListener("click", (e) => { if (e.target.id === "day-modal") closeDayModal(); });

  // Restore a cached Drive token so a reopened web app skips the login screen.
  const cached = getCachedToken();
  if (cached) { store.setAccessToken(cached); enterApp(false); }

  watchAuth((user) => {
    setUserUI(user);
    if (store.hasAccessToken()) return;
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
