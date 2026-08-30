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
    renderStats();
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
  select.innerHTML = '<option value="">— choose an item —</option>';
  products.forEach((p) => {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = `${p.name} (${p.category || "Beverage"}) — ${rupee(p.price)}`;
    select.appendChild(opt);
  });

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

  $("select-item").value = p.id;
  $("selected-item-name").textContent = p.name;
  $("ticket-selected-cat").textContent = p.category || "Beverage";

  // Automatically fill the price from the database
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
    row.innerHTML = `
      <div>
        <div class="li-name">${escapeHtml(s.itemName)}</div>
        <div class="li-meta">Qty ${s.quantity} · ${rupee(s.price)} each${s.barista ? " · " + escapeHtml(s.barista) : ""} · ${s.time || ""}</div>
      </div>
      <div class="li-amt">${rupee(s.total)}</div>
    `;
    list.appendChild(row);
  });

  const revenue = todays.reduce((sum, s) => sum + Number(s.total || 0), 0);
  const totalCups = todays.reduce((sum, s) => sum + Number(s.quantity || 0), 0);
  $("today-summary").innerHTML = `
    <span>${totalCups} cup${totalCups === 1 ? "" : "s"} today</span>
    <span>${rupee(revenue)}</span>
  `;
}

// Add sale — writes directly to Firestore
async function addSale() {
  const msg = $("entry-msg");
  const select = $("select-item");
  const productId = select.value;
  const product = products.find((p) => p.id === productId) || selectedProduct;
  const saleDate = $("input-date").value;
  const price = Math.max(0, Number($("input-price").value) || 0);
  const qty = Math.max(1, Math.floor(Number($("input-qty").value) || 1));
  const barista = sanitizeText($("input-barista").value);

  if (!product) return flashMsg(msg, "Please select an item first.", false);
  if (!saleDate) return flashMsg(msg, "Please select a date.", false);
  if (!price || price <= 0) return flashMsg(msg, "Please enter a valid price.", false);

  try {
    await addDoc(collection(db, "sales"), {
      itemName: sanitizeText(product.name),
      category: sanitizeText(product.category || "Beverage"),
      productId: product.id,
      price,
      quantity: qty,
      total: price * qty,
      date: saleDate,
      time: pad(new Date().getHours()) + ":" + pad(new Date().getMinutes()),
      barista: barista || null,
      createdAt: serverTimestamp()
    });

    flashMsg(msg, `✅ Logged ${qty} × ${product.name} — ${rupee(price * qty)}`, true);

    // ── Full reset for next entry ──
    selectedProduct = null;
    $("select-item").value = "";
    $("selected-item-name").textContent = "Pick an item";
    $("ticket-selected-cat").textContent = "Select Item";
    $("input-price").value = "";
    $("input-qty").value = 1;
    $("input-barista").value = "";
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

  renderStats();
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
// ADMIN — STATS
// =======================================================================
function renderStats() {
  const today = todayStr();
  const todays = sales.filter((s) => s.date === today);
  const revenueToday = todays.reduce((s, x) => s + Number(x.total || 0), 0);
  const qtyToday = todays.reduce((s, x) => s + Number(x.quantity || 0), 0);
  const revenueTotal = sales.reduce((s, x) => s + Number(x.total || 0), 0);

  const byItem = {};
  sales.forEach((s) => {
    byItem[s.itemName] = (byItem[s.itemName] || 0) + Number(s.quantity || 0);
  });
  let best = "—", bestQty = 0;
  Object.entries(byItem).forEach(([name, qty]) => {
    if (qty > bestQty) {
      best = name;
      bestQty = qty;
    }
  });

  $("stat-revenue-today").textContent = rupee(revenueToday);
  $("stat-qty-today").textContent = qtyToday;
  $("stat-revenue-total").textContent = rupee(revenueTotal);
  $("stat-best-seller").textContent = bestQty ? `${best} (${bestQty})` : "—";
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
      const matchBarista = s.barista && s.barista.toLowerCase().includes(search);
      if (!matchName && !matchBarista) return false;
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
      tr.innerHTML = `
        <td class="mono">${escapeHtml(s.date || "")}</td>
        <td class="mono">${escapeHtml(s.time || "")}</td>
        <td><strong>${escapeHtml(s.itemName)}</strong></td>
        <td>${escapeHtml(s.category || "")}</td>
        <td class="mono">${s.quantity}</td>
        <td class="mono">${rupee(s.price)}</td>
        <td class="mono"><strong>${rupee(s.total)}</strong></td>
        <td>${escapeHtml(s.barista || "—")}</td>
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
  if (!confirm(`Delete this sale record (${name})? This cannot be undone.`)) return;
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

  const header = ["Date", "Time", "Item", "Category", "Quantity", "Price", "Total", "Barista"];
  const rows = filtered.map((s) => [
    s.date || "", s.time || "", s.itemName || "", s.category || "",
    s.quantity || 0, s.price || 0, s.total || 0, s.barista || ""
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
  if (!confirm(`Remove "${name}" from the database menu?`)) return;
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
    };
  });
}

function setupEntryForm() {
  // Set the date field to today by default
  $("input-date").value = todayStr();

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
