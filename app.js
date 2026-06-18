// ---------------------------------------------------------------------------
// Expense Tracker — calendar + stats + advanced math + themes.
// Auth: Firebase (Google). Storage: the user's own Google Drive appDataFolder.
// ---------------------------------------------------------------------------

import { signIn, logout, watchAuth } from "./auth.js";
import * as store from "./drive-store.js";

const el = (id) => document.getElementById(id);

// Fixed categories per record type — no custom ones (use the note as a label).
const CATEGORIES = {
  expense: [
    { id: "food", label: "Food", icon: "🍽️" },
    { id: "transport", label: "Transport", icon: "🚆" },
    { id: "shopping", label: "Shopping", icon: "🛍️" },
    { id: "bills", label: "Bills", icon: "🧾" },
    { id: "fun", label: "Fun", icon: "🍿" },
    { id: "other", label: "Other", icon: "🏷️" },
  ],
  income: [
    { id: "salary", label: "Salary", icon: "💼" },
    { id: "bonus", label: "Bonus", icon: "🎁" },
    { id: "other", label: "Other", icon: "🏷️" },
  ],
  asset: [
    { id: "investments", label: "Investments", icon: "📈" },
    { id: "savings", label: "Savings", icon: "🏦" },
    { id: "crypto", label: "Crypto", icon: "🪙" },
    { id: "other", label: "Other", icon: "🏷️" },
  ],
};
const TYPE_LABELS = { expense: "Expense", income: "Income", asset: "Holding" };
function catById(type, id) {
  const list = CATEGORIES[type] || CATEGORIES.expense;
  return list.find((c) => c.id === id) || list[list.length - 1];
}
// The record array for a given type.
function arrFor(type) { return type === "income" ? incomes : type === "asset" ? assets : expenses; }

const MONTHS = ["January","February","March","April","May","June","July",
  "August","September","October","November","December"];
const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const WEEKDAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

// --- State ---
let expenses = [];
let incomes = [];
let assets = [];
let deleted = {};                  // id -> deletion timestamp (ms), shared, for safe merges
let viewYear, viewMonth;
let amountStr = "";
let activeDate = null;
let activeType = "expense";        // expense | income | asset (in the add modal)
let selectedCategory = "food";
let dayModalDate = null;
let entered = false;

// --- Drive token (kept in memory first; localStorage is a best-effort cache so
//     a reopened app can skip the popup, but we never depend on it). ---
const TOKEN_KEY = "et_drive_token";
let memToken = null, memExp = 0;
function setToken(t) {
  memToken = t; memExp = Date.now() + 55 * 60 * 1000;
  store.setAccessToken(t);
  try { localStorage.setItem(TOKEN_KEY, JSON.stringify({ token: t, exp: memExp })); } catch {}
}
function getToken() {
  if (memToken && memExp > Date.now()) return memToken;
  try {
    const o = JSON.parse(localStorage.getItem(TOKEN_KEY) || "null");
    if (o && o.token && o.exp > Date.now()) { memToken = o.token; memExp = o.exp; store.setAccessToken(o.token); return o.token; }
  } catch {}
  return null;
}
function clearToken() {
  memToken = null; memExp = 0;
  store.setAccessToken(null);
  try { localStorage.removeItem(TOKEN_KEY); } catch {}
}

// --- Local copy of the document (so the app opens instantly and never loses
//     data even if Drive is briefly unreachable). ---
const LOCAL_KEY = "et_doc";
function localDoc() { return { expenses, incomes, assets, deleted }; }
function saveLocal() { try { localStorage.setItem(LOCAL_KEY, JSON.stringify(localDoc())); } catch {} }
function normalizeDoc(d) {
  return {
    expenses: Array.isArray(d?.expenses) ? d.expenses : [],
    incomes: Array.isArray(d?.incomes) ? d.incomes : [],
    assets: Array.isArray(d?.assets) ? d.assets : [],
    deleted: d?.deleted && typeof d.deleted === "object" ? d.deleted : {},
  };
}
function loadLocal() {
  try {
    const d = JSON.parse(localStorage.getItem(LOCAL_KEY) || "null");
    if (d && Array.isArray(d.expenses)) return normalizeDoc(d);
  } catch {}
  return normalizeDoc(null);
}
function clearLocal() { try { localStorage.removeItem(LOCAL_KEY); } catch {} }

// "Dirty" = local has changes not yet confirmed saved to Drive.
const DIRTY_KEY = "et_dirty";
function setDirty() { try { localStorage.setItem(DIRTY_KEY, "1"); } catch {} }
function clearDirty() { try { localStorage.removeItem(DIRTY_KEY); } catch {} }
function isDirty() { try { return localStorage.getItem(DIRTY_KEY) === "1"; } catch { return false; } }

// Merge two documents without losing data: for each record array, union by id
// (newest wins), union deletion tombstones (latest wins), and drop records that
// were deleted after their last update.
function mergeDocs(a, b) {
  const del = {};
  for (const src of [a.deleted || {}, b.deleted || {}])
    for (const id in src) del[id] = Math.max(del[id] || 0, src[id] || 0);

  const tOf = (e) => Date.parse(e.updatedAt || e.createdAt || 0) || 0;
  const mergeArr = (x, y) => {
    const byId = {};
    for (const e of [...(x || []), ...(y || [])]) {
      if (!e || !e.id) continue;
      if (!byId[e.id] || tOf(e) >= tOf(byId[e.id])) byId[e.id] = e;
    }
    return Object.values(byId).filter((e) => {
      const dt = del[e.id];
      return !dt || tOf(e) > dt;
    });
  };
  return {
    expenses: mergeArr(a.expenses, b.expenses),
    incomes: mergeArr(a.incomes, b.incomes),
    assets: mergeArr(a.assets, b.assets),
    deleted: del,
  };
}

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
function totalsByDate(arr) {
  const map = {};
  for (const e of arr) map[e.date] = (map[e.date] || 0) + Number(e.amount || 0);
  return map;
}

function show(view) {
  el("login-view").classList.toggle("hidden", view !== "login");
  el("app-view").classList.toggle("hidden", view !== "app");
  el("loading").classList.toggle("hidden", view !== "loading");
  el("user-area").classList.toggle("hidden", view !== "app");
  el("refresh-btn").classList.toggle("hidden", view !== "app");
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

// Animated background for the futuristic theme: a neuron network layered over
// a flowing "sand swarm" of particles (a flow field). Soft, colorful, alive.
const neuro = (() => {
  const canvas = el("neuro-bg");
  const ctx = canvas.getContext("2d");
  // Light pastels with a bit more color/contrast (still not neon).
  const PALETTE = ["#8ab4ff", "#b18cff", "#ff9ad1", "#7fe0c0", "#ffd27f", "#7fd4ff", "#a0ffe0", "#c9a3ff"];
  const MAX_DIST = 150;
  let nodes = [], particles = [], raf = null, w = 0, h = 0, t = 0;

  function resize() {
    w = canvas.width = window.innerWidth;
    h = canvas.height = window.innerHeight;
  }
  function seed() {
    const nodeCount = Math.min(170, Math.floor((w * h) / 8500));
    nodes = Array.from({ length: nodeCount }, () => ({
      x: Math.random() * w, y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.4, vy: (Math.random() - 0.5) * 0.4,
      color: PALETTE[Math.floor(Math.random() * PALETTE.length)],
    }));
    const pCount = Math.min(320, Math.floor((w * h) / 4200));
    particles = Array.from({ length: pCount }, () => ({
      x: Math.random() * w, y: Math.random() * h,
      sp: 0.35 + Math.random() * 0.9,
      color: PALETTE[Math.floor(Math.random() * PALETTE.length)],
    }));
  }
  // Cheap pseudo-noise flow field — drives the "moving sand" swarm.
  function flowAngle(x, y) {
    return (Math.sin(x * 0.006 + t) + Math.cos(y * 0.006 - t * 0.8)) * Math.PI;
  }
  function frame() {
    t += 0.0016;
    ctx.clearRect(0, 0, w, h);

    // Flow-field particle swarm (drawn first, behind the network)
    ctx.globalAlpha = 0.4;
    for (const p of particles) {
      const a = flowAngle(p.x, p.y);
      p.x += Math.cos(a) * p.sp;
      p.y += Math.sin(a) * p.sp;
      if (p.x < 0) p.x += w; else if (p.x > w) p.x -= w;
      if (p.y < 0) p.y += h; else if (p.y > h) p.y -= h;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y, 1.4, 1.4);
    }

    // Neuron movement
    for (const n of nodes) {
      n.x += n.vx; n.y += n.vy;
      if (n.x < 0 || n.x > w) n.vx *= -1;
      if (n.y < 0 || n.y > h) n.vy *= -1;
    }
    // Links (colored by the source neuron, fading with distance)
    ctx.lineWidth = 1;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = nodes[i].x - nodes[j].x, dy = nodes[i].y - nodes[j].y;
        const dist = Math.hypot(dx, dy);
        if (dist < MAX_DIST) {
          ctx.globalAlpha = (1 - dist / MAX_DIST) * 0.36;
          ctx.strokeStyle = nodes[i].color;
          ctx.beginPath();
          ctx.moveTo(nodes[i].x, nodes[i].y);
          ctx.lineTo(nodes[j].x, nodes[j].y);
          ctx.stroke();
        }
      }
    }
    // Neurons
    ctx.globalAlpha = 0.88;
    for (const n of nodes) {
      ctx.fillStyle = n.color;
      ctx.beginPath();
      ctx.arc(n.x, n.y, 2.1, 0, Math.PI * 2);
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
const TABS = ["calendar", "wealth", "stats", "math"];
function switchTab(tab) {
  for (const t of TABS) {
    el(`${t}-panel`).classList.toggle("hidden", t !== tab);
    el(`tab-${t}`).classList.toggle("active", t === tab);
  }
  if (tab === "wealth") renderWealth();
  if (tab === "stats") renderStats();
  if (tab === "math") renderMath();
}

// =====================================================================
//  Wealth (net worth + holdings)
// =====================================================================

// Current net worth = sum of the latest snapshot per asset category.
function latestByCategory() {
  const latest = {};
  for (const a of assets) {
    const cur = latest[a.category];
    if (!cur || a.date > cur.date || (a.date === cur.date && (a.createdAt || "") > (cur.createdAt || "")))
      latest[a.category] = a;
  }
  return latest;
}
function netWorth() {
  return Object.values(latestByCategory()).reduce((s, a) => s + Number(a.amount || 0), 0);
}

// Net worth over time, by month: at each month-end, sum the latest-known value
// per category up to that month.
function netWorthSeries() {
  if (!assets.length) return [];
  const sorted = [...assets].sort((a, b) => a.date.localeCompare(b.date));
  const firstYM = sorted[0].date.slice(0, 7);
  const now = new Date();
  const out = [];
  let y = +firstYM.slice(0, 4), m = +firstYM.slice(5, 7) - 1;
  const endY = now.getFullYear(), endM = now.getMonth();
  const latest = {};
  let gi = 0;
  while (y < endY || (y === endY && m <= endM)) {
    const ymEnd = `${y}-${pad(m + 1)}-31`;
    while (gi < sorted.length && sorted[gi].date <= ymEnd) { latest[sorted[gi].category] = sorted[gi]; gi++; }
    const total = Object.values(latest).reduce((s, a) => s + Number(a.amount || 0), 0);
    out.push({ short: `${MONTHS_SHORT[m]}`, label: `${MONTHS_SHORT[m]} ${y}`, value: total });
    m++; if (m > 11) { m = 0; y++; }
    if (out.length > 24) out.shift();
  }
  return out;
}

function renderWealth() {
  const sumExp = expenses.reduce((s, e) => s + Number(e.amount || 0), 0);
  const sumInc = incomes.reduce((s, e) => s + Number(e.amount || 0), 0);
  const nw = netWorth();
  el("nw-total").textContent = fmtMoney(nw);
  el("nw-income").textContent = "+" + fmtMoney(sumInc);
  el("nw-expense").textContent = "−" + fmtMoney(sumExp);
  el("nw-cashflow").textContent = (sumInc - sumExp >= 0 ? "+" : "−") + fmtMoney(Math.abs(sumInc - sumExp));
  el("nw-cashflow").className = "stat-card-v " + (sumInc - sumExp >= 0 ? "amt-inc" : "amt-exp");

  // Holdings breakdown (latest per category)
  const latest = latestByCategory();
  const breakdown = CATEGORIES.asset
    .map((c) => ({ label: `${c.icon} ${c.label}`, value: latest[c.id] ? Number(latest[c.id].amount || 0) : 0 }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value);
  renderBars(el("nw-breakdown"), breakdown, "No holdings yet — tap “Add holding”.");

  // Net worth over time
  renderChartInto("nw-chart", netWorthSeries(), {});
  if (!assets.length) el("nw-chart").innerHTML = `<p class="empty">Add holdings to see your net-worth trend.</p>`;

  // Recent holdings list
  const list = el("nw-list");
  list.innerHTML = "";
  const recent = [...assets].sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || "").localeCompare(a.createdAt || "")).slice(0, 40);
  for (const a of recent) {
    const cat = catById("asset", a.category);
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
        <button class="del-btn" title="Delete" aria-label="Delete">${DEL_ICON}</button>
      </span>`;
    li.querySelector(".expense-cat-icon").textContent = cat.icon;
    li.querySelector(".expense-cat-name").textContent = cat.label;
    li.querySelector(".expense-note").textContent = a.date + (a.note ? " · " + a.note : "");
    li.querySelector(".expense-amount").textContent = fmtMoney(a.amount);
    li.querySelector(".del-btn").addEventListener("click", () => removeEntry(a.id, "asset"));
    list.appendChild(li);
  }
  el("nw-empty").classList.toggle("hidden", assets.length > 0);
}

// =====================================================================
//  Calendar
// =====================================================================
function renderCalendar() {
  el("month-label").textContent = `${MONTHS[viewMonth]} ${viewYear}`;

  const expTotals = totalsByDate(expenses);
  const incTotals = totalsByDate(incomes);
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

  let monthExp = 0, monthInc = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const key = toKey(viewYear, viewMonth, d);
    const exp = expTotals[key] || 0;
    const inc = incTotals[key] || 0;
    monthExp += exp; monthInc += inc;

    const cell = document.createElement("div");
    cell.className = "day" + (key === tKey ? " today" : "");
    const num = document.createElement("span");
    num.className = "day-num";
    num.textContent = String(d);
    cell.appendChild(num);
    const amts = document.createElement("span");
    amts.className = "day-amts";
    if (exp > 0) amts.innerHTML += `<span class="day-exp">${fmtMoneyShort(exp)}</span>`;
    if (inc > 0) amts.innerHTML += `<span class="day-inc">${fmtMoneyShort(inc)}</span>`;
    cell.appendChild(amts);
    cell.addEventListener("click", () => openDayModal(key));
    grid.appendChild(cell);
  }
  el("month-total-value").innerHTML =
    `<span class="day-exp">−${fmtMoney(monthExp)}</span> &nbsp; <span class="day-inc">+${fmtMoney(monthInc)}</span>`;
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
    byCat[catById("expense", e.category).id] = (byCat[catById("expense", e.category).id] || 0) + Number(e.amount || 0);
  }
  const catRows = CATEGORIES.expense
    .map((c) => ({ label: `${c.icon} ${c.label}`, value: byCat[c.id] || 0 }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value);
  renderBars(el("stat-cats"), catRows, "No expenses this month.");

  // Chart: monthly totals for the viewed year
  el("chart-months-title").textContent = `Monthly totals — ${viewYear}`;
  const nowM = now.getMonth(), nowY = now.getFullYear();
  const monthlyChart = MONTHS_SHORT.map((m, idx) => ({
    short: m[0],
    label: `${m} ${viewYear}`,
    value: byMonth[`${viewYear}-${pad(idx + 1)}`] || 0,
  }));
  const hi = viewYear === nowY ? nowM : -1;
  renderChartInto("chart-months", monthlyChart, { highlightIndex: hi });

  // Chart: totals by year
  const byYear = {};
  for (const e of expenses) {
    const y = e.date.slice(0, 4);
    byYear[y] = (byYear[y] || 0) + Number(e.amount || 0);
  }
  const yearChart = Object.keys(byYear).sort()
    .map((y) => ({ short: y, label: y, value: byYear[y] }));
  if (yearChart.length) {
    renderChartInto("chart-years", yearChart, { highlightIndex: yearChart.findIndex((r) => r.short === String(nowY)) });
  } else {
    el("chart-years").innerHTML = `<p class="empty">No data yet.</p>`;
  }

  // Month by month (all months, newest first)
  const monthRows = Object.keys(byMonth)
    .sort((a, b) => b.localeCompare(a))
    .map((k) => {
      const [y, m] = k.split("-").map(Number);
      return { label: `${MONTHS_SHORT[m - 1]} ${y}`, value: byMonth[k] };
    });
  renderBars(el("stat-months"), monthRows, "No data yet.");
}

// Minimal dependency-free SVG bar chart (scales to width, theme-aware,
// interactive: each bar shows its amount and can be tapped/hovered).
function barChartSVG(rows, { highlightIndex = -1 } = {}) {
  const W = 320, H = 162, padT = 20, padB = 22, padX = 6;
  const n = rows.length || 1;
  const max = Math.max(1, ...rows.map((r) => r.value));
  const chartH = H - padT - padB;
  const bw = (W - padX * 2) / n;
  const innerW = Math.min(bw * 0.66, 40);
  const baseY = padT + chartH;
  const dense = n > 8; // hide value labels when too many bars to avoid clutter
  let svg = "";
  rows.forEach((r, i) => {
    const h = (r.value / max) * chartH;
    const cx = padX + i * bw + bw / 2;
    const x = cx - innerW / 2;
    const y = baseY - h;
    const fill = i === highlightIndex ? "var(--primary)" : "var(--has-exp)";
    const op = r.value > 0 ? 1 : 0.18;
    svg += `<rect class="cbar" data-i="${i}" data-label="${r.label}" data-amt="${fmtMoney(r.value)}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${innerW.toFixed(1)}" height="${Math.max(0, h).toFixed(1)}" rx="2" fill="${fill}" opacity="${op}"><title>${r.label}: ${fmtMoney(r.value)}</title></rect>`;
    if (r.value > 0 && (!dense || i === highlightIndex)) {
      svg += `<text x="${cx.toFixed(1)}" y="${(y - 3).toFixed(1)}" text-anchor="middle" font-size="7.5" fill="var(--muted)">${fmtMoneyShort(r.value)}</text>`;
    }
    svg += `<text x="${cx.toFixed(1)}" y="${H - 7}" text-anchor="middle" font-size="9" fill="var(--muted)">${r.short ?? ""}</text>`;
  });
  svg += `<line x1="${padX}" y1="${baseY}" x2="${W - padX}" y2="${baseY}" stroke="var(--border)" stroke-width="1"/>`;
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img">${svg}</svg>`;
}

// Render a chart plus a readout line, and preselect a meaningful bar.
function renderChartInto(id, rows, opts = {}) {
  const cont = el(id);
  cont.innerHTML = barChartSVG(rows, opts) + `<div class="chart-read"></div>`;
  let idx = opts.highlightIndex;
  if (idx == null || idx < 0 || !(rows[idx] && rows[idx].value > 0)) {
    idx = rows.reduce((bi, r, i, arr) => (r.value > (arr[bi]?.value || 0) ? i : bi), 0);
  }
  selectChartBar(cont, idx);
}
function selectChartBar(cont, idx) {
  const rects = cont.querySelectorAll("rect.cbar");
  const read = cont.querySelector(".chart-read");
  if (!rects.length || !read) return;
  rects.forEach((r) => r.classList.remove("sel"));
  const r = rects[idx];
  if (r) { r.classList.add("sel"); read.textContent = `${r.dataset.label}: ${r.dataset.amt}`; }
  else read.textContent = "";
}
function onChartPoint(cont, e) {
  const rect = e.target.closest && e.target.closest("rect.cbar");
  if (rect) selectChartBar(cont, Number(rect.dataset.i));
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
  const byDay = totalsByDate(expenses);
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
    const id = catById("expense", e.category).id;
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
      ["Top by spend", topCatSpend ? `${catById("expense", topCatSpend[0]).label} (${fmtMoney(topCatSpend[1])})` : "—"],
      ["Top by count", topCatCount ? `${catById("expense", topCatCount[0]).label} (${topCatCount[1]}×)` : "—"],
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
const DEL_ICON = `<svg class="ic" viewBox="0 0 24 24"><path d="M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2M6 7l1 13a1 1 0 001 1h8a1 1 0 001-1l1-13"/></svg>`;

let addTypes = ["expense", "income"];  // which type buttons to show in the toggle

function renderTypeToggle() {
  const wrap = el("type-toggle");
  wrap.innerHTML = "";
  wrap.classList.toggle("hidden", addTypes.length < 2);
  for (const t of addTypes) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "seg" + (t === activeType ? " active" : "") + ` seg-${t}`;
    b.textContent = TYPE_LABELS[t];
    b.addEventListener("click", () => {
      activeType = t;
      selectedCategory = CATEGORIES[t][0].id;
      renderTypeToggle();
      renderCatChips();
    });
    wrap.appendChild(b);
  }
}
function renderCatChips() {
  const wrap = el("cat-chips");
  wrap.innerHTML = "";
  for (const c of CATEGORIES[activeType]) {
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
// type defaults to expense; pass types to control the toggle (e.g. ["asset"]).
function openAddModal(dateKey, type = "expense", types = ["expense", "income"]) {
  closeDayModal();
  addTypes = types;
  activeType = type;
  activeDate = dateKey;
  amountStr = "";
  selectedCategory = CATEGORIES[activeType][0].id;
  el("note-input").value = "";
  el("add-date-label").textContent = fmtDateLabel(dateKey);
  renderTypeToggle();
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
async function saveEntry() {
  const amount = parseFloat(amountStr);
  if (!(amount > 0)) { toast("Enter an amount"); return; }
  const now = new Date().toISOString();
  arrFor(activeType).push({
    id: crypto.randomUUID(),
    date: activeDate,
    amount,
    category: selectedCategory,
    note: el("note-input").value.trim(),
    createdAt: now,
    updatedAt: now,
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
function entryRow(e, type) {
  const cat = catById(type, e.category);
  const li = document.createElement("li");
  li.className = "expense-item";
  li.innerHTML = `
    <span class="expense-cat-icon"></span>
    <span class="expense-main">
      <span class="expense-cat-name"></span>
      <span class="expense-note"></span>
    </span>
    <span class="expense-right">
      <span class="expense-amount ${type === "income" ? "amt-inc" : "amt-exp"}"></span>
      <button class="del-btn" title="Delete" aria-label="Delete">${DEL_ICON}</button>
    </span>`;
  li.querySelector(".expense-cat-icon").textContent = cat.icon;
  li.querySelector(".expense-cat-name").textContent = cat.label;
  const note = li.querySelector(".expense-note");
  if (e.note) note.textContent = e.note; else note.remove();
  li.querySelector(".expense-amount").textContent = (type === "income" ? "+" : "−") + fmtMoney(e.amount);
  li.querySelector(".del-btn").addEventListener("click", () => removeEntry(e.id, type));
  return li;
}
function renderDayModal(dateKey) {
  el("day-date-label").textContent = fmtDateLabel(dateKey);
  const exp = expenses.filter((e) => e.date === dateKey).sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  const inc = incomes.filter((e) => e.date === dateKey).sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));

  const list = el("day-list");
  list.innerHTML = "";
  for (const e of exp) list.appendChild(entryRow(e, "expense"));
  for (const e of inc) list.appendChild(entryRow(e, "income"));

  const expTotal = exp.reduce((s, e) => s + Number(e.amount || 0), 0);
  const incTotal = inc.reduce((s, e) => s + Number(e.amount || 0), 0);
  el("day-total-value").innerHTML =
    `<span class="amt-exp">−${fmtMoney(expTotal)}</span> &nbsp; <span class="amt-inc">+${fmtMoney(incTotal)}</span>`;
  el("day-empty").classList.toggle("hidden", exp.length + inc.length > 0);
  dayModalDate = dateKey;
}
function closeDayModal() { el("day-modal").classList.add("hidden"); dayModalDate = null; }
async function removeEntry(id, type) {
  const arr = arrFor(type);
  const idx = arr.findIndex((e) => e.id === id);
  if (idx >= 0) arr.splice(idx, 1);
  deleted[id] = Date.now();          // tombstone so the deletion survives merges
  renderCalendar();
  if (dayModalDate) renderDayModal(dayModalDate);
  await persist();
}

// =====================================================================
//  Persistence (local-first; Drive sync is always load-merge-save)
// =====================================================================

function setStatus(state) {
  const e = el("sync-status");
  const spin = '<span class="mini-spin"></span> ';
  e.classList.remove("status-ok", "status-warn");
  if (state === "saving") e.innerHTML = spin + "Saving…";
  else if (state === "syncing") e.innerHTML = spin + "Syncing…";
  else if (state === "saved") { e.textContent = "✓ Saved to Drive"; e.classList.add("status-ok"); }
  else if (state === "synced") { e.textContent = "✓ Connected — synced with Drive"; e.classList.add("status-ok"); }
  else if (state === "local") { e.textContent = "• Saved on device — tap ⟳ to sync to Drive"; e.classList.add("status-warn"); }
  else if (state === "offline") { e.textContent = "⚠ Offline — saved on device, will sync when online"; e.classList.add("status-warn"); }
  else if (state === "signin") { e.textContent = "• Saved on device — tap ⟳ to sync to Drive"; e.classList.add("status-warn"); }
  else e.textContent = "";
}

// Obtain a fresh Google token. Must be called from a user gesture (save/delete)
// so the sign-in popup is allowed. Usually skips the account chooser.
async function ensureToken() {
  try {
    const { accessToken, user } = await signIn();
    if (accessToken) { setToken(accessToken); setUserUI(user); return true; }
  } catch (e) {
    if (e?.code !== "auth/popup-closed-by-user") console.error(e);
  }
  return false;
}

function applyDoc(doc) {
  expenses = doc.expenses;
  incomes = doc.incomes || [];
  assets = doc.assets || [];
  deleted = doc.deleted;
  saveLocal();
  refreshAll();
}

// Serialize all Drive access so a save and a background sync can't race and
// clobber each other.
let chain = Promise.resolve();
function lock(fn) {
  const p = chain.then(fn, fn);
  chain = p.catch(() => {});
  return p;
}

function spinRefresh(on) {
  el("refresh-btn").classList.toggle("spinning", on);
}

// The ONLY path that writes to Drive. It always reads remote first and merges
// by id, so it can never overwrite data it hasn't seen and never duplicates.
// - label:       "saving" or "syncing" (status text)
// - interactive: may pop up Google sign-in to get a token (only from a gesture)
function syncNow({ label = "syncing", interactive = false } = {}) {
  return lock(async () => {
    if (!navigator.onLine) { setStatus(isDirty() ? "offline" : "synced"); return; }
    setStatus(label);
    spinRefresh(true);
    try {
      if (!getToken()) {
        if (interactive) {
          const ok = await ensureToken();
          if (!ok) { setStatus(isDirty() ? "local" : "signin"); return; }
        } else {
          setStatus(isDirty() ? "local" : "signin");
          return;
        }
      }
      const attempt = async () => {
        const remote = await store.loadDoc();
        const merged = mergeDocs(remote, localDoc());
        applyDoc(merged);
        await store.saveDoc(merged);
        clearDirty();
        setStatus(label === "saving" ? "saved" : "synced");
      };
      try {
        await attempt();
      } catch (err) {
        if (err instanceof store.AuthExpiredError) {
          clearToken();
          if (interactive && await ensureToken()) {
            try { await attempt(); return; } catch (e) { console.error(e); }
          }
          setStatus(isDirty() ? "local" : "signin");
        } else if (err instanceof store.NetworkError) {
          setStatus("offline");
        } else {
          console.error(err);
          setStatus(isDirty() ? "local" : "synced");
        }
      }
    } finally {
      spinRefresh(false);
    }
  });
}

async function persist() {
  saveLocal();
  setDirty();
  // Background only: never interrupt adding an expense with a sign-in popup.
  // If the token is valid it syncs silently; if not, it stays local and syncs
  // on the next refresh/foreground.
  await syncNow({ label: "saving", interactive: false });
}

// Manual "refresh from Drive" — always tries (re-auth allowed since it's a tap).
function manualRefresh() {
  syncNow({ label: "syncing", interactive: true });
}

// =====================================================================
//  Auth flow
// =====================================================================
async function handleSignIn() {
  el("login-btn").disabled = true;
  try {
    const { accessToken, user } = await signIn();
    if (!accessToken) { toast("Google didn't return Drive access — try again"); el("login-btn").disabled = false; return; }
    setToken(accessToken);
    setUserUI(user);
    enterAppLocal(true);
    syncNow({ label: "syncing", interactive: false });
  } catch (err) {
    if (err?.code !== "auth/popup-closed-by-user") { console.error(err); toast("Sign-in failed"); }
    el("login-btn").disabled = false;
  }
}

// Show the app immediately from the local copy (no waiting on Google).
function enterAppLocal(promptToday) {
  if (!entered) {
    entered = true;
    const now = new Date();
    viewYear = now.getFullYear();
    viewMonth = now.getMonth();
    switchTab("calendar");
  }
  renderCalendar();
  show("app");
  if (promptToday) openAddModal(todayKey());
}

function refreshAll() {
  renderCalendar();
  if (!el("wealth-panel").classList.contains("hidden")) renderWealth();
  if (!el("stats-panel").classList.contains("hidden")) renderStats();
  if (!el("math-panel").classList.contains("hidden")) renderMath();
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
    clearToken();
    clearLocal();
    clearDirty();
    entered = false;
    expenses = [];
    deleted = {};
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
  TABS.forEach((t) => el(`tab-${t}`).addEventListener("click", () => switchTab(t)));

  // Interactive charts (tap/hover a bar to read its amount)
  ["chart-months", "chart-years", "nw-chart"].forEach((id) => {
    const c = el(id);
    c.addEventListener("click", (e) => onChartPoint(c, e));
    c.addEventListener("mouseover", (e) => onChartPoint(c, e));
  });

  // Add modal
  el("add-close").addEventListener("click", closeAddModal);
  el("save-expense").addEventListener("click", saveEntry);
  document.querySelectorAll(".dialpad .key").forEach((btn) => btn.addEventListener("click", () => pressKey(btn.dataset.key)));
  el("add-modal").addEventListener("click", (e) => { if (e.target.id === "add-modal") closeAddModal(); });

  // Quick add (floating button) — adds for today (expense/income toggle)
  el("fab-add").addEventListener("click", () => openAddModal(todayKey(), "expense", ["expense", "income"]));

  // Add holding (Wealth tab)
  el("nw-add").addEventListener("click", () => openAddModal(todayKey(), "asset", ["asset"]));

  // Manual refresh from Drive
  el("refresh-btn").addEventListener("click", manualRefresh);

  // Day modal
  el("day-close").addEventListener("click", closeDayModal);
  el("day-add").addEventListener("click", () => openAddModal(dayModalDate));
  el("day-modal").addEventListener("click", (e) => { if (e.target.id === "day-modal") closeDayModal(); });

  // Keep in sync automatically: when the connection returns, or when the app
  // comes back to the foreground.
  window.addEventListener("online", () => { if (entered && getToken()) syncNow({ label: "syncing", interactive: false }); });
  window.addEventListener("offline", () => { if (entered) setStatus(isDirty() ? "offline" : "synced"); });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && entered && getToken()) syncNow({ label: "syncing", interactive: false });
  });

  // Local-first boot: open straight to the calendar from the local copy (and
  // always offer to add today's expense). Sync with Drive in the background.
  const doc = loadLocal();
  expenses = doc.expenses;
  deleted = doc.deleted;
  const token = getToken();
  if (token || expenses.length) {
    enterAppLocal(true);
    if (token) syncNow({ label: "syncing", interactive: false });
  }

  watchAuth((user) => {
    setUserUI(user);
    if (entered) {
      if (getToken()) syncNow({ label: "syncing", interactive: false });
      return;
    }
    if (user) {
      // Returning user whose local copy was cleared: still go straight in.
      enterAppLocal(true);
      syncNow({ label: "syncing", interactive: false });
    } else {
      // Brand-new (or signed out): show the login screen.
      show("login");
      el("login-btn").disabled = false;
    }
  });

  // Safety net: never get stuck on the loading spinner.
  setTimeout(() => {
    if (!entered && el("login-view").classList.contains("hidden")) {
      show("login");
      el("login-btn").disabled = false;
    }
  }, 6000);
}

init();
