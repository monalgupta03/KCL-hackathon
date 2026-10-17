// Cook tab. Recommendations continue to come from the existing API/local scorer.
var cookState = { minutes: 15, rejected: [], selected: null };

function escapeCookText(value) {
  return String(value).replace(/[&<>"']/g, function (character) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[character];
  });
}

function cookIngredients(recipe, inventory) {
  return Object.keys(recipe.needs || {}).map(function (name) {
    var item = inventory.find(function (entry) { return entry.name.toLowerCase() === name.toLowerCase(); });
    var unit = item && item.unit ? " " + item.unit : "";
    return { name: name, amount: recipe.needs[name], unit: unit, item: item };
  });
}

function cookSoonIngredient(recipe, inventory) {
  return cookIngredients(recipe, inventory).map(function (ingredient) {
    return ingredient.item && Number(ingredient.item.days) <= 3 ? ingredient.item : null;
  }).filter(Boolean).sort(function (a, b) { return Number(a.days) - Number(b.days); })[0] || null;
}

function cookHeader(inventory) {
  var soon = inventory.filter(function (item) {
    return item.qty > 0 && Number(item.days) <= 3;
  }).sort(function (a, b) { return Number(a.days) - Number(b.days); })[0];
  var html = "<section class='cook-page'><header class='cook-heading'>" +
    "<p class='cook-eyebrow'>A LITTLE HELP FROM YOUR FRIDGE</p>" +
    "<h2>What's cooking?</h2>" +
    "<p>Less thinking, more cooking. Let's use what you have.</p>" +
    "</header>";
  if (soon) {
    html += "<p class='cook-context'><span aria-hidden='true'>✦</span> Your " +
      escapeCookText(soon.name) + " needs using soon. Let's make something delicious!</p>";
  }
  return html;
}

function cookTimeFilters() {
  var html = "<div class='cook-time-block'><p class='cook-section-label'>HOW MUCH TIME DO YOU HAVE?</p>" +
    "<div class='cook-time-filters' role='group' aria-label='Cooking time'>";
  [5, 15, 30].forEach(function (minutes) {
    html += "<button class='cook-chip" + (minutes === cookState.minutes ? " active" : "") +
      "' aria-pressed='" + (minutes === cookState.minutes) + "' data-action='time' data-minutes='" +
      minutes + "'>" + minutes + " min</button>";
  });
  return html + "</div></div>";
}

function cookIngredientList(recipe, inventory) {
  return cookIngredients(recipe, inventory).map(function (ingredient) {
    return "<li><span class='cook-check' aria-hidden='true'>✓</span><span>" +
      escapeCookText(ingredient.amount + ingredient.unit + " " + ingredient.name) + "</span></li>";
  }).join("");
}

function renderCookDetails(recipe, inventory) {
  var ingredients = cookIngredients(recipe, inventory);
  var steps = Array.isArray(recipe.steps) && recipe.steps.length
    ? "<ol class='cook-steps'>" + recipe.steps.map(function (step) {
      return "<li>" + escapeCookText(step) + "</li>";
    }).join("") + "</ol>"
    : "<p class='cook-placeholder'>Cooking steps aren't available yet.</p>";

  return cookHeader(inventory) + cookTimeFilters() +
    "<article class='cook-detail card'><button class='cook-back' data-action='back-recipes'>" +
    "<span aria-hidden='true'>←</span> Back to ideas</button>" +
    "<div class='cook-detail-mark' aria-hidden='true'>🍳</div>" +
    "<p class='cook-eyebrow'>YOUR NEXT MEAL</p><h3>" + escapeCookText(recipe.name) + "</h3>" +
    "<p class='cook-time'><span aria-hidden='true'>◷</span> About " + recipe.minutes + " minutes</p>" +
    "<h4>Ingredients</h4><ul class='cook-ingredients'>" + cookIngredientList(recipe, inventory) + "</ul>" +
    "<h4>Cooking steps</h4>" + steps +
    "<button class='btn main big cook-confirm' data-action='confirm-cook'>I cooked this</button></article></section>";
}

async function renderCook() {
  var inventory = await api.getInventory();
  inventory = Array.isArray(inventory) ? inventory.filter(function (item) { return item.qty > 0; }) : [];
  if (!inventory.length) {
    return cookHeader(inventory) + "<section class='cook-empty card'><div aria-hidden='true'>🥬</div>" +
      "<h3>Your fridge is looking a little empty.</h3><p>Add a few groceries and we'll find something for you.</p>" +
      "<button class='btn main' data-action='tab' data-tab='add'>Add groceries</button></section></section>";
  }

  if (cookState.selected) return renderCookDetails(cookState.selected, inventory);

  var all = await api.recommend(cookState.minutes);
  all = Array.isArray(all) ? all : [];
  var available = all.filter(function (recipe) { return cookState.rejected.indexOf(recipe.name) === -1; });
  var html = cookHeader(inventory) + cookTimeFilters();

  if (!all.length) {
    html += "<section class='cook-empty card'><div aria-hidden='true'>⌕</div>" +
      "<h3>No recipes fit this time</h3><p>Try a longer time, or add more groceries to your fridge.</p>" +
      "<button class='btn' data-action='tab' data-tab='add'>Add groceries</button></section>";
  } else if (!available.length) {
    html += "<section class='cook-empty card'><div aria-hidden='true'>✦</div>" +
      "<h3>You've seen these ideas</h3><p>There aren't any other matches right now.</p>" +
      "<button class='btn' data-action='reset'>Show suggestions again</button></section>";
  }

  available.slice(0, 2).forEach(function (recipe) {
    var index = all.indexOf(recipe);
    var ingredients = cookIngredients(recipe, inventory);
    var soon = cookSoonIngredient(recipe, inventory);
    var reason = recipe.reason || "A local match based on what's currently in your fridge.";
    html += "<article class='cook-recipe card'><div class='cook-recipe-top'><div class='cook-recipe-mark' aria-hidden='true'>🍽</div>" +
      "<div class='cook-recipe-meta'><span class='cook-time'><span aria-hidden='true'>◷</span> " + recipe.minutes + " min</span>" +
      (soon ? "<span class='cook-use-soon'>Use soon: " + escapeCookText(soon.name) + "</span>" : "") +
      "</div></div><h3>" + escapeCookText(recipe.name) + "</h3>" +
      "<p class='cook-label'>INGREDIENTS YOU'LL USE</p><p class='cook-ingredient-summary'>" +
      ingredients.map(function (ingredient) {
        return escapeCookText(ingredient.amount + ingredient.unit + " " + ingredient.name);
      }).join(" · ") + "</p><p class='cook-reason'><span aria-hidden='true'>✦</span> " +
      escapeCookText(reason) + "</p><div class='cook-recipe-actions'>" +
      "<button class='btn main' data-action='open-recipe' data-index='" + index + "'>Cook this</button>" +
      "<button class='btn cook-skip' data-action='skip' data-name='" + escapeCookText(recipe.name) + "'>Not in the mood</button>" +
      "</div></article>";
  });
  return html + "</section>";
}
