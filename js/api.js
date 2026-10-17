// Every screen gets its data from here.
// When the FastAPI backend is ready: set USE_MOCK = false.
var USE_MOCK = true;
var API_URL = "http://localhost:8000";

var api = {
  getInventory: async function () {
    if (USE_MOCK) return FRIDGE;
    var res = await fetch(API_URL + "/inventory");
    return res.json();
  },

  getEvents: async function () {
    return EVENTS;
  },

  scan: async function (name, qty, unit) {
    if (USE_MOCK) {
      var found = FRIDGE.find(function (i) { return i.name === name && i.category !== "leftover"; });
      if (found) found.qty += qty;
      else FRIDGE.push({ name: name, qty: qty, unit: unit || "", days: 5 });
      if (found && unit) found.unit = unit;
      EVENTS.unshift("Added: " + qty + " " + name);
      saveInventory();
      return { ok: true };
    }
    var res = await fetch(API_URL + "/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ item: name, quantity: qty, action: "add" })
    });
    return res.json();
  },

  addInventoryItem: async function (item) {
    if (!USE_MOCK) {
      return { ok: false, message: "The backend does not yet support leftover category and preparation details." };
    }
    var found = item.id && FRIDGE.find(function (entry) { return entry.id === item.id; });
    if (!found) {
      found = FRIDGE.find(function (entry) { return entry.name.toLowerCase() === item.name.toLowerCase(); });
    }
    if (found) {
      Object.assign(found, item, { id: found.id || item.id });
    } else {
      FRIDGE.push(item);
    }
    saveInventory();
    return { ok: true, item: found || item };
  },

  recommend: async function (minutes) {
    if (USE_MOCK) return scoreRecipes(minutes);
    var res = await fetch(API_URL + "/recommend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ minutes: minutes })
    });
    return res.json();
  },

  cook: async function (recipe) {
    if (USE_MOCK) {
      Object.keys(recipe.needs).forEach(function (item) {
        var f = FRIDGE.find(function (i) { return i.name === item && i.category !== "leftover"; });
        if (!f) f = FRIDGE.find(function (i) { return i.name === item; });
        if (f) f.qty -= recipe.needs[item];
      });
      FRIDGE = FRIDGE.filter(function (i) { return i.qty > 0; });
      EVENTS.unshift("Cooked: " + recipe.name);
      saveInventory();
      return { ok: true };
    }
    var res = await fetch(API_URL + "/cook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipe: recipe.name })
    });
    return res.json();
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
      var urgency = Math.max(0, 5 - f.days);
      score += urgency;
      if (urgency > 0 && (!urgent || f.days < urgent.days)) urgent = f;
    });
    if (!possible) return;
    var reason = urgent
      ? "Uses your " + urgent.name + ", which needs using within " + urgent.days + " days. You have everything. " + r.minutes + " min."
      : "You have everything already. " + r.minutes + " min.";
    results.push({ name: r.name, minutes: r.minutes, needs: r.needs, score: score, reason: reason });
  });
  return results.sort(function (a, b) { return b.score - a.score; });
}
