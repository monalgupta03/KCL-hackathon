// Groceries load from FastAPI; leftovers are stored on this browser.
var FRIDGE = [];

var INVENTORY_STORAGE_KEY = "fridgeflow.inventory";
var DEMO_LEFTOVER_ID = "demo-leftover-pasta-v1";
var LEFTOVER_ATTENTION_HOURS = { fridge: 48, freezer: 720, pantry: 24 };
var inventoryLoadedFromStorage = false;

(function loadSavedInventory() {
  try {
    var savedInventory = localStorage.getItem(INVENTORY_STORAGE_KEY);
    if (savedInventory !== null) {
      var parsedInventory = JSON.parse(savedInventory);
      if (Array.isArray(parsedInventory)) {
        FRIDGE = parsedInventory;
        inventoryLoadedFromStorage = true;
      }
    }

    var savedLeftovers = localStorage.getItem("fridgeflow.leftovers");
    var parsedLeftovers = savedLeftovers ? JSON.parse(savedLeftovers) : [];
    if (Array.isArray(parsedLeftovers)) {
      parsedLeftovers.forEach(function (leftover, index) {
        var migrated = Object.assign({}, leftover, {
          id: leftover.id || "migrated-leftover-" + index,
          category: "leftover",
          location: leftover.location || leftover.storage || "",
          freshnessSource: leftover.useByDate ? "user-provided" : "unknown"
        });
        var alreadyPresent = FRIDGE.some(function (item) {
          return item.id === migrated.id || (item.category === "leftover" && item.name.toLowerCase() === migrated.name.toLowerCase());
        });
        if (!alreadyPresent) FRIDGE.push(migrated);
      });
    }
  } catch (error) {
    inventoryLoadedFromStorage = false;
  }
}());

function saveInventory() {
  try {
    localStorage.setItem(INVENTORY_STORAGE_KEY, JSON.stringify(FRIDGE));
    localStorage.removeItem("fridgeflow.leftovers");
    return true;
  } catch (error) {
    console.warn("Could not save inventory in this browser.");
    return false;
  }
}

function initializeDemoLeftover() {
  if (typeof USE_MOCK !== "undefined" && !USE_MOCK) return;
  try {
    if (localStorage.getItem("fridgeflow.demo-leftover-seeded") === "true") return;
    var existingDemo = FRIDGE.some(function (item) { return item.id === DEMO_LEFTOVER_ID; });
    if (!existingDemo) {
      var existingPasta = FRIDGE.some(function (item) {
        return item.name.toLowerCase() === "pasta";
      });
      if (!existingPasta) {
        FRIDGE.push({
          id: DEMO_LEFTOVER_ID,
          name: "Pasta",
          qty: 1,
          unit: "serving",
          category: "leftover",
          preparedAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
          location: "fridge",
          freshnessSource: "estimated"
        });
      }
    }
    localStorage.setItem("fridgeflow.demo-leftover-seeded", "true");
    saveInventory();
  } catch (error) {
    if (!FRIDGE.some(function (item) { return item.id === DEMO_LEFTOVER_ID; }) &&
        !FRIDGE.some(function (item) { return item.name.toLowerCase() === "pasta"; })) {
      FRIDGE.push({
        id: DEMO_LEFTOVER_ID,
        name: "Pasta",
        qty: 1,
        unit: "serving",
        category: "leftover",
        preparedAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
        location: "fridge",
        freshnessSource: "estimated"
      });
    }
  }
}

var EVENTS = [];

var RECIPES = [
  { name: "Spinach and egg toast",     minutes: 12, needs: { spinach: 1, eggs: 2, bread: 2 } },
  { name: "Tomato on toast",           minutes: 5,  needs: { tomato: 1, bread: 2 } },
  { name: "Tomato cheese omelette",    minutes: 10, needs: { tomato: 1, eggs: 2, cheese: 1 } },
  { name: "Cheese and tomato toastie", minutes: 8,  needs: { cheese: 1, tomato: 1, bread: 2 } },
  { name: "Spinach omelette",          minutes: 10, needs: { spinach: 1, eggs: 2 } }
];
