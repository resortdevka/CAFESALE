// app.js — H'ola Amigos Cafe POS & Sales Desk
// Fully functional & secure Firestore-backed management system

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, collection, doc, addDoc, setDoc, updateDoc, deleteDoc,
  getDoc, onSnapshot, query, orderBy, limit, writeBatch, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { DEFAULT_MENU, CATEGORY_ORDER, CATEGORY_ICONS } from "./seed-data.js";

// ---------------------------------------------------------------------
// Firebase Config & Init
// ---------------------------------------------------------------------
const firebaseConfig = {
  apiKey: "AIzaSyAo-BEqmDuwjm21r2B0AwwlbBlFelZ6m6c",
  authDomain: "coffee-sale-report.firebaseapp.com",
  projectId: "coffee-sale-report",
  storageBucket: "coffee-sale-report.firebasestorage.app",
  messagingSenderId: "199333413557",
  appId: "1:199333413557:web:ce219c3e66eda4a54734fc"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const DEFAULT_ADMIN_PASSWORD = "Admindbr063";
const DEFAULT_USER_PASSWORD  = "uzerdbr2026";
const DELETE_PASSWORD        = "0063";
const AUTH_SESSION_KEY      = "amigos_admin_authenticated";
const USER_AUTH_SESSION_KEY = "amigos_user_authenticated";

// ---------------------------------------------------------------------
// App State & Security
// ---------------------------------------------------------------------
let products = [];
let sales = [];
let selectedCategory = "";
let selectedProduct = null;
let searchQuery = "";
let adminProductSearch = "";
let isAdmin = false;
let isUser  = false;
let editingProductId = null;

// Analytics State
let selectedAnalyticsPeriod = "ALL"; // "ALL" or "YYYY-MM" or "this-month", "prev-month", "last-90"
let leaderboardSearch = "";
let leaderboardSort = "cups-desc";
const chartInstances = {
  topProducts: null,
  categoryShare: null,
  monthlyTrend: null,
  dailyTrend: null,
  hourlyTrend: null
};

// Brute-force protection state
let failedLoginAttempts = 0;
let lockoutTimer = null;
let lockoutSecondsRemaining = 0;

// ---------------------------------------------------------------------
// DOM & Sanitization Helpers
// ---------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, "0");

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const rupee = (n) => `₹${Number(n || 0).toLocaleString("en-IN")}`;

// HTML entity escaping for security (XSS prevention)
function sanitizeText(str) {
  if (typeof str !== "string") return "";
  return str.trim().replace(/[<>]/g, "");
}

const flashMsg = (el, text, ok = true) => {
  if (!el) return;
  el.textContent = text;
  el.className = "form-msg " + (ok ? "ok" : "err");
  if (text) {
    setTimeout(() => {
      if (el.textContent === text) {
        el.textContent = "";
        el.className = "form-msg";
      }
    }, 4500);
  }
};

// Category extraction & ordering
function getCategories() {
  const set = new Set(products.map((p) => p.category).filter(Boolean));
  const ordered = CATEGORY_ORDER.filter((c) => set.has(c));
  const extras = [...set].filter((c) => !CATEGORY_ORDER.includes(c)).sort();
  return [...ordered, ...extras];
}

// Update Database status indicator in topbar
function updateStatusIndicator(status, text) {
  const pill = $("db-status-pill");
  if (!pill) return;
  const dot = pill.querySelector(".status-dot");
  const label = $("status-text");
  dot.className = `status-dot ${status}`;
  label.textContent = text;
}

// ---------------------------------------------------------------------
// Firestore Setup — Ensure both settings docs exist
// ---------------------------------------------------------------------
async function ensureAdminDoc() {
  try {
    const ref = doc(db, "settings", "admin");
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, { password: DEFAULT_ADMIN_PASSWORD, updatedAt: serverTimestamp() });
    }
  } catch (e) {
    console.error("Could not verify admin settings doc:", e);
  }
}

async function ensureUserDoc() {
  try {
    const ref = doc(db, "settings", "user");
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, { password: DEFAULT_USER_PASSWORD, updatedAt: serverTimestamp() });
    }
  } catch (e) {
    console.error("Could not verify user settings doc:", e);
  }
}

// ---------------------------------------------------------------------
// Realtime Firestore Listeners
// ---------------------------------------------------------------------
function listenProducts() {
  const q = query(collection(db, "products"), orderBy("name"));
  onSnapshot(q, (snap) => {
    updateStatusIndicator("online", "Firestore Connected");
    products = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    // Client-side sort by category order, then name
    products.sort((a, b) => {
      const catA = CATEGORY_ORDER.indexOf(a.category);
      const catB = CATEGORY_ORDER.indexOf(b.category);
      const orderA = catA === -1 ? 999 : catA;
      const orderB = catB === -1 ? 999 : catB;
      if (orderA !== orderB) return orderA - orderB;
      return (a.name || "").localeCompare(b.name || "");
    });

    renderAllViews();
  }, (err) => {
    console.error("Products listener error:", err);
    updateStatusIndicator("offline", "Connection Error");
    const loading = $("menu-loading");
    if (loading) loading.textContent = "Could not load menu — check Firestore connection.";
  });
}

function listenSales() {
  const q = query(collection(db, "sales"), orderBy("createdAt", "desc"), limit(3000));
  onSnapshot(q, (snap) => {
    sales = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderTodayLog();
    renderSalesTable();
    renderAnalytics();
    renderMonthlyReports();
  }, (err) => {
    console.error("Sales listener error:", err);
  });
}

function renderAllViews() {
  renderCategoryChips();
  renderItemGrid();
  renderCategoryFilterOptions();
  renderCategoryDatalist();
  renderProductsTable();
}

// =======================================================================
// ORDER ENTRY VIEW
// =======================================================================
function renderCategoryChips() {
  const wrap = $("category-chips");
  if (!wrap) return;
  const cats = getCategories();
  wrap.innerHTML = "";

  const allChip = document.createElement("button");
  allChip.type = "button";
  allChip.className = "chip" + (selectedCategory === "" ? " active" : "");
  allChip.textContent = "All Items";
  allChip.onclick = () => {
    selectedCategory = "";
    renderCategoryChips();
    renderItemGrid();
  };
  wrap.appendChild(allChip);

  cats.forEach((c) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip" + (selectedCategory === c ? " active" : "");
    chip.textContent = `${CATEGORY_ICONS[c] || "☕"} ${c}`;
    chip.onclick = () => {
      selectedCategory = c;
      renderCategoryChips();
      renderItemGrid();
    };
    wrap.appendChild(chip);
  });
}

function renderItemGrid() {
  const grid = $("item-grid");
  const select = $("select-item");
  if (!grid || !select) return;

  // Filter products by category and search query
  let list = products;
  if (selectedCategory) {
    list = list.filter((p) => p.category === selectedCategory);
  }
  if (searchQuery) {
    const sq = searchQuery.toLowerCase();
    list = list.filter((p) =>
      (p.name && p.name.toLowerCase().includes(sq)) ||
      (p.category && p.category.toLowerCase().includes(sq))
    );
  }

  // Populate <select> dropdown with all products
  select.innerHTML = '<option value="">— choose from menu —</option>';
  products.forEach((p) => {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = `${p.name} (${p.category || "Beverage"}) — ${rupee(p.price)}`;
    select.appendChild(opt);
  });

  // Populate datalist for autocomplete
  const datalist = $("ticket-items-datalist");
  if (datalist) {
    datalist.innerHTML = "";
    products.forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p.name;
      opt.label = `${p.category || "Beverage"} — ${rupee(p.price)}`;
      datalist.appendChild(opt);
    });
  }

  if (selectedProduct) {
    select.value = selectedProduct.id;
  }

  grid.innerHTML = "";

  if (!products.length) {
    grid.innerHTML = '<p class="empty-state" style="grid-column: 1 / -1;">No products in the database yet. Go to Admin → Manage Products to add items or import the default menu.</p>';
    return;
  }

  if (!list.length) {
    grid.innerHTML = '<p class="empty-state" style="grid-column: 1 / -1;">No matching items found.</p>';
    return;
  }

  list.forEach((p) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "item-card" + (selectedProduct && selectedProduct.id === p.id ? " selected" : "");
    card.innerHTML = `
      <div>
        <span class="item-cat">${escapeHtml(p.category || "Beverage")}</span>
        <span class="item-name">${escapeHtml(p.name)}</span>
      </div>
      <div class="item-card-footer">
        <span class="item-price">${rupee(p.price)}</span>
        <span class="item-add-tag">Select</span>
      </div>
    `;
    card.onclick = () => selectProduct(p);
    grid.appendChild(card);
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}

// Auto-fill price and compute total upon selecting an item
function selectProduct(p) {
  if (!p) return;
  selectedProduct = p;

  if ($("select-item")) $("select-item").value = p.id;
  if ($("input-item-name")) $("input-item-name").value = p.name;
  if ($("selected-item-name")) $("selected-item-name").textContent = p.name;

  const cat = p.category || "Coffee";
  if ($("ticket-selected-cat")) $("ticket-selected-cat").textContent = cat;
  if ($("select-ticket-category")) $("select-ticket-category").value = cat;

  // Sync quick type pills
  document.querySelectorAll(".btn-type-pill").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.cat === cat);
  });

  // Automatically fill the price
  $("input-price").value = p.price;

  updateTicketTotal();
  renderItemGrid();
}

function updateTicketTotal() {
  const price = Math.max(0, Number($("input-price").value) || 0);
  const qty = Math.max(1, Math.floor(Number($("input-qty").value) || 1));
  const total = price * qty;

  $("ticket-total-amount").textContent = rupee(total);
  $("total-breakdown").textContent = `${qty} × ${rupee(price)}`;
}

function renderTodayLog() {
  const today = todayStr();
  const todays = sales.filter((s) => s.date === today);
  const list = $("today-log");
  const countPill = $("today-count");
  if (!list || !countPill) return;

  countPill.textContent = `${todays.length} sale${todays.length === 1 ? "" : "s"}`;

  if (!todays.length) {
    list.innerHTML = '<p class="empty-state">No sales logged yet today.</p>';
    $("today-summary").innerHTML = "";
    return;
  }

  list.innerHTML = "";
  todays.forEach((s) => {
    const row = document.createElement("div");
    row.className = "log-row";
    const remarkDisplay = s.remark || s.barista;
    row.innerHTML = `
      <div>
        <div class="li-name">${escapeHtml(s.itemName)} <span class="pill" style="font-size:10px; padding:2px 6px; margin-left:4px;">${escapeHtml(s.category || "Item")}</span></div>
        <div class="li-meta">Qty ${s.quantity} · ${rupee(s.price)} each${remarkDisplay ? " · 💬 " + escapeHtml(remarkDisplay) : ""} · ${s.time || ""}</div>
      </div>
      <div class="li-amt">${rupee(s.total)}</div>
    `;
    list.appendChild(row);
  });

  const revenue = todays.reduce((sum, s) => sum + Number(s.total || 0), 0);
  const totalCups = todays.reduce((sum, s) => sum + Number(s.quantity || 0), 0);
  $("today-summary").innerHTML = `
    <span>${totalCups} item${totalCups === 1 ? "" : "s"} today</span>
    <span>${rupee(revenue)}</span>
  `;
}

// Add sale — writes directly to Firestore with custom or selected item & custom amount
async function addSale() {
  const msg = $("entry-msg");
  const nameInput = $("input-item-name");
  const select = $("select-item");
  const catSelect = $("select-ticket-category");

  let itemName = sanitizeText(nameInput ? nameInput.value : "");
  if (!itemName && select && select.value) {
    const product = products.find((p) => p.id === select.value);
    if (product) itemName = product.name;
  }

  const category = sanitizeText(catSelect ? catSelect.value : (selectedProduct ? selectedProduct.category : "Coffee"));
  const saleDate = $("input-date").value;
  const price = Math.max(0, Number($("input-price").value) || 0);
  const qty = Math.max(1, Math.floor(Number($("input-qty").value) || 1));
  const remarkInput = $("input-remark");
  const remark = sanitizeText(remarkInput ? remarkInput.value : "");

  if (!itemName) return flashMsg(msg, "Please enter or pick an item name.", false);
  if (!saleDate) return flashMsg(msg, "Please select a date.", false);
  if (!price || price <= 0) return flashMsg(msg, "Please enter a valid price/amount.", false);

  try {
    await addDoc(collection(db, "sales"), {
      itemName,
      category: category || "Coffee",
      productId: selectedProduct ? selectedProduct.id : null,
      price,
      quantity: qty,
      total: price * qty,
      date: saleDate,
      time: pad(new Date().getHours()) + ":" + pad(new Date().getMinutes()),
      remark: remark || null,
      barista: remark || null,
      createdAt: serverTimestamp()
    });

    flashMsg(msg, `✅ Logged ${qty} × ${itemName} (${category}) — ${rupee(price * qty)}`, true);

    // ── Full reset for next entry ──
    selectedProduct = null;
    if ($("input-item-name")) $("input-item-name").value = "";
    if ($("select-item")) $("select-item").value = "";
    $("selected-item-name").textContent = "New Order Entry";
    $("input-price").value = "";
    $("input-qty").value = 1;
    if ($("input-remark")) $("input-remark").value = "";
    $("input-date").value = todayStr();
    updateTicketTotal();
    renderItemGrid(); // deselect card highlight
  } catch (e) {
    console.error("Sale logging error:", e);
    flashMsg(msg, "Could not save sale. Check your Firestore connection.", false);
  }
}

// =======================================================================
// USER GATE — Login (password stored in Firestore settings/user)
// =======================================================================
function showMainApp() {
  isUser = true;
  sessionStorage.setItem(USER_AUTH_SESSION_KEY, "true");
  const gate = $("user-login-gate");
  const main = $("main-app");
  if (gate) gate.style.display = "none";
  if (main) main.style.display = "";
}

async function attemptUserLogin() {
  const msg    = $("user-login-msg");
  const btn    = $("btn-user-login");
  const pwd    = $("user-password").value.trim();
  if (!pwd) return flashMsg(msg, "Please enter the password.", false);

  btn.disabled = true;
  btn.textContent = "Checking…";

  try {
    const snap = await getDoc(doc(db, "settings", "user"));
    const stored = snap.exists() && snap.data().password ? snap.data().password : DEFAULT_USER_PASSWORD;
    if (pwd === stored) {
      showMainApp();
    } else {
      flashMsg(msg, "Incorrect password. Please try again.", false);
      $("user-password").value = "";
      $("user-password").focus();
    }
  } catch (e) {
    console.error("User login error:", e);
    // Fallback to default if Firestore unavailable
    if (pwd === DEFAULT_USER_PASSWORD) {
      showMainApp();
    } else {
      flashMsg(msg, "Incorrect password.", false);
    }
  } finally {
    btn.disabled = false;
    btn.textContent = "Enter";
  }
}

function setupUserGate() {
  const btn = $("btn-user-login");
  if (btn) btn.onclick = attemptUserLogin;

  const pwdInput = $("user-password");
  if (pwdInput) {
    pwdInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") attemptUserLogin();
    });
  }

  // Eye toggle for user gate
  const toggle = $("btn-toggle-user-pwd");
  if (toggle) {
    toggle.onclick = () => {
      const inp = $("user-password");
      if (inp.type === "password") { inp.type = "text"; toggle.textContent = "🙈"; }
      else { inp.type = "password"; toggle.textContent = "👁️"; }
    };
  }

  // Restore user session if previously authenticated in this browser tab
  if (sessionStorage.getItem(USER_AUTH_SESSION_KEY) === "true") {
    showMainApp();
  }
}

// =======================================================================
// ADMIN — LOGIN & SECURITY (With brute-force lockout & session support)
// =======================================================================
function showAdminDashboard() {
  isAdmin = true;
  sessionStorage.setItem(AUTH_SESSION_KEY, "true");

  const loginGate = $("admin-login");
  const dash = $("admin-dashboard");

  loginGate.style.display = "none";
  dash.style.display = "block";
  dash.removeAttribute("hidden");

  $("admin-password").value = "";
  flashMsg($("login-msg"), "", true);

  renderAnalytics();
  renderMonthlyReports();
  renderSalesTable();
  renderProductsTable();
}

function adminLogout() {
  isAdmin = false;
  sessionStorage.removeItem(AUTH_SESSION_KEY);

  const loginGate = $("admin-login");
  const dash = $("admin-dashboard");

  dash.style.display = "none";
  dash.setAttribute("hidden", "");
  loginGate.style.display = "flex";
  loginGate.removeAttribute("hidden");

  $("admin-password").value = "";
}

async function attemptAdminLogin() {
  const msg = $("login-msg");
  const loginBtn = $("btn-admin-login");

  if (lockoutSecondsRemaining > 0) {
    return flashMsg(msg, `Locked out due to repeated attempts. Please wait ${lockoutSecondsRemaining}s.`, false);
  }

  const pwd = $("admin-password").value.trim();
  if (!pwd) return flashMsg(msg, "Please enter the admin password.", false);

  loginBtn.disabled = true;
  loginBtn.textContent = "Verifying…";

  try {
    const snap = await getDoc(doc(db, "settings", "admin"));
    const storedPassword = snap.exists() && snap.data().password ? snap.data().password : DEFAULT_ADMIN_PASSWORD;

    if (pwd === storedPassword) {
      failedLoginAttempts = 0;
      showAdminDashboard();
    } else {
      failedLoginAttempts++;
      if (failedLoginAttempts >= 5) {
        startLockout();
      } else {
        flashMsg(msg, `Incorrect password. (${5 - failedLoginAttempts} attempts left)`, false);
      }
    }
  } catch (e) {
    console.error("Login verification error:", e);
    flashMsg(msg, "Could not verify password. Check Firestore connection.", false);
  } finally {
    if (lockoutSecondsRemaining <= 0) {
      loginBtn.disabled = false;
      loginBtn.textContent = "Unlock Admin";
    }
  }
}

function startLockout() {
  lockoutSecondsRemaining = 30;
  const loginBtn = $("btn-admin-login");
  const msg = $("login-msg");

  loginBtn.disabled = true;

  if (lockoutTimer) clearInterval(lockoutTimer);
  lockoutTimer = setInterval(() => {
    lockoutSecondsRemaining--;
    if (lockoutSecondsRemaining <= 0) {
      clearInterval(lockoutTimer);
      failedLoginAttempts = 0;
      loginBtn.disabled = false;
      loginBtn.textContent = "Unlock Admin";
      flashMsg(msg, "You can try entering the password again.", true);
    } else {
      loginBtn.textContent = `Locked (${lockoutSecondsRemaining}s)`;
      flashMsg(msg, `Too many failed attempts. Try again in ${lockoutSecondsRemaining}s.`, false);
    }
  }, 1000);
}

// =======================================================================
// ADMIN — DATA ANALYTICS & MONTH-WISE INTELLIGENCE ENGINE
// =======================================================================

function formatMonthKey(ym) {
  if (!ym || ym === "ALL") return "All Time";
  const parts = ym.split("-");
  if (parts.length < 2) return ym;
  const date = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, 1);
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function getAvailableMonths() {
  const set = new Set();
  sales.forEach((s) => {
    if (s.date && s.date.length >= 7) {
      set.add(s.date.substring(0, 7)); // YYYY-MM
    }
  });
  const currentYM = todayStr().substring(0, 7);
  set.add(currentYM);
  return [...set].sort().reverse();
}

function updateMonthFilterOptions() {
  const sel = $("analytics-month-select");
  if (!sel) return;
  const current = selectedAnalyticsPeriod;
  const months = getAvailableMonths();

  sel.innerHTML = '<option value="ALL">All Time (Overall Analytics)</option>';
  months.forEach((ym) => {
    const opt = document.createElement("option");
    opt.value = ym;
    opt.textContent = formatMonthKey(ym);
    sel.appendChild(opt);
  });

  if (["ALL", "this-month", "prev-month", "last-90"].includes(current) || months.includes(current)) {
    sel.value = current;
  }
}

function getFilteredAnalyticsSales() {
  const currentYM = todayStr().substring(0, 7);
  const now = new Date();
  const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevYM = `${prevDate.getFullYear()}-${pad(prevDate.getMonth() + 1)}`;

  if (selectedAnalyticsPeriod === "ALL") {
    return sales;
  }
  if (selectedAnalyticsPeriod === "this-month") {
    return sales.filter((s) => s.date && s.date.startsWith(currentYM));
  }
  if (selectedAnalyticsPeriod === "prev-month") {
    return sales.filter((s) => s.date && s.date.startsWith(prevYM));
  }
  if (selectedAnalyticsPeriod === "last-90") {
    const d90 = new Date();
    d90.setDate(d90.getDate() - 90);
    const d90Str = `${d90.getFullYear()}-${pad(d90.getMonth() + 1)}-${pad(d90.getDate())}`;
    return sales.filter((s) => s.date && s.date >= d90Str);
  }
  // Specific YYYY-MM
  return sales.filter((s) => s.date && s.date.startsWith(selectedAnalyticsPeriod));
}

function getPeriodDescription() {
  const currentYM = todayStr().substring(0, 7);
  const now = new Date();
  const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevYM = `${prevDate.getFullYear()}-${pad(prevDate.getMonth() + 1)}`;

  if (selectedAnalyticsPeriod === "ALL") {
    return "All Time (Complete Cafe History)";
  }
  if (selectedAnalyticsPeriod === "this-month") {
    return `This Month (${formatMonthKey(currentYM)})`;
  }
  if (selectedAnalyticsPeriod === "prev-month") {
    return `Last Month (${formatMonthKey(prevYM)})`;
  }
  if (selectedAnalyticsPeriod === "last-90") {
    return "Past 90 Days Sales Intelligence";
  }
  return formatMonthKey(selectedAnalyticsPeriod);
}

function renderAnalytics() {
  updateMonthFilterOptions();
  const filtered = getFilteredAnalyticsSales();

  // Basic stats
  const totalRevenue = filtered.reduce((s, x) => s + Number(x.total || 0), 0);
  const totalCups = filtered.reduce((s, x) => s + Number(x.quantity || 0), 0);
  const totalOrders = filtered.length;
  const aov = totalOrders ? Math.round(totalRevenue / totalOrders) : 0;

  // Distinct active sales days
  const activeDays = new Set(filtered.map((s) => s.date)).size || 1;
  const avgRevenuePerDay = Math.round(totalRevenue / activeDays);

  // Group by item
  const itemMap = {};
  filtered.forEach((s) => {
    const name = s.itemName || "Unknown";
    if (!itemMap[name]) {
      itemMap[name] = {
        name,
        category: s.category || "Beverage",
        price: Number(s.price || 0),
        cups: 0,
        revenue: 0,
        orders: 0
      };
    }
    itemMap[name].cups += Number(s.quantity || 0);
    itemMap[name].revenue += Number(s.total || 0);
    itemMap[name].orders += 1;
  });
  const items = Object.values(itemMap);

  // Best seller
  let bestSeller = null;
  items.forEach((item) => {
    if (!bestSeller || item.cups > bestSeller.cups) {
      bestSeller = item;
    }
  });

  // Group by category
  const catMap = {};
  filtered.forEach((s) => {
    const cat = s.category || "Beverage";
    if (!catMap[cat]) {
      catMap[cat] = { name: cat, cups: 0, revenue: 0, orders: 0 };
    }
    catMap[cat].cups += Number(s.quantity || 0);
    catMap[cat].revenue += Number(s.total || 0);
    catMap[cat].orders += 1;
  });
  const categories = Object.values(catMap);

  let topCategory = null;
  categories.forEach((c) => {
    if (!topCategory || c.revenue > topCategory.revenue) {
      topCategory = c;
    }
  });

  // 1. Update KPI Card values
  if ($("kpi-revenue")) $("kpi-revenue").textContent = rupee(totalRevenue);
  if ($("kpi-revenue-sub")) $("kpi-revenue-sub").textContent = `Avg per active day: ${rupee(avgRevenuePerDay)}`;

  if ($("kpi-cups")) $("kpi-cups").textContent = totalCups.toLocaleString("en-IN");
  if ($("kpi-cups-sub")) $("kpi-cups-sub").textContent = activeDays > 1 ? `Avg ~${Math.round(totalCups / activeDays)} cups/day` : "Total beverage volume";

  if ($("kpi-best-coffee")) {
    $("kpi-best-coffee").textContent = bestSeller ? bestSeller.name : "—";
  }
  if ($("kpi-best-coffee-sub")) {
    if (bestSeller && totalCups > 0) {
      const share = Math.round((bestSeller.cups / totalCups) * 100);
      $("kpi-best-coffee-sub").textContent = `🏆 ${bestSeller.cups} cups · ${rupee(bestSeller.revenue)} (${share}% share)`;
    } else {
      $("kpi-best-coffee-sub").textContent = "0 cups · ₹0 revenue";
    }
  }

  if ($("kpi-top-category")) {
    $("kpi-top-category").textContent = topCategory ? topCategory.name : "—";
  }
  if ($("kpi-top-category-sub")) {
    if (topCategory && totalRevenue > 0) {
      const share = Math.round((topCategory.revenue / totalRevenue) * 100);
      $("kpi-top-category-sub").textContent = `${rupee(topCategory.revenue)} · ${share}% of revenue`;
    } else {
      $("kpi-top-category-sub").textContent = "0% of total sales";
    }
  }

  if ($("kpi-aov")) $("kpi-aov").textContent = rupee(aov);
  if ($("kpi-aov-sub")) $("kpi-aov-sub").textContent = totalOrders ? `Across ${totalOrders} tickets` : "Average per transaction";

  if ($("kpi-orders")) $("kpi-orders").textContent = totalOrders.toLocaleString("en-IN");
  if ($("kpi-orders-sub")) $("kpi-orders-sub").textContent = `Active selling days: ${activeDays}`;

  // Update banner text
  const banner = $("analytics-banner-text");
  if (banner) {
    banner.textContent = `Viewing ${getPeriodDescription()} · ${filtered.length} Orders · ${totalCups} Cups · ${rupee(totalRevenue)}`;
  }

  // 2. Render Charts
  renderTopProductsChart(items);
  renderCategoryShareChart(categories, totalRevenue);
  renderMonthlyTrendChart();
  renderDailyTrendChart(filtered);
  renderHourlyTrendChart(filtered);

  // 3. Render Leaderboard Table
  renderLeaderboardTable(items, totalCups, activeDays);
}

// ---------------------------------------------------------------------
// CHART.JS RENDERERS
// ---------------------------------------------------------------------
const CHART_COLORS = [
  "#114B4F", "#F1653D", "#F2A93B", "#3D7A41", "#8A4FFF",
  "#00A896", "#E63946", "#457B9D", "#D4A373", "#6B5F52"
];

function destroyChart(key) {
  if (chartInstances[key]) {
    chartInstances[key].destroy();
    chartInstances[key] = null;
  }
}

function renderTopProductsChart(items) {
  const canvas = $("chart-top-products");
  if (!canvas || typeof Chart === "undefined") return;
  destroyChart("topProducts");

  // Sort by cups desc, take top 10
  const sorted = [...items].sort((a, b) => b.cups - a.cups).slice(0, 10);
  const labels = sorted.map((x) => x.name);
  const data = sorted.map((x) => x.cups);
  const revenues = sorted.map((x) => x.revenue);

  const tag = $("top-chart-tag");
  if (tag) tag.textContent = `Top ${sorted.length} Beverages`;

  const ctx = canvas.getContext("2d");
  chartInstances.topProducts = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "Cups Sold",
        data,
        backgroundColor: "rgba(17, 75, 79, 0.85)",
        borderColor: "#114B4F",
        borderWidth: 1.5,
        borderRadius: 6,
        hoverBackgroundColor: "#F1653D"
      }]
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (context) => {
              const cups = context.raw || 0;
              const rev = revenues[context.dataIndex] || 0;
              return ` ${cups} cups sold (${rupee(rev)})`;
            }
          }
        }
      },
      scales: {
        x: {
          beginAtZero: true,
          grid: { color: "rgba(0,0,0,0.05)" },
          ticks: { font: { family: "IBM Plex Mono", size: 11 } }
        },
        y: {
          grid: { display: false },
          ticks: { font: { family: "Work Sans", weight: "600", size: 12 } }
        }
      }
    }
  });
}

function renderCategoryShareChart(categories, totalRevenue) {
  const canvas = $("chart-category-share");
  if (!canvas || typeof Chart === "undefined") return;
  destroyChart("categoryShare");

  const sorted = [...categories].sort((a, b) => b.revenue - a.revenue);
  const labels = sorted.map((c) => c.name);
  const data = sorted.map((c) => c.revenue);

  const ctx = canvas.getContext("2d");
  chartInstances.categoryShare = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: labels.length ? labels : ["No data"],
      datasets: [{
        data: data.length ? data : [1],
        backgroundColor: data.length ? CHART_COLORS.slice(0, labels.length) : ["#EEE1C6"],
        borderWidth: 2,
        borderColor: "#FFFCF5"
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: "bottom",
          labels: { boxWidth: 12, font: { family: "Work Sans", size: 11, weight: "600" } }
        },
        tooltip: {
          callbacks: {
            label: (context) => {
              if (!data.length) return " No data";
              const val = context.raw || 0;
              const pct = totalRevenue > 0 ? Math.round((val / totalRevenue) * 100) : 0;
              return ` ${context.label}: ${rupee(val)} (${pct}%)`;
            }
          }
        }
      },
      cutout: "68%"
    }
  });
}

function renderMonthlyTrendChart() {
  const canvas = $("chart-monthly-trend");
  if (!canvas || typeof Chart === "undefined") return;
  destroyChart("monthlyTrend");

  // Aggregate ALL historical sales by month
  const monthMap = {};
  sales.forEach((s) => {
    if (!s.date || s.date.length < 7) return;
    const ym = s.date.substring(0, 7);
    if (!monthMap[ym]) {
      monthMap[ym] = { ym, revenue: 0, cups: 0 };
    }
    monthMap[ym].revenue += Number(s.total || 0);
    monthMap[ym].cups += Number(s.quantity || 0);
  });

  const sortedMonths = Object.keys(monthMap).sort();
  const labels = sortedMonths.map((ym) => formatMonthKey(ym));
  const revenues = sortedMonths.map((ym) => monthMap[ym].revenue);
  const cups = sortedMonths.map((ym) => monthMap[ym].cups);

  const ctx = canvas.getContext("2d");
  chartInstances.monthlyTrend = new Chart(ctx, {
    data: {
      labels: labels.length ? labels : ["Current Month"],
      datasets: [
        {
          type: "bar",
          label: "Revenue (₹)",
          data: revenues.length ? revenues : [0],
          backgroundColor: "rgba(241, 101, 61, 0.85)",
          borderColor: "#F1653D",
          borderWidth: 1.5,
          borderRadius: 6,
          yAxisID: "y"
        },
        {
          type: "line",
          label: "Total Cups Sold",
          data: cups.length ? cups : [0],
          borderColor: "#114B4F",
          backgroundColor: "#114B4F",
          borderWidth: 3,
          pointRadius: 5,
          pointHoverRadius: 7,
          pointBackgroundColor: "#FFFCF5",
          pointBorderColor: "#114B4F",
          pointBorderWidth: 2,
          yAxisID: "y1",
          tension: 0.3
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          position: "top",
          labels: { font: { family: "Work Sans", weight: "600", size: 12 } }
        },
        tooltip: {
          callbacks: {
            label: (context) => {
              if (context.dataset.yAxisID === "y") {
                return ` Revenue: ${rupee(context.raw)}`;
              }
              return ` Cups Sold: ${context.raw} cups`;
            }
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { font: { family: "Work Sans", weight: "600", size: 11.5 } }
        },
        y: {
          type: "linear",
          display: true,
          position: "left",
          beginAtZero: true,
          grid: { color: "rgba(0,0,0,0.06)" },
          ticks: {
            font: { family: "IBM Plex Mono", size: 11 },
            callback: (v) => `₹${Number(v).toLocaleString("en-IN")}`
          }
        },
        y1: {
          type: "linear",
          display: true,
          position: "right",
          beginAtZero: true,
          grid: { drawOnChartArea: false },
          ticks: {
            font: { family: "IBM Plex Mono", size: 11 },
            callback: (v) => `${v} cups`
          }
        }
      }
    }
  });
}

function renderDailyTrendChart(filteredSales) {
  const canvas = $("chart-daily-trend");
  if (!canvas || typeof Chart === "undefined") return;
  destroyChart("dailyTrend");

  // Aggregate by date
  const dayMap = {};
  filteredSales.forEach((s) => {
    if (!s.date) return;
    if (!dayMap[s.date]) {
      dayMap[s.date] = { date: s.date, revenue: 0, cups: 0 };
    }
    dayMap[s.date].revenue += Number(s.total || 0);
    dayMap[s.date].cups += Number(s.quantity || 0);
  });

  const sortedDates = Object.keys(dayMap).sort();
  const labels = sortedDates.map((d) => d.substring(5)); // MM-DD
  const revenues = sortedDates.map((d) => dayMap[d].revenue);
  const cups = sortedDates.map((d) => dayMap[d].cups);

  const sub = $("daily-chart-subtitle");
  if (sub) {
    sub.textContent = `${sortedDates.length} active day${sortedDates.length === 1 ? "" : "s"} in selected period`;
  }

  const ctx = canvas.getContext("2d");
  chartInstances.dailyTrend = new Chart(ctx, {
    type: "bar",
    data: {
      labels: labels.length ? labels : ["No data"],
      datasets: [{
        label: "Daily Revenue",
        data: revenues.length ? revenues : [0],
        backgroundColor: "rgba(17, 75, 79, 0.75)",
        borderColor: "#114B4F",
        borderWidth: 1,
        borderRadius: 4,
        hoverBackgroundColor: "#F1653D"
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => (items[0] && sortedDates[items[0].dataIndex]) || "",
            label: (context) => {
              const rev = context.raw || 0;
              const cup = cups[context.dataIndex] || 0;
              return ` Revenue: ${rupee(rev)} (${cup} cups)`;
            }
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { font: { family: "IBM Plex Mono", size: 10.5 } }
        },
        y: {
          beginAtZero: true,
          grid: { color: "rgba(0,0,0,0.05)" },
          ticks: {
            font: { family: "IBM Plex Mono", size: 10.5 },
            callback: (v) => `₹${Number(v).toLocaleString("en-IN")}`
          }
        }
      }
    }
  });
}

function renderHourlyTrendChart(filteredSales) {
  const canvas = $("chart-hourly-trend");
  if (!canvas || typeof Chart === "undefined") return;
  destroyChart("hourlyTrend");

  // Hours 0 to 23
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const hourCups = new Array(24).fill(0);
  const hourRevenue = new Array(24).fill(0);

  filteredSales.forEach((s) => {
    if (s.time) {
      const h = parseInt(s.time.split(":")[0], 10);
      if (!isNaN(h) && h >= 0 && h < 24) {
        hourCups[h] += Number(s.quantity || 0);
        hourRevenue[h] += Number(s.total || 0);
      }
    }
  });

  // Filter labels to operating range 7 AM to 11 PM
  const range = hours.filter((h) => h >= 7 && h <= 23);
  const labels = range.map((h) => {
    const ampm = h >= 12 ? "PM" : "AM";
    const displayH = h % 12 === 0 ? 12 : h % 12;
    return `${displayH} ${ampm}`;
  });
  const dataCups = range.map((h) => hourCups[h]);
  const dataRevenue = range.map((h) => hourRevenue[h]);

  const ctx = canvas.getContext("2d");
  chartInstances.hourlyTrend = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: "Cups Sold by Hour",
        data: dataCups,
        borderColor: "#3D7A41",
        backgroundColor: "rgba(61, 122, 65, 0.12)",
        fill: true,
        tension: 0.35,
        pointRadius: 4,
        pointHoverRadius: 6,
        pointBackgroundColor: "#3D7A41",
        borderWidth: 2.5
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (context) => {
              const cups = context.raw || 0;
              const rev = dataRevenue[context.dataIndex] || 0;
              return ` ${cups} cups (${rupee(rev)})`;
            }
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { font: { family: "IBM Plex Mono", size: 10.5 } }
        },
        y: {
          beginAtZero: true,
          grid: { color: "rgba(0,0,0,0.05)" },
          ticks: { font: { family: "IBM Plex Mono", size: 10.5 } }
        }
      }
    }
  });
}

// ---------------------------------------------------------------------
// LEADERBOARD TABLE RENDERER
// ---------------------------------------------------------------------
function renderLeaderboardTable(items, totalCups, activeDays) {
  const tbody = $("leaderboard-tbody");
  if (!tbody) return;

  let list = [...items];

  // Search filter
  if (leaderboardSearch) {
    const q = leaderboardSearch.toLowerCase();
    list = list.filter((p) =>
      p.name.toLowerCase().includes(q) ||
      (p.category && p.category.toLowerCase().includes(q))
    );
  }

  // Sorting
  if (leaderboardSort === "cups-desc") {
    list.sort((a, b) => b.cups - a.cups || b.revenue - a.revenue);
  } else if (leaderboardSort === "revenue-desc") {
    list.sort((a, b) => b.revenue - a.revenue || b.cups - a.cups);
  } else if (leaderboardSort === "name-asc") {
    list.sort((a, b) => a.name.localeCompare(b.name));
  }

  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-state">No beverages match this leaderboard filter.</td></tr>';
    return;
  }

  tbody.innerHTML = "";
  list.forEach((item, idx) => {
    const tr = document.createElement("tr");

    // Rank Medal Badge
    let rankBadge = "";
    if (idx === 0) rankBadge = '<span class="rank-badge gold" title="Rank 1 Best Seller">1</span>';
    else if (idx === 1) rankBadge = '<span class="rank-badge silver" title="Rank 2">2</span>';
    else if (idx === 2) rankBadge = '<span class="rank-badge bronze" title="Rank 3">3</span>';
    else rankBadge = `<span class="rank-badge standard">${idx + 1}</span>`;

    const sharePct = totalCups > 0 ? Math.round((item.cups / totalCups) * 100) : 0;
    const avgDailyCups = activeDays > 0 ? (item.cups / activeDays).toFixed(1) : item.cups;

    tr.innerHTML = `
      <td>${rankBadge}</td>
      <td><strong>${escapeHtml(item.name)}</strong></td>
      <td><span class="pill">${escapeHtml(item.category || "Beverage")}</span></td>
      <td class="mono">${rupee(item.price)}</td>
      <td class="mono"><strong>${item.cups}</strong></td>
      <td>
        <div class="volume-bar-cell">
          <div class="mini-bar-track" title="${sharePct}% of total volume">
            <div class="mini-bar-fill" style="width: ${Math.min(100, Math.max(4, sharePct))}%;"></div>
          </div>
          <span class="mini-bar-pct">${sharePct}%</span>
        </div>
      </td>
      <td class="mono" style="color:var(--coral-deep); font-weight:700;">${rupee(item.revenue)}</td>
      <td class="mono">${avgDailyCups} / day</td>
    `;
    tbody.appendChild(tr);
  });
}

// ---------------------------------------------------------------------
// MONTH-WISE SALES PERFORMANCE REPORTS PANEL
// ---------------------------------------------------------------------
function renderMonthlyReports() {
  const tbody = $("monthly-report-tbody");
  if (!tbody) return;

  const monthMap = {};
  sales.forEach((s) => {
    if (!s.date || s.date.length < 7) return;
    const ym = s.date.substring(0, 7);
    if (!monthMap[ym]) {
      monthMap[ym] = {
        monthKey: ym,
        orders: 0,
        cups: 0,
        revenue: 0,
        itemMap: {},
        catMap: {}
      };
    }
    monthMap[ym].orders += 1;
    monthMap[ym].cups += Number(s.quantity || 0);
    monthMap[ym].revenue += Number(s.total || 0);

    const name = s.itemName || "Unknown";
    monthMap[ym].itemMap[name] = (monthMap[ym].itemMap[name] || 0) + Number(s.quantity || 0);

    const cat = s.category || "Beverage";
    monthMap[ym].catMap[cat] = (monthMap[ym].catMap[cat] || 0) + Number(s.total || 0);
  });

  const sortedMonths = Object.keys(monthMap).sort().reverse();

  if (!sortedMonths.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-state">No monthly sales data logged yet.</td></tr>';
    return;
  }

  let grandOrders = 0;
  let grandCups = 0;
  let grandRevenue = 0;

  tbody.innerHTML = "";
  sortedMonths.forEach((ym) => {
    const data = monthMap[ym];
    grandOrders += data.orders;
    grandCups += data.cups;
    grandRevenue += data.revenue;

    const aov = data.orders ? Math.round(data.revenue / data.orders) : 0;

    // Best seller of this month
    let bestName = "—", bestCups = 0;
    Object.entries(data.itemMap).forEach(([n, c]) => {
      if (c > bestCups) {
        bestName = n;
        bestCups = c;
      }
    });

    // Top category of this month
    let topCat = "—", topCatRev = 0;
    Object.entries(data.catMap).forEach(([cat, r]) => {
      if (r > topCatRev) {
        topCat = cat;
        topCatRev = r;
      }
    });

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>${formatMonthKey(ym)}</strong> <small class="field-hint">(${ym})</small></td>
      <td class="mono">${data.orders}</td>
      <td class="mono"><strong>${data.cups}</strong></td>
      <td class="mono" style="color:var(--coral-deep); font-weight:700;">${rupee(data.revenue)}</td>
      <td class="mono">${rupee(aov)}</td>
      <td><strong>${escapeHtml(bestName)}</strong> <small class="field-hint">(${bestCups} cups)</small></td>
      <td><span class="pill">${escapeHtml(topCat)}</span></td>
      <td>
        <button type="button" class="btn-drilldown-mini" data-month="${ym}">
          🔍 Inspect Analytics
        </button>
      </td>
    `;

    tr.querySelector(".btn-drilldown-mini").onclick = () => {
      drilldownToMonth(ym);
    };

    tbody.appendChild(tr);
  });

  // Footer totals
  if ($("monthly-foot-orders")) $("monthly-foot-orders").textContent = grandOrders.toLocaleString("en-IN");
  if ($("monthly-foot-cups")) $("monthly-foot-cups").textContent = grandCups.toLocaleString("en-IN");
  if ($("monthly-foot-revenue")) $("monthly-foot-revenue").textContent = rupee(grandRevenue);
  if ($("monthly-foot-aov")) {
    const grandAOV = grandOrders ? Math.round(grandRevenue / grandOrders) : 0;
    $("monthly-foot-aov").textContent = rupee(grandAOV);
  }
}

function drilldownToMonth(ym) {
  selectedAnalyticsPeriod = ym;
  const sel = $("analytics-month-select");
  if (sel) sel.value = ym;

  // Clear active quick pill
  document.querySelectorAll(".btn-period-pill").forEach((b) => b.classList.remove("active"));

  // Switch to Analytics subtab
  document.querySelectorAll(".subtab").forEach((b) => {
    b.classList.toggle("active", b.dataset.panel === "panel-analytics");
  });
  document.querySelectorAll(".admin-panel").forEach((p) => {
    p.classList.toggle("active", p.id === "panel-analytics");
  });

  renderAnalytics();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function exportMonthlyReportCSV() {
  const monthMap = {};
  sales.forEach((s) => {
    if (!s.date || s.date.length < 7) return;
    const ym = s.date.substring(0, 7);
    if (!monthMap[ym]) {
      monthMap[ym] = {
        monthKey: ym,
        orders: 0,
        cups: 0,
        revenue: 0,
        itemMap: {},
        catMap: {}
      };
    }
    monthMap[ym].orders += 1;
    monthMap[ym].cups += Number(s.quantity || 0);
    monthMap[ym].revenue += Number(s.total || 0);

    const name = s.itemName || "Unknown";
    monthMap[ym].itemMap[name] = (monthMap[ym].itemMap[name] || 0) + Number(s.quantity || 0);

    const cat = s.category || "Beverage";
    monthMap[ym].catMap[cat] = (monthMap[ym].catMap[cat] || 0) + Number(s.total || 0);
  });

  const sortedMonths = Object.keys(monthMap).sort().reverse();
  if (!sortedMonths.length) return alert("No monthly data available to export.");

  const header = ["Month Code", "Month Name", "Total Orders", "Total Cups Sold", "Total Revenue (INR)", "Avg Order Value (INR)", "Best Seller Item", "Best Seller Cups", "Top Category"];
  const rows = sortedMonths.map((ym) => {
    const data = monthMap[ym];
    const aov = data.orders ? Math.round(data.revenue / data.orders) : 0;
    let bestName = "", bestCups = 0;
    Object.entries(data.itemMap).forEach(([n, c]) => {
      if (c > bestCups) { bestName = n; bestCups = c; }
    });
    let topCat = "", topCatRev = 0;
    Object.entries(data.catMap).forEach(([cat, r]) => {
      if (r > topCatRev) { topCat = cat; topCatRev = r; }
    });
    return [
      ym, formatMonthKey(ym), data.orders, data.cups, data.revenue,
      aov, bestName, bestCups, topCat
    ];
  });

  const csvContent = [header, ...rows]
    .map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `hola-amigos-monthly-sales-report-${todayStr()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// =======================================================================
// ADMIN — SALES DASHBOARD
// =======================================================================
function renderCategoryFilterOptions() {
  const sel = $("filter-category");
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = '<option value="">All categories</option>';
  getCategories().forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c;
    sel.appendChild(opt);
  });
  sel.value = current;
}

function getFilteredSales() {
  const from = $("filter-from").value;
  const to = $("filter-to").value;
  const cat = $("filter-category").value;
  const search = $("filter-search").value.trim().toLowerCase();

  return sales.filter((s) => {
    if (from && s.date < from) return false;
    if (to && s.date > to) return false;
    if (cat && s.category !== cat) return false;
    if (search) {
      const matchName = s.itemName && s.itemName.toLowerCase().includes(search);
      const remarkVal = (s.remark || s.barista || "").toLowerCase();
      const matchRemark = remarkVal.includes(search);
      if (!matchName && !matchRemark) return false;
    }
    return true;
  });
}

function renderSalesTable() {
  const tbody = $("sales-tbody");
  if (!tbody) return;
  const filtered = getFilteredSales();

  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty-state">No sales match these filters.</td></tr>';
  } else {
    tbody.innerHTML = "";
    filtered.forEach((s) => {
      const tr = document.createElement("tr");
      const remarkText = s.remark || s.barista || "—";
      tr.innerHTML = `
        <td class="mono">${escapeHtml(s.date || "")}</td>
        <td class="mono">${escapeHtml(s.time || "")}</td>
        <td><strong>${escapeHtml(s.itemName)}</strong></td>
        <td>${escapeHtml(s.category || "")}</td>
        <td class="mono">${s.quantity}</td>
        <td class="mono">${rupee(s.price)}</td>
        <td class="mono"><strong>${rupee(s.total)}</strong></td>
        <td>${escapeHtml(remarkText)}</td>
        <td><button type="button" class="btn-danger-mini" data-id="${s.id}">Delete</button></td>
      `;
      tr.querySelector(".btn-danger-mini").onclick = () => deleteSale(s.id, s.itemName);
      tbody.appendChild(tr);
    });
  }

  const qtySum = filtered.reduce((s, x) => s + Number(x.quantity || 0), 0);
  const totalSum = filtered.reduce((s, x) => s + Number(x.total || 0), 0);
  $("foot-qty").textContent = qtySum;
  $("foot-total").textContent = rupee(totalSum);
}

async function deleteSale(id, name) {
  const pwd = prompt(`🔐 Enter Deletion Password (PIN) to delete sale (${name}):`);
  if (pwd === null) return; // User cancelled
  if (pwd.trim() !== DELETE_PASSWORD && pwd.trim() !== DEFAULT_ADMIN_PASSWORD) {
    alert("❌ Incorrect deletion password. Sale was NOT deleted.");
    return;
  }
  try {
    await deleteDoc(doc(db, "sales", id));
  } catch (e) {
    console.error(e);
    alert("Could not delete sale. Check Firestore connection.");
  }
}

function exportCSV() {
  const filtered = getFilteredSales();
  if (!filtered.length) return alert("No sales to export with the current filters.");

  const header = ["Date", "Time", "Item", "Category", "Quantity", "Price", "Total", "Remark"];
  const rows = filtered.map((s) => [
    s.date || "", s.time || "", s.itemName || "", s.category || "",
    s.quantity || 0, s.price || 0, s.total || 0, s.remark || s.barista || ""
  ]);

  const csvContent = [header, ...rows]
    .map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `hola-amigos-sales-${todayStr()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// =======================================================================
// ADMIN — MANAGE PRODUCTS & PRICES (Firestore only)
// =======================================================================
function renderCategoryDatalist() {
  const dl = $("category-datalist");
  if (!dl) return;
  dl.innerHTML = "";
  getCategories().forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c;
    dl.appendChild(opt);
  });
}

function renderProductsTable() {
  const tbody = $("products-tbody");
  const countBadge = $("product-count-badge");
  if (!tbody) return;

  let list = products;
  if (adminProductSearch) {
    const q = adminProductSearch.toLowerCase();
    list = list.filter((p) =>
      (p.name && p.name.toLowerCase().includes(q)) ||
      (p.category && p.category.toLowerCase().includes(q))
    );
  }

  if (countBadge) countBadge.textContent = products.length;

  if (!products.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty-state">No products in the database yet. Add one above or click "Import Full Default Menu".</td></tr>';
    return;
  }

  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty-state">No products match your search.</td></tr>';
    return;
  }

  tbody.innerHTML = "";
  list.forEach((p) => {
    const tr = document.createElement("tr");

    if (editingProductId === p.id) {
      tr.innerHTML = `
        <td><input type="text" class="edit-name" value="${escapeHtml(p.name)}" style="width:100%; padding:6px; border:1.5px solid var(--coral); border-radius:6px;" maxlength="80" /></td>
        <td><input type="text" class="edit-category" value="${escapeHtml(p.category || "")}" style="width:100%; padding:6px; border:1.5px solid var(--coral); border-radius:6px;" list="category-datalist" maxlength="60" /></td>
        <td><input type="number" class="edit-price" value="${p.price}" min="1" step="1" style="width:90px; padding:6px; border:1.5px solid var(--coral); border-radius:6px;" /></td>
        <td>
          <button type="button" class="btn-edit-mini save-edit">Save</button>
          <button type="button" class="btn-danger-mini cancel-edit">Cancel</button>
        </td>
      `;
      tr.querySelector(".save-edit").onclick = () => saveProductEdit(p.id, tr);
      tr.querySelector(".cancel-edit").onclick = () => {
        editingProductId = null;
        renderProductsTable();
      };
    } else {
      tr.innerHTML = `
        <td><strong>${escapeHtml(p.name)}</strong></td>
        <td><span class="pill">${escapeHtml(p.category || "Uncategorized")}</span></td>
        <td class="mono"><strong>${rupee(p.price)}</strong></td>
        <td>
          <button type="button" class="btn-edit-mini edit-btn">Edit</button>
          <button type="button" class="btn-danger-mini delete-btn">Delete</button>
        </td>
      `;
      tr.querySelector(".edit-btn").onclick = () => {
        editingProductId = p.id;
        renderProductsTable();
      };
      tr.querySelector(".delete-btn").onclick = () => deleteProduct(p.id, p.name);
    }
    tbody.appendChild(tr);
  });
}

// Add new product to Firestore
async function addProduct(e) {
  e.preventDefault();
  const msg = $("product-msg");
  const name = sanitizeText($("new-product-name").value);
  const category = sanitizeText($("new-product-category").value);
  const price = Math.floor(Number($("new-product-price").value) || 0);

  if (!name || !category || !price || price <= 0) {
    return flashMsg(msg, "Please fill in all fields with a valid price.", false);
  }

  try {
    await addDoc(collection(db, "products"), {
      name, category, price, createdAt: serverTimestamp()
    });
    flashMsg(msg, `✅ Added "${name}" (${rupee(price)}) to Firestore.`, true);
    e.target.reset();
  } catch (err) {
    console.error("Add product error:", err);
    flashMsg(msg, "Could not add product. Check Firestore connection.", false);
  }
}

// Edit product in Firestore
async function saveProductEdit(id, tr) {
  const name = sanitizeText(tr.querySelector(".edit-name").value);
  const category = sanitizeText(tr.querySelector(".edit-category").value);
  const price = Math.floor(Number(tr.querySelector(".edit-price").value) || 0);

  if (!name || !category || !price || price <= 0) {
    return alert("Please enter a valid name, category, and price.");
  }

  try {
    await updateDoc(doc(db, "products", id), { name, category, price });
    editingProductId = null;
  } catch (e) {
    console.error("Save product edit error:", e);
    alert("Could not update product. Check Firestore connection.");
  }
}

// Delete product from Firestore
async function deleteProduct(id, name) {
  const pwd = prompt(`🔐 Enter Deletion Password (PIN) to remove "${name}" from menu:`);
  if (pwd === null) return; // User cancelled
  if (pwd.trim() !== DELETE_PASSWORD && pwd.trim() !== DEFAULT_ADMIN_PASSWORD) {
    alert("❌ Incorrect deletion password. Product was NOT deleted.");
    return;
  }
  try {
    await deleteDoc(doc(db, "products", id));
  } catch (e) {
    console.error("Delete product error:", e);
    alert("Could not delete product. Check Firestore connection.");
  }
}

// Seed default menu into Firestore
async function seedDefaultMenu() {
  const msg = $("seed-msg");
  if (!confirm(`Import all ${DEFAULT_MENU.length} default menu items and prices into Firestore?`)) return;

  flashMsg(msg, "Importing menu into Firestore…", true);

  try {
    const batch = writeBatch(db);
    DEFAULT_MENU.forEach((item) => {
      const ref = doc(collection(db, "products"));
      batch.set(ref, {
        name: sanitizeText(item.name),
        category: sanitizeText(item.category),
        price: Number(item.price) || 0,
        createdAt: serverTimestamp()
      });
    });
    await batch.commit();
    flashMsg(msg, `🎉 Successfully imported ${DEFAULT_MENU.length} items to Firestore!`, true);
  } catch (e) {
    console.error("Menu seeding error:", e);
    flashMsg(msg, "Import failed. Check Firestore security rules.", false);
  }
}

// =======================================================================
// ADMIN — CHANGE PASSWORD (Firestore only)
// =======================================================================
async function changePassword(e) {
  e.preventDefault();
  const msg = $("password-msg");
  const val = $("new-admin-password").value.trim();

  if (val.length < 4) {
    return flashMsg(msg, "Password must be at least 4 characters.", false);
  }

  try {
    await setDoc(doc(db, "settings", "admin"), {
      password: val, updatedAt: serverTimestamp()
    }, { merge: true });
    flashMsg(msg, "✅ Admin password successfully updated in Firestore.", true);
    e.target.reset();
  } catch (err) {
    console.error("Password update error:", err);
    flashMsg(msg, "Could not update password. Check Firestore connection.", false);
  }
}

// =======================================================================
// EVENT LISTENERS & SETUP
// =======================================================================
function setupTabs() {
  $("tab-entry").onclick = () => switchTab("entry");
  $("tab-admin").onclick = () => switchTab("admin");
}

function switchTab(which) {
  const entry = which === "entry";
  $("tab-entry").classList.toggle("active", entry);
  $("tab-admin").classList.toggle("active", !entry);
  $("tab-entry").setAttribute("aria-selected", entry);
  $("tab-admin").setAttribute("aria-selected", !entry);
  $("view-entry").classList.toggle("active", entry);
  $("view-admin").classList.toggle("active", !entry);
}

function setupSubtabs() {
  document.querySelectorAll(".subtab").forEach((btn) => {
    btn.onclick = () => {
      document.querySelectorAll(".subtab").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".admin-panel").forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      const targetPanel = $(btn.dataset.panel);
      if (targetPanel) targetPanel.classList.add("active");

      if (btn.dataset.panel === "panel-analytics") {
        renderAnalytics();
      } else if (btn.dataset.panel === "panel-monthly-reports") {
        renderMonthlyReports();
      } else if (btn.dataset.panel === "panel-sales") {
        renderSalesTable();
      } else if (btn.dataset.panel === "panel-products") {
        renderProductsTable();
      }
    };
  });
}

function setupEntryForm() {
  // Set the date field to today by default
  $("input-date").value = todayStr();

  // Quick 1st Coffee / 2nd Bakery / 3rd Combo Pill Buttons
  document.querySelectorAll(".btn-type-pill").forEach((btn) => {
    btn.onclick = () => {
      document.querySelectorAll(".btn-type-pill").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const cat = btn.dataset.cat;
      if ($("select-ticket-category")) $("select-ticket-category").value = cat;
      if ($("ticket-selected-cat")) $("ticket-selected-cat").textContent = cat;

      const currentName = $("input-item-name") ? $("input-item-name").value.trim() : "";
      if (!currentName && $("selected-item-name")) {
        $("selected-item-name").textContent = `${cat} Entry`;
      }
    };
  });

  // Custom Item Name Typing
  const nameInput = $("input-item-name");
  if (nameInput) {
    nameInput.addEventListener("input", (e) => {
      const val = e.target.value.trim();
      if ($("selected-item-name")) {
        $("selected-item-name").textContent = val || "New Order Entry";
      }

      // If typed name matches a product in the database, auto-fill price if price is blank
      const match = products.find((p) => p.name && p.name.toLowerCase() === val.toLowerCase());
      if (match) {
        selectedProduct = match;
        if (!$("input-price").value || Number($("input-price").value) === 0) {
          $("input-price").value = match.price;
          updateTicketTotal();
        }
        if ($("select-ticket-category")) $("select-ticket-category").value = match.category || "Coffee";
        if ($("ticket-selected-cat")) $("ticket-selected-cat").textContent = match.category || "Coffee";
        document.querySelectorAll(".btn-type-pill").forEach((btn) => {
          btn.classList.toggle("active", btn.dataset.cat === match.category);
        });
      }
    });
  }

  // Category dropdown selector
  const catSelect = $("select-ticket-category");
  if (catSelect) {
    catSelect.addEventListener("change", (e) => {
      const cat = e.target.value;
      if ($("ticket-selected-cat")) $("ticket-selected-cat").textContent = cat;
      document.querySelectorAll(".btn-type-pill").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.cat === cat);
      });
    });
  }

  // Dropdown selection automatically selects item and populates price
  $("select-item").onchange = (e) => {
    const p = products.find((x) => x.id === e.target.value);
    if (p) selectProduct(p);
  };

  // Search input in Today's Menu
  $("menu-search").addEventListener("input", (e) => {
    searchQuery = e.target.value.trim();
    renderItemGrid();
  });

  // Price & quantity input live recalculations
  $("input-price").addEventListener("input", updateTicketTotal);
  $("input-qty").addEventListener("input", updateTicketTotal);

  // Stepper buttons
  $("qty-minus").onclick = () => {
    const el = $("input-qty");
    el.value = Math.max(1, (Number(el.value) || 1) - 1);
    updateTicketTotal();
  };
  $("qty-plus").onclick = () => {
    const el = $("input-qty");
    el.value = (Number(el.value) || 1) + 1;
    updateTicketTotal();
  };

  // Preset +1, +2, +5 buttons
  document.querySelectorAll(".btn-qty-preset").forEach((btn) => {
    btn.onclick = () => {
      const addVal = Number(btn.dataset.qty) || 1;
      const el = $("input-qty");
      el.value = (Number(el.value) || 0) + addVal;
      updateTicketTotal();
    };
  });

  $("btn-add-sale").onclick = addSale;
}

function setupAdmin() {
  $("btn-admin-login").onclick = attemptAdminLogin;
  $("admin-password").addEventListener("keydown", (e) => {
    if (e.key === "Enter") attemptAdminLogin();
  });
  $("btn-logout").onclick = adminLogout;
  $("form-add-product").addEventListener("submit", addProduct);
  $("btn-seed-menu").onclick = seedDefaultMenu;
  $("form-change-password").addEventListener("submit", changePassword);

  // Password visibility toggle buttons
  const togglePwd = $("btn-toggle-pwd");
  if (togglePwd) {
    togglePwd.onclick = () => {
      const inp = $("admin-password");
      if (inp.type === "password") {
        inp.type = "text";
        togglePwd.textContent = "🙈";
      } else {
        inp.type = "password";
        togglePwd.textContent = "👁️";
      }
    };
  }

  const toggleNewPwd = $("btn-toggle-new-pwd");
  if (toggleNewPwd) {
    toggleNewPwd.onclick = () => {
      const inp = $("new-admin-password");
      if (inp.type === "password") {
        inp.type = "text";
        toggleNewPwd.textContent = "🙈";
      } else {
        inp.type = "password";
        toggleNewPwd.textContent = "👁️";
      }
    };
  }

  // ── Analytics & Month Selection Controls ──
  const monthSelect = $("analytics-month-select");
  if (monthSelect) {
    monthSelect.addEventListener("change", (e) => {
      selectedAnalyticsPeriod = e.target.value;
      if ($("analytics-month-picker")) {
        $("analytics-month-picker").value = selectedAnalyticsPeriod !== "ALL" && /^\d{4}-\d{2}$/.test(selectedAnalyticsPeriod) ? selectedAnalyticsPeriod : "";
      }
      document.querySelectorAll(".btn-period-pill").forEach((b) => {
        b.classList.toggle("active", b.dataset.period === selectedAnalyticsPeriod);
      });
      renderAnalytics();
    });
  }

  const monthPicker = $("analytics-month-picker");
  if (monthPicker) {
    monthPicker.addEventListener("change", (e) => {
      if (e.target.value) {
        selectedAnalyticsPeriod = e.target.value;
        if (monthSelect) monthSelect.value = selectedAnalyticsPeriod;
        document.querySelectorAll(".btn-period-pill").forEach((b) => b.classList.remove("active"));
        renderAnalytics();
      }
    });
  }

  document.querySelectorAll(".btn-period-pill").forEach((btn) => {
    btn.onclick = () => {
      document.querySelectorAll(".btn-period-pill").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      selectedAnalyticsPeriod = btn.dataset.period;
      if (monthSelect) monthSelect.value = selectedAnalyticsPeriod;
      if (monthPicker) monthPicker.value = "";
      renderAnalytics();
    };
  });

  const lbSearch = $("leaderboard-search");
  if (lbSearch) {
    lbSearch.addEventListener("input", (e) => {
      leaderboardSearch = e.target.value.trim();
      renderAnalytics();
    });
  }

  const lbSort = $("leaderboard-sort");
  if (lbSort) {
    lbSort.addEventListener("change", (e) => {
      leaderboardSort = e.target.value;
      renderAnalytics();
    });
  }

  const btnMonthlyCSV = $("btn-export-monthly-csv");
  if (btnMonthlyCSV) {
    btnMonthlyCSV.onclick = exportMonthlyReportCSV;
  }

  // ── Product Search & Sales Filters ──
  $("admin-product-search").addEventListener("input", (e) => {
    adminProductSearch = e.target.value.trim();
    renderProductsTable();
  });

  ["filter-from", "filter-to", "filter-category"].forEach((id) => {
    $(id).addEventListener("change", renderSalesTable);
  });
  $("filter-search").addEventListener("input", renderSalesTable);
  $("btn-clear-filters").onclick = () => {
    $("filter-from").value = "";
    $("filter-to").value = "";
    $("filter-category").value = "";
    $("filter-search").value = "";
    renderSalesTable();
  };
  $("btn-export-csv").onclick = exportCSV;
}

// ---------------------------------------------------------------------
// App Initialization — Firestore only
// ---------------------------------------------------------------------
async function init() {
  // 1. Setup user gate first (blocks UI until user password is entered)
  setupUserGate();

  // 2. Setup the rest of the UI
  setupTabs();
  setupSubtabs();
  setupEntryForm();
  setupAdmin();

  // 3. Restore admin session if previously logged in
  if (sessionStorage.getItem(AUTH_SESSION_KEY) === "true") {
    showAdminDashboard();
  }

  // 4. Connect to Firestore and ensure both settings docs exist
  await Promise.all([ensureAdminDoc(), ensureUserDoc()]);
  listenProducts();
  listenSales();
}

init();
