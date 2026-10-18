var fridgeViewState = { editingGroceryId: null, editingExpiryId: null };

function escapeFridgeText(value) {
  return String(value).replace(/[&<>"']/g, function (character) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[character];
  });
}

function dateDayNumber(value) {
  if (!value) return null;
  var parts = String(value).split("-");
  if (parts.length !== 3) return null;
  var year = Number(parts[0]), month = Number(parts[1]), day = Number(parts[2]);
  if (!year || !month || !day) return null;
  var timestamp = Date.UTC(year, month - 1, day);
  var parsed = new Date(timestamp);
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return null;
  return Math.floor(timestamp / 86400000);
}

function currentDayNumber() {
  var now = new Date();
  return Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86400000);
}

function itemUseBy(item) {
  return item.useByDate || item.expiryDate || item.expirationDate || "";
}

function groceryUrgency(item) {
  var expiryDate = dateDayNumber(itemUseBy(item));
  return expiryDate === null ? Infinity : expiryDate - currentDayNumber();
}

function groceryExpiryStatus(item) {
  var expiryDate = dateDayNumber(itemUseBy(item));
  var source = item.expiryDateSource || "unknown";
  var sourceLabel = source === "printed" ? "Printed date" : source === "estimated"
    ? item.expiryDateConfirmed ? "Confirmed" : "Estimated"
    : expiryDate === null ? "Unknown date" : "Source unknown";
  if (expiryDate === null) return { text: "Date unknown", source: "Unknown date", state: "unknown", attention: true };

  var daysUntilExpiry = expiryDate - currentDayNumber();
  var text = daysUntilExpiry < 0 ? "Date passed"
    : daysUntilExpiry === 0 ? "Expires today"
      : daysUntilExpiry <= 3 ? "Use soon" : "Use by " + formatFridgeDate(itemUseBy(item));
  return {
    text: text,
    source: sourceLabel,
    state: daysUntilExpiry <= 3 ? "attention" : "fresh",
    attention: daysUntilExpiry <= 3
  };
}

function formatFridgeDate(value) {
  var date = new Date(String(value).length === 10 ? value + "T00:00:00" : value);
  if (Number.isNaN(date.getTime())) return "Date unknown";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}

function groceryNeedsAttention(item) {
  return groceryUrgency(item) <= 3;
}

function groceryNeedsDateConfirmation(item) {
  return dateDayNumber(itemUseBy(item)) === null;
}

function sortGroceriesByExpiry(items) {
  return items.slice().sort(function (first, second) {
    var firstExpiry = groceryUrgency(first), secondExpiry = groceryUrgency(second);
    if (!Number.isFinite(firstExpiry)) return Number.isFinite(secondExpiry) ? 1 : 0;
    if (!Number.isFinite(secondExpiry)) return -1;
    return firstExpiry - secondExpiry;
  });
}

function leftoverAttentionHours(leftover) {
  var preparedAt = new Date(leftover.preparedAt);
  var location = String(leftover.location || "").toLowerCase();
  if (!leftover.preparedAt || Number.isNaN(preparedAt.getTime()) || !LEFTOVER_ATTENTION_HOURS[location]) return null;
  return LEFTOVER_ATTENTION_HOURS[location];
}

function leftoverUseByDays(leftover) {
  var useBy = leftover.useByDate || "";
  return dateDayNumber(useBy) === null ? null : dateDayNumber(useBy) - currentDayNumber();
}

function leftoverNeedsAttention(leftover) {
  var useByDays = leftoverUseByDays(leftover);
  if (useByDays !== null) return useByDays <= 2;
  var threshold = leftoverAttentionHours(leftover);
  return threshold === null || Date.now() - new Date(leftover.preparedAt).getTime() >= threshold * 3600000;
}

function preparedAgo(value) {
  if (!value) return "time unknown";
  var prepared = new Date(value);
  if (Number.isNaN(prepared.getTime())) return "time unknown";
  var elapsed = Math.max(0, Date.now() - prepared.getTime());
  var minutes = Math.floor(elapsed / 60000);
  if (minutes < 60) return minutes <= 1 ? "just now" : minutes + " minutes ago";
  var hours = Math.floor(minutes / 60);
  if (hours < 24) return hours + (hours === 1 ? " hour ago" : " hours ago");
  var days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  return days + " days ago";
}

function leftoverStatus(leftover) {
  var useByDays = leftoverUseByDays(leftover);
  if (useByDays !== null) {
    if (useByDays < 0) return { text: "User use-by date passed", urgent: true };
    if (useByDays === 0) return { text: "User use-by is today", urgent: true };
    if (useByDays <= 2) return { text: "User use-by in " + useByDays + (useByDays === 1 ? " day" : " days"), urgent: true };
    return { text: "User use-by " + formatFridgeDate(leftover.useByDate), urgent: false };
  }
  var threshold = leftoverAttentionHours(leftover);
  if (threshold === null) return { text: "Freshness unknown", urgent: true };
  var elapsed = Math.max(0, (Date.now() - new Date(leftover.preparedAt).getTime()) / 3600000);
  if (elapsed >= threshold) return { text: "Eat Soon (estimated)", urgent: true };
  var remainingDays = Math.ceil((threshold - elapsed) / 24);
  return { text: "Attention estimate in ~" + remainingDays + (remainingDays === 1 ? " day" : " days"), urgent: false };
}

function sortLeftovers(leftovers) {
  return leftovers.slice().sort(function (first, second) {
    var firstUseBy = leftoverUseByDays(first), secondUseBy = leftoverUseByDays(second);
    if (firstUseBy !== null && secondUseBy !== null && firstUseBy !== secondUseBy) return firstUseBy - secondUseBy;
    if (firstUseBy !== null && secondUseBy === null) return -1;
    if (secondUseBy !== null && firstUseBy === null) return 1;
    var firstTime = new Date(first.preparedAt || "").getTime();
    var secondTime = new Date(second.preparedAt || "").getTime();
    if (!Number.isFinite(firstTime)) return Number.isFinite(secondTime) ? 1 : 0;
    if (!Number.isFinite(secondTime)) return -1;
    return firstTime - secondTime;
  });
}

function foodIcon(name) {
  var value = String(name).toLowerCase();
  if (/spinach|lettuce|kale|herb|broccoli/.test(value)) return "🥬";
  if (/tomato|pepper|apple|berry|fruit/.test(value)) return "🍅";
  if (/egg/.test(value)) return "🥚";
  if (/bread|toast/.test(value)) return "🍞";
  if (/cheese|milk|yogurt/.test(value)) return "🧀";
  if (/rice|pasta|noodle/.test(value)) return "🍚";
  return "🥕";
}

function renderLeftoverCard(leftover) {
  var status = leftoverStatus(leftover);
  var html = "<article class='leftover-card'><div class='fridge-card-heading'><span class='food-icon' aria-hidden='true'>" +
    foodIcon(leftover.name) + "</span><div class='fridge-card-title'><h4>" + escapeFridgeText(leftover.name) + "</h4>" +
    (leftover.id === DEMO_LEFTOVER_ID ? "<span class='demo-item-label'>Sample demo data</span>" : "") +
    "<p>" + escapeFridgeText(leftover.qty + " " + (leftover.unit || "servings")) + " · Made " +
    escapeFridgeText(preparedAgo(leftover.preparedAt)) + "</p></div><span class='freshness " +
    (status.urgent ? "attention" : "known") + "'>" + escapeFridgeText(status.text) + "</span></div>" +
    "<p class='fridge-location'>" + (leftover.location ? "Stored in " + escapeFridgeText(leftover.location) : "Storage location unknown") + "</p>";
  html += "<div class='fridge-card-actions'><button class='text-action' data-action='edit-leftover' data-id='" +
    escapeFridgeText(leftover.id) + "'>Edit in Add</button><button class='text-action' data-action='eat-leftover' data-id='" +
    escapeFridgeText(leftover.id) + "'>Mark as eaten</button><button class='text-action remove-action' data-action='remove-leftover' data-id='" +
    escapeFridgeText(leftover.id) + "'>Remove</button></div>";
  return html + "</article>";
}

function renderGroceryCard(item, editable) {
  var name = String(item.name);
  var expiryStatus = groceryExpiryStatus(item);
  var expiryClickable = item.expiryDateSource === "estimated" && !item.expiryDateConfirmed && dateDayNumber(itemUseBy(item)) !== null;
  var expiryTag = expiryClickable ? "button" : "span";
  var quantity = item.qty + (item.unit ? " " + item.unit : "");
  var html = "<article class='grocery-card'><div class='fridge-card-heading'><span class='food-icon' aria-hidden='true'>" +
    foodIcon(name) + "</span><div class='fridge-card-title'><h4>" + escapeFridgeText(name) + "</h4>" +
    "<p>" + escapeFridgeText(quantity) + (item.location ? " · " + escapeFridgeText(item.location) : "") + "</p></div>" +
    "<" + expiryTag + " class='expiry-label " + expiryStatus.state + "'" + (expiryClickable ? " type='button' data-action='edit-grocery' data-id='" + escapeFridgeText(item.id) + "' data-focus='expiry' aria-label='Review estimated expiry for " + escapeFridgeText(name) + "'" : "") + "><strong>" + escapeFridgeText(expiryStatus.text) +
    "</strong>" + (Number.isFinite(groceryUrgency(item)) && groceryUrgency(item) <= 3 ? "<small>" + escapeFridgeText(formatFridgeDate(itemUseBy(item))) + "</small>" : "") + (expiryStatus.source ? "<small>" + escapeFridgeText(expiryStatus.source) + "</small>" : "") + "</" + expiryTag + "></div>";
  if (editable && String(fridgeViewState.editingGroceryId) === String(item.id)) {
    html += "<form class='fridge-form grocery-edit-form'>" +
      "<div class='fridge-form-grid'><label>Name<input name='name' maxlength='120' required value='" + escapeFridgeText(name) + "'></label>" +
      "<label>Quantity<input name='qty' type='number' min='0.01' max='1000000' step='0.01' required value='" + escapeFridgeText(item.qty) + "'></label>" +
      "<label>Unit<input name='unit' maxlength='40' value='" + escapeFridgeText(item.unit || "") + "'></label>" +
      "<label>Expiry or freshness date<input name='expiry' type='date' value='" + escapeFridgeText(itemUseBy(item)) + "'></label></div>" +
      "<p>Saving confirms the entered date. Estimates are freshness guidance, not verified food-safety dates.</p>" +
      "<p id='grocery-edit-message' role='status' aria-live='polite'></p><div class='fridge-form-actions'>" +
      "<button class='btn main' type='button' data-action='save-grocery' data-id='" + escapeFridgeText(item.id) + "'>Save changes</button>" +
      "<button class='btn' type='button' data-action='cancel-grocery'>Cancel</button></div></form>";
  } else {
    html += "<div class='fridge-card-actions'><button class='text-action' data-action='edit-grocery' data-id='" + escapeFridgeText(item.id) +
      "'>Edit</button><button class='text-action' data-action='eat-grocery' data-id='" + escapeFridgeText(item.id) + "'>Mark as Eaten</button></div>";
  }
  return html + "</article>";
}

function fridgeRecommendation(items, leftovers) {
  var urgentLeftover = sortLeftovers(leftovers).find(leftoverNeedsAttention);
  if (urgentLeftover) {
    if (leftoverUseByDays(urgentLeftover) !== null) {
      return "Your " + urgentLeftover.name + " has a user-provided use-by date. Check it before cooking something new.";
    }
    if (leftoverAttentionHours(urgentLeftover) === null) return "Your " + urgentLeftover.name + " has unknown freshness. Check it before cooking something new.";
    return "Your " + urgentLeftover.name + " has an estimated attention flag. Check it before cooking something new.";
  }
  var urgentGrocery = items.slice().sort(function (a, b) { return groceryUrgency(a) - groceryUrgency(b); })
    .find(groceryNeedsAttention);
  if (urgentGrocery && groceryUrgency(urgentGrocery) < 0) return "The date for " + urgentGrocery.name + " has passed. Review it before choosing ingredients.";
  if (urgentGrocery) return "Your " + urgentGrocery.name + " needs using soon. See what you can make.";
  return "Your kitchen is looking in good shape. Find an idea for what you have.";
}

async function renderFridge() {
  var allItems = (await api.getInventory()).filter(function (item) { return item.qty > 0; });
  var leftovers = sortLeftovers(allItems.filter(function (item) { return item.category === "leftover"; }));
  var items = sortGroceriesByExpiry(allItems.filter(function (item) { return item.category !== "leftover"; }));
  var events = await api.getEvents();
  var soonItems = items.filter(groceryNeedsAttention);
  var attentionCount = soonItems.length + items.filter(groceryNeedsDateConfirmation).length + leftovers.filter(leftoverNeedsAttention).length;
  var html = "<section class='fridge-page'><div class='fridge-heading'><p class='fridge-eyebrow'>YOUR FOOD, AT A GLANCE</p>" +
    "<h2>My Kitchen</h2><p>Everything you have, without having to remember.</p></div>" +
    "<div class='kitchen-summary'><div><strong>" + items.length + "</strong><span>Groceries</span></div><div><strong>" +
    leftovers.length + "</strong><span>Leftovers</span></div><div><strong>" + attentionCount + "</strong><span>Need attention</span></div></div>" +
    "<section class='fridge-recommendation'><p class='fridge-eyebrow'>A GOOD NEXT STEP</p><p>" +
    escapeFridgeText(fridgeRecommendation(items, leftovers)) + "</p><button class='btn main' data-action='tab' data-tab='cook'>What should I cook?</button></section>" +
    "<section class='fridge-section'><div class='fridge-section-heading'><div><h3>Eat First <span aria-hidden='true'>🍽️</span></h3>" +
    "<p>Prepared meals · saved on this browser.</p></div><button class='text-action' data-action='add-leftover'>＋ Add Leftover</button></div>";

  if (leftovers.length) leftovers.forEach(function (leftover) { html += renderLeftoverCard(leftover); });
  else html += "<p class='fridge-empty-inline'>No leftovers waiting. Your kitchen is all caught up!</p>";
  html += "</section><section class='fridge-section'><div class='fridge-section-heading'><div><h3>Use Soon <span aria-hidden='true'>⏳</span></h3>" +
    "<p>Groceries with near or past dates. Estimates are guidance.</p></div></div>";
  if (soonItems.length) soonItems.forEach(function (item) { html += renderGroceryCard(item, false); });
  else html += "<p class='fridge-empty-inline'>Nothing needs using urgently.</p>";
  html += "</section><section class='fridge-section'><div class='fridge-section-heading'><div><h3>All Groceries</h3>" +
    "<p>Your ingredients, organised automatically.</p></div></div>";
  if (items.length) items.forEach(function (item) { html += renderGroceryCard(item, true); });
  else html += "<div class='fridge-empty'><span aria-hidden='true'>🧺</span><h4>Your kitchen is ready for groceries</h4>" +
    "<p>Add ingredients to see them here.</p><button class='btn main' data-action='tab' data-tab='add'>Add groceries</button></div>";
  html += "</section><details class='fridge-activity'><summary>Recent activity</summary>";
  if (!events.length) html += "<p>Recent activity on this browser will appear here.</p>";
  events.slice(0, 3).forEach(function (event) { html += "<p>" + escapeFridgeText(event) + "</p>"; });
  return html + "</details></section>";
}
