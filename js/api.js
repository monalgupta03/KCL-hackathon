// Every screen gets its data from here.
// Groceries and meals use FastAPI; leftovers are explicitly browser-local.
var USE_MOCK = false;
var USE_BACKEND_INVENTORY = true;
var inventoryRequest = null;
var inventoryGeneration = 0;
var API_URL = "http://127.0.0.1:8000";

// Bound network waits and turn validation/network failures into useful messages.
async function apiFetch(url, options, timeoutMs) {
  if (typeof AbortController === "undefined") return fetch(url, options);
  var controller = new AbortController();
  var timer = setTimeout(function () { controller.abort(); }, timeoutMs || 15000);
  try {
    return await fetch(url, Object.assign({}, options || {}, { signal: controller.signal }));
  } catch (error) {
    throw new Error(error.name === "AbortError" ? "This is taking too long. Please try again." : "Cannot connect. Check that the app server is running.");
  } finally {
    clearTimeout(timer);
  }
}

async function inventoryResponse(response) {
  var result;
  try { result = await response.json(); }
  catch (error) { throw new Error("The server could not complete this request. Please try again."); }
  if (!response.ok) {
    var detail = result.detail;
    if (Array.isArray(detail)) detail = "Please check your inputs: " + detail.map(function (entry) { return entry.msg; }).join("; ");
    throw new Error(typeof detail === "string" ? detail : "This request could not be completed. Please try again.");
  }
  return result;
}

async function inventoryMutation(url, options) {
  var result = await inventoryResponse(await apiFetch(url, options));
  inventoryGeneration++;
  inventoryRequest = null;
  return result;
}

var api = {
  getInventory: async function () {
    if (!USE_BACKEND_INVENTORY) return FRIDGE;
    if (inventoryRequest) return inventoryRequest;
    var generation = inventoryGeneration;
    var request = inventoryRequest = (async function () {
      var result = await inventoryResponse(await apiFetch(API_URL + "/inventory"));
      var items = result.map(function (item) {
        return {
          id: String(item.id),
          name: item.name,
          qty: Number(item.quantity),
          unit: item.unit || "",
          expiryDate: item.expiry_date || "",
          expiryDateSource: item.expiry_date_source || "unknown",
          expiryDateConfirmed: Boolean(item.expiry_date_confirmed),
          category: "grocery"
        };
      });
      var localLeftovers = FRIDGE.filter(function (item) { return item.category === "leftover"; });
      if (generation !== inventoryGeneration) return api.getInventory();
      FRIDGE = items.concat(localLeftovers);
      return FRIDGE;
    }());
    try { return await request; }
    finally { if (inventoryRequest === request) inventoryRequest = null; }
  },

  getEvents: async function () {
    return EVENTS;
  },

  estimateExpiry: async function (name) {
    try {
      return await inventoryResponse(await apiFetch(API_URL + "/inventory/estimate-expiry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name })
      }));
    } catch (error) {
      return { expiry_date: null, expiry_date_source: "unknown" };
    }
  },

  scan: async function (name, qty, unit, expiryDate, expiryDateSource, expiryDateConfirmed) {
    if (!USE_BACKEND_INVENTORY) {
      var found = FRIDGE.find(function (i) { return i.name === name && i.category !== "leftover"; });
      if (found) found.qty += qty;
      else {
        found = { name: name, qty: qty, unit: unit || "", days: 5 };
        FRIDGE.push(found);
      }
      if (found && unit) found.unit = unit;
      if (found) {
        found.expiryDate = expiryDate || "";
        found.expiryDateSource = expiryDateSource || "unknown";
        found.expiryDateConfirmed = Boolean(expiryDateConfirmed);
      }
      EVENTS.unshift("Added: " + qty + " " + name);
      saveInventory();
      return { ok: true };
    }
    return inventoryMutation(API_URL + "/inventory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name,
        quantity: qty,
        unit: unit || "",
        expiry_date: expiryDate || null,
        expiry_date_source: expiryDateSource || "unknown",
        expiry_date_confirmed: Boolean(expiryDateConfirmed)
      })
    });
  },

  editGrocery: async function (id, item) {
    return inventoryMutation(API_URL + "/inventory/" + encodeURIComponent(id), {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(item)
    });
  },

  markEaten: async function (id) {
    return inventoryMutation(API_URL + "/inventory/" + encodeURIComponent(id) + "/eaten", {
      method: "POST"
    });
  },

  confirmExpiry: async function (id, expiryDate) {
    return inventoryMutation(API_URL + "/inventory/" + encodeURIComponent(id) + "/expiry", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expiry_date: expiryDate })
    });
  },

  addInventoryItem: async function (item) {
    var previous = FRIDGE.map(function (entry) { return Object.assign({}, entry); });
    var found = item.id && FRIDGE.find(function (entry) { return entry.category === "leftover" && entry.id === item.id; });
    if (!found) {
      found = FRIDGE.find(function (entry) { return entry.category === "leftover" && entry.name.toLowerCase() === item.name.toLowerCase(); });
    }
    if (found) {
      Object.assign(found, item, { id: found.id || item.id });
    } else {
      FRIDGE.push(item);
    }
    if (!saveInventory()) {
      FRIDGE = previous;
      return { ok: false, message: "Browser storage is unavailable. This leftover was not saved." };
    }
    return { ok: true, item: found || item };
  },

  recommend: async function (minutes, rejectedMeals, dietaryRestrictions) {
    var result = await inventoryResponse(await apiFetch(API_URL + "/meals/recommend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ minutes: minutes, rejected_meals: rejectedMeals || [], dietary_restrictions: dietaryRestrictions || [] })
    }));
    if (!result || !Array.isArray(result.recipes)) {
      throw new Error("Meal recommendations returned an unusable response.");
    }
    var recipes = result.recipes.map(function (recipe) {
      return {
        source: result.source || "gemini",
        name: recipe.title,
        minutes: recipe.cooking_time_minutes,
        ingredients: recipe.ingredients,
        steps: recipe.instructions,
        reason: recipe.expiry_priority_reasoning,
        missingIngredients: recipe.missing_ingredients || [],
        needs: recipe.ingredients.reduce(function (needs, ingredient) {
          needs[ingredient.name] = ingredient.quantity;
          return needs;
        }, {})
      };
    });
    recipes.notice = result.notice || "";
    recipes.source = result.source || "gemini";
    return recipes;
  },

  cook: async function () {
    throw new Error("Use Edit or Mark as Eaten in your pantry to update ingredients after cooking.");
  }

};

// Simple and explainable: keep recipes you can fully make in the time you have,
// then rank by how much they use up food that is about to expire.
function scoreRecipes(minutes) {
  var results = [];
  RECIPES.forEach(function (r) {
    if (r.minutes > minutes) return;
    var possible = true, score = 0, urgent = null;
    Object.keys(r.needs).forEach(function (item) {
      var f = FRIDGE.find(function (i) { return i.name === item && i.category !== "leftover"; });
      if (!f) f = FRIDGE.find(function (i) { return i.name === item; });
      if (!f || f.qty < r.needs[item]) { possible = false; return; }
      var urgency = Math.max(0, 5 - groceryUrgency(f));
      score += urgency;
      if (urgency > 0 && (!urgent || groceryUrgency(f) < groceryUrgency(urgent))) urgent = f;
    });
    if (!possible) return;
    var reason = urgent
      ? "Uses your " + urgent.name + ", which needs using within " + Math.max(0, groceryUrgency(urgent)) + " days. You have everything. " + r.minutes + " min."
      : "You have everything already. " + r.minutes + " min.";
    results.push({ name: r.name, minutes: r.minutes, needs: r.needs, score: score, reason: reason });
  });
  return results.sort(function (a, b) { return b.score - a.score; });
}
