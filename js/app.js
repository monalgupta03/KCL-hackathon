// Router and click handling. Every button uses data-action, handled below.
var view = document.getElementById("view");
var addExpiryEstimatePending = false;
var grocerySubmissionPending = false;

var renderers = { fridge: renderFridge, cook: renderCook, add: renderAdd };

async function show(tab, message) {
  stopAddCamera();
  try {
    var buttons = document.querySelectorAll("nav button");
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].classList.toggle("active", buttons[i].dataset.tab === tab);
    }
    var html = await renderers[tab]();
    if (message) html = "<div class='msg'>" + message + "</div>" + html;
    view.innerHTML = html;
    view.scrollTop = 0;
  } catch (err) {
    view.innerHTML = "<div class='error'>Something broke: " + err.message + "</div>";
    console.error(err);
  }
}

var actions = {
  tab: function (d) { show(d.tab); },

  time: function (d) {
    cookState.minutes = parseInt(d.minutes, 10);
    cookState.rejected = [];
    cookState.selected = null;
    return show("cook");
  },

  skip: function (d) {
    if (cookState.rejected.indexOf(d.name) === -1) cookState.rejected.push(d.name);
    return show("cook");
  },
  reset: function () { cookState.rejected = []; show("cook"); },

  "open-recipe": async function (d) {
    var recipe = cookState.recipes[parseInt(d.index, 10)];
    if (!recipe) return;
    cookState.selected = recipe;
    return show("cook");
  },

  "back-recipes": function () {
    cookState.selected = null;
    return show("cook");
  },

  "confirm-cook": async function () {
    var recipe = cookState.selected;
    if (!recipe) return;
    await api.cook(recipe);
    cookState.selected = null;
    cookState.rejected = [];
    show("fridge", "Enjoy your " + recipe.name.toLowerCase() + ". Ingredients removed.");
  },

  "edit-leftover": function (d) {
    addEditingItem = FRIDGE.find(function (item) { return item.id === d.id; }) || null;
    addSelectedKind = "leftover";
    addSelectedExistingId = null;
    show("add");
  },
  "add-leftover": function () {
    addEditingItem = null;
    addSelectedKind = "leftover";
    addSelectedExistingId = null;
    addManualMessage = "";
    show("add");
  },
  "remove-leftover": function (d) {
    var leftover = FRIDGE.find(function (item) { return item.id === d.id; });
    if (!leftover || !window.confirm("Remove " + leftover.name + " from leftovers?")) return;
    FRIDGE = FRIDGE.filter(function (item) { return item.id !== d.id; });
    saveInventory();
    show("fridge");
  },
  "eat-leftover": function (d) {
    var leftover = FRIDGE.find(function (item) { return item.id === d.id; });
    if (!leftover || !window.confirm("Mark " + leftover.name + " as eaten?")) return;
    if (leftover.qty > 1) leftover.qty -= 1;
    else FRIDGE = FRIDGE.filter(function (item) { return item.id !== d.id; });
    saveInventory();
    show("fridge");
  },
  "edit-grocery": function (d) {
    fridgeViewState.editingGroceryId = d.id;
    show("fridge");
  },
  "cancel-grocery": function () {
    fridgeViewState.editingGroceryId = null;
    show("fridge");
  },
  "edit-expiry": function (d) {
    fridgeViewState.editingExpiryId = d.id;
    show("fridge");
  },
  "cancel-expiry": function () {
    fridgeViewState.editingExpiryId = null;
    show("fridge");
  },
  "confirm-expiry": async function (d) {
    var input = document.getElementById("expiry-edit-date");
    var message = document.getElementById("expiry-edit-message");
    if (!input || dateDayNumber(input.value) === null) {
      if (message) message.textContent = "Choose a valid calendar date.";
      return;
    }
    try {
      await api.confirmExpiry(d.id, input.value);
      fridgeViewState.editingExpiryId = null;
      show("fridge", "Expiry date saved.");
    } catch (error) {
      if (message) message.textContent = error.message || "Could not save the expiry date.";
    }
  },
  "save-grocery": async function (d) {
    if (grocerySubmissionPending) return;
    var form = document.querySelector(".grocery-edit-form");
    if (!form) return;
    var name = form.querySelector("[name='name']").value.trim();
    var quantity = Number(form.querySelector("[name='qty']").value);
    var unit = form.querySelector("[name='unit']").value.trim();
    var expiry = form.querySelector("[name='expiry']").value;
    var message = document.getElementById("grocery-edit-message");
    if (!name || name.length > 120 || !Number.isFinite(quantity) || quantity <= 0 || quantity > 1000000 ||
        Math.abs(quantity * 100 - Math.round(quantity * 100)) > 0.000001 || unit.length > 40 ||
        (expiry && dateDayNumber(expiry) === null)) {
      message.textContent = "Enter a name, a positive quantity with up to two decimal places, and a valid date.";
      return;
    }
    grocerySubmissionPending = true;
    try {
      await api.editGrocery(d.id, { name: name, quantity: quantity, unit: unit, expiry_date: expiry || null });
      fridgeViewState.editingGroceryId = null;
      await show("fridge", "Item saved.");
    } catch (error) {
      message.textContent = error.message || "Could not save this item.";
    } finally {
      grocerySubmissionPending = false;
    }
  },
  "eat-grocery": async function (d) {
    if (grocerySubmissionPending) return;
    grocerySubmissionPending = true;
    try {
      await api.markEaten(d.id);
      await show("fridge", "Item marked as eaten.");
    } catch (error) {
      await show("fridge", "Could not mark this item as eaten.");
    } finally {
      grocerySubmissionPending = false;
    }
  },

  "cancel-add-edit": function () {
    addEditingItem = null;
    addSelectedKind = "grocery";
    addManualMessage = "";
    show("fridge");
  },

  quick: async function (d) {
    try {
      await api.scan(d.name, 1);
      show("fridge", "Added 1 " + d.name + ".");
    } catch (error) {
      show("add", error.message || "Could not add this item.");
    }
  },

  sync: async function () {
    var message = document.getElementById("sync-message");
    message.textContent = "Checking backend...";
    try {
      var response = await fetch("http://127.0.0.1:8000/health");
      if (response.status !== 200) throw new Error("Health check failed");
      var result = await response.json();
      if (result.status !== "ok") throw new Error("Unexpected health response");
      message.textContent = "Backend connected. Fridge hardware not connected yet.";
    } catch (error) {
      message.textContent = "Cannot reach backend.";
    }
  },

  "open-camera": function () { openAddCamera(); },
  capture: function () { captureAddPhoto(); },
  retake: function () { retakeAddPhoto(); },
  "use-photo": function () { recognizeAddPhoto(); },
  "confirm-detected-items": function () { confirmDetectedItems(); },
  "remove-detected-item": function (d) {
    var index = Number(d.index);
    if (!Number.isInteger(index) || !addPendingScanItems[index]) return;
    addPendingScanItems.splice(index, 1);
    renderDetectedScanItems();
    if (!addPendingScanItems.length) {
      document.getElementById("camera-message").textContent = "No food item was clearly identified. Retake the photo or add it manually.";
      document.getElementById("scan-result").hidden = false;
    }
  },

  add: async function () {
    var name = document.getElementById("add-name").value.trim().toLowerCase();
    var qty = Number(document.getElementById("add-qty").value);
    var unit = document.getElementById("add-unit").value.trim();
    if (!name || !Number.isFinite(qty) || qty <= 0) return;
    if (document.getElementById("add-kind").value === "leftover") {
      var preparedAt = new Date(document.getElementById("add-prepared-at").value);
      if (Number.isNaN(preparedAt.getTime())) {
        addManualMessage = "Enter an approximate preparation time to save this leftover.";
        document.getElementById("manual-message").textContent = addManualMessage;
        return;
      }
      var currentInventory = await api.getInventory();
      var existing = addEditingItem || currentInventory.find(function (item) {
        return addSelectedExistingId && (item.id === addSelectedExistingId || item.name === addSelectedExistingId);
      }) || currentInventory.find(function (item) { return item.name.trim().toLowerCase() === name; });
      var item = Object.assign({}, existing || {}, {
        id: existing && existing.id || "item-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
        name: name,
        qty: qty,
        unit: unit || "serving",
        category: "leftover",
        preparedAt: preparedAt.toISOString(),
        location: document.getElementById("add-location").value,
        freshnessSource: document.getElementById("add-location").value ? "estimated" : "unknown"
      });
      var result = await api.addInventoryItem(item);
      if (!result.ok) {
        addManualMessage = result.message;
        document.getElementById("manual-message").textContent = addManualMessage;
        return;
      }
      addEditingItem = null;
      addSelectedKind = "grocery";
      addSelectedExistingId = null;
      addManualMessage = "";
      show("fridge", "Saved " + qty + " " + (unit || "serving") + " " + name + " as a leftover.");
      return;
    }
    var sourceInput = document.getElementById("add-expiry-source");
    var dateInput = document.getElementById("add-expiry-date");
    var confirmedInput = document.getElementById("printed-date-confirmed");
    var expiryDateSource = sourceInput ? sourceInput.value : "unknown";
    var expiryDate = dateInput ? dateInput.value : "";
    var printedDateConfirmed = confirmedInput ? confirmedInput.checked : false;
    if (expiryDate && expiryDateSource === "unknown") {
      addManualMessage = "Choose Printed or Estimated for the date you entered.";
      document.getElementById("manual-message").textContent = addManualMessage;
      return;
    }
    if (expiryDate && expiryDateSource === "printed" && !printedDateConfirmed) {
      addManualMessage = "Confirm that you checked the printed date on the package.";
      document.getElementById("manual-message").textContent = addManualMessage;
      return;
    }
    if (addExpiryEstimatePending) return;
    addExpiryEstimatePending = true;
    try {
      if (!expiryDate) {
        var estimate = await api.estimateExpiry(name);
        expiryDate = estimate.expiry_date || "";
        expiryDateSource = estimate.expiry_date_source || "unknown";
      }
      await api.scan(name, qty, unit, expiryDate, expiryDateSource, expiryDateSource === "printed" && printedDateConfirmed);
    } catch (error) {
      addManualMessage = error.message || "Could not add this item.";
      document.getElementById("manual-message").textContent = addManualMessage;
      return;
    } finally {
      addExpiryEstimatePending = false;
    }
    addEditingItem = null;
    addSelectedKind = "grocery";
    addSelectedExistingId = null;
    show("fridge", "Added " + qty + " " + name + ".");
  }
};

document.addEventListener("click", function (e) {
  var el = e.target.closest("[data-action]");
  if (!el) return;
  var fn = actions[el.dataset.action];
  if (fn) fn(el.dataset);
});

document.addEventListener("input", function (event) {
  var index = event.target.dataset && event.target.dataset.index;
  var field = event.target.dataset && event.target.dataset.field;
  if (!index && index !== "0" || !field || !addPendingScanItems[Number(index)]) return;
  var itemIndex = Number(index);
  var item = addPendingScanItems[itemIndex];
  if (field === "quantity") {
    item.quantity = event.target.value === "" ? null : parseDetectedQuantity(event.target.value);
    return;
  }
  item[field] = event.target.value;
});

document.addEventListener("change", function (event) {
  if (event.target.id !== "add-expiry-source") return;
  var confirmation = document.getElementById("printed-date-confirmation");
  if (confirmation) confirmation.hidden = event.target.value !== "printed";
});

window.addEventListener("error", function (e) {
  view.innerHTML = "<div class='error'>Error: " + e.message + "</div>";
});

initializeDemoLeftover();
show("fridge");
