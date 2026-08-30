// seed-data.js
// ---------------------------------------------------------------------------
// One-time menu import for Hola Amigos Cafe (Devka Beach Resort).
// This is the ONLY place the menu is listed as a flat array — it is used
// exclusively by the "Import Default Menu" button in the Admin panel to
// bulk-write products into Firestore. Every other screen in the app
// (the barista Order Entry screen, dropdowns, dashboards, etc.) reads the
// live product list back OUT of Firestore — nothing is hard-coded there.
// ---------------------------------------------------------------------------

export const DEFAULT_MENU = [
  // --- Specialty Coffee ---
  { name: "Espresso", category: "Specialty Coffee", price: 100 },
  { name: "Americano", category: "Specialty Coffee", price: 100 },
  { name: "Cappuccino", category: "Specialty Coffee", price: 150 },
  { name: "Café Latte", category: "Specialty Coffee", price: 150 },
  { name: "Café Mocha", category: "Specialty Coffee", price: 170 },
  { name: "Flat White", category: "Specialty Coffee", price: 170 },
  { name: "Cortado", category: "Specialty Coffee", price: 150 },
  { name: "Macchiato", category: "Specialty Coffee", price: 110 },
  { name: "Affogato", category: "Specialty Coffee", price: 190 },
  { name: "Vietnamese Coffee", category: "Specialty Coffee", price: 220 },

  // --- Flavoured Specialty Coffee ---
  { name: "Caramel Cappuccino", category: "Flavoured Specialty Coffee", price: 250 },
  { name: "Caramel Latte", category: "Flavoured Specialty Coffee", price: 250 },
  { name: "Caramel Flat White", category: "Flavoured Specialty Coffee", price: 250 },
  { name: "Vanilla Cappuccino", category: "Flavoured Specialty Coffee", price: 250 },
  { name: "Vanilla Latte (Flat White)", category: "Flavoured Specialty Coffee", price: 250 },
  { name: "Hazelnut Cappuccino", category: "Flavoured Specialty Coffee", price: 250 },
  { name: "Hazelnut Latte", category: "Flavoured Specialty Coffee", price: 250 },
  { name: "Hazelnut Flat White", category: "Flavoured Specialty Coffee", price: 250 },
  { name: "Affogato (Flavoured)", category: "Flavoured Specialty Coffee", price: 250 },

  // --- Cold Coffee ---
  { name: "Iced Americano", category: "Cold Coffee", price: 150 },
  { name: "Iced Cappuccino", category: "Cold Coffee", price: 200 },
  { name: "Iced Latte", category: "Cold Coffee", price: 200 },
  { name: "Iced Mocha", category: "Cold Coffee", price: 230 },
  { name: "Vietnamese Coffee (Iced)", category: "Cold Coffee", price: 260 },
  { name: "Cold Coffee (Large Glass)", category: "Cold Coffee", price: 400 },

  // --- Milkshakes ---
  { name: "Chocolate Milk Shake", category: "Milkshakes", price: 250 },
  { name: "Vanilla Milk Shake", category: "Milkshakes", price: 250 },
  { name: "Brownie Milk Shake", category: "Milkshakes", price: 250 },
  { name: "Strawberry Milk Shake", category: "Milkshakes", price: 250 },
  { name: "Blueberry Milk Shake", category: "Milkshakes", price: 250 },
  { name: "Cold Coffee (Milkshake Style)", category: "Milkshakes", price: 250 },

  // --- Ice Tea (Soda & Water variants) ---
  { name: "Peach Ice Tea (Soda)", category: "Ice Tea", price: 250 },
  { name: "Peach Ice Tea (Water)", category: "Ice Tea", price: 200 },
  { name: "Blueberry Ice Tea (Soda)", category: "Ice Tea", price: 250 },
  { name: "Blueberry Ice Tea (Water)", category: "Ice Tea", price: 200 },
  { name: "Lime Ice Tea (Soda)", category: "Ice Tea", price: 250 },
  { name: "Lime Ice Tea (Water)", category: "Ice Tea", price: 200 },
  { name: "Ginger Ice Tea (Soda)", category: "Ice Tea", price: 250 },
  { name: "Ginger Ice Tea (Water)", category: "Ice Tea", price: 200 },
  { name: "Lemon Ice Tea (Soda)", category: "Ice Tea", price: 250 },
  { name: "Lemon Ice Tea (Water)", category: "Ice Tea", price: 200 },
  { name: "Green Apple Ice Tea (Soda)", category: "Ice Tea", price: 250 },
  { name: "Green Apple Ice Tea (Water)", category: "Ice Tea", price: 200 },
];

export const CATEGORY_ORDER = [
  "Specialty Coffee",
  "Flavoured Specialty Coffee",
  "Cold Coffee",
  "Milkshakes",
  "Ice Tea",
];

export const CATEGORY_ICONS = {
  "Specialty Coffee": "☕",
  "Flavoured Specialty Coffee": "✨",
  "Cold Coffee": "🧊",
  "Milkshakes": "🥤",
  "Ice Tea": "🍑",
};
