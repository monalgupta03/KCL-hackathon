// Router and click handling. Every button uses data-action, handled below.
var view = document.getElementById("view");
var addExpiryEstimatePending = false;
var grocerySubmissionPending = false;

var renderers = { fridge: renderFridge, cook: renderCook, add: renderAdd };

var currentViewRequest = 0;
async function show(tab, message) {
  var requestId = ++currentViewRequest;
  stopAddCamera();
  view.setAttribute && view.setAttribute("aria-busy", "true");
  view.innerHTML = "<div class='loading-state' role='status'><span class='loading-spinner' aria-hidden='true'></span>" +
    (tab === "cook" ? "Finding meals for your pantry…" : "Loading your " + (tab === "fridge" ? "pantry" : "items") + "…") + "</div>";
  try {
    var buttons = document.querySelectorAll("nav button");
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].classList.toggle("active", buttons[i].dataset.tab === tab);
      if (buttons[i].setAttribute) buttons[i].setAttribute("aria-current", buttons[i].dataset.tab === tab ? "page" : "false");
    }
    var html = await renderers[tab]();
    if (requestId !== currentViewRequest) return;
    if (message) html = "<div class='msg' role='status'>" + escapeAddText(message) + "</div>" + html;
    view.innerHTML = html;
    view.scrollTop = 0;
  } catch (err) {
    if (requestId !== currentViewRequest) return;
    view.innerHTML = "<div class='error' role='alert'>" + escapeAddText(err.message || "Could not load this screen.") +
      "</div><button class='btn' data-action='tab' data-tab='" + tab + "'>Try again</button>";
  } finally {
    if (requestId === currentViewRequest && view.setAttribute) view.setAttribute("aria-busy", "false");
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
    var previous = FRIDGE;
    FRIDGE = FRIDGE.filter(function (item) { return item.id !== d.id; });
    if (!saveInventory()) {
      FRIDGE = previous;
      return show("fridge", "Browser storage is unavailable. This leftover was not changed.");
    }
    show("fridge");
  },
  "eat-leftover": function (d) {
    var leftover = FRIDGE.find(function (item) { return item.id === d.id; });
    if (!leftover || !window.confirm("Mark " + leftover.name + " as eaten?")) return;
    var previous = FRIDGE;
    FRIDGE = FRIDGE.filter(function (item) { return item.id !== d.id; });
    if (!saveInventory()) {
      FRIDGE = previous;
      return show("fridge", "Browser storage is unavailable. This leftover was not changed.");
    }
    show("fridge");
  },
  "edit-grocery": async function (d) {
    fridgeViewState.editingGroceryId = d.id;
    await show("fridge");
    var form = document.querySelector(".grocery-edit-form");
    if (!form) return;
    if (form.scrollIntoView) form.scrollIntoView({ block: "center" });
    var input = form.querySelector(d.focus === "expiry" ? "[name='expiry']" : "[name='name']");
    if (input) input.focus({ preventScroll: true });
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
    if (addExpiryEstimatePending) return;
    addExpiryEstimatePending = true;
    try {
      await api.scan(d.name, 1);
      show("fridge", "Added 1 " + d.name + ".");
    } catch (error) {
      show("add", error.message || "Could not add this item.");
    } finally { addExpiryEstimatePending = false; }
  },

  sync: async function () {
    var message = document.getElementById("sync-message");
    message.textContent = "Checking backend...";
    try {
      var result = await inventoryResponse(await apiFetch(API_URL + "/health"));
      if (result.status !== "ok") throw new Error("Unexpected health response");
      message.textContent = "Backend connected. Fridge hardware not connected yet.";
    } catch (error) {
      message.textContent = "Your pantry is unavailable. Please try again in a moment.";
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
    if (!name || name.length > 120 || !Number.isFinite(qty) || qty <= 0 || qty > 1000000 || Math.abs(qty * 100 - Math.round(qty * 100)) > 0.000001 || unit.length > 40) {
      document.getElementById("manual-message").textContent = "Enter a name and a positive quantity with up to two decimal places.";
      return;
    }
    if (document.getElementById("add-kind").value === "leftover") {
      var preparedAt = new Date(document.getElementById("add-prepared-at").value);
      if (Number.isNaN(preparedAt.getTime()) || preparedAt.getTime() > Date.now()) {
        addManualMessage = "Enter a preparation time in the past to save this leftover.";
        document.getElementById("manual-message").textContent = addManualMessage;
        return;
      }
      if (addExpiryEstimatePending) return;
      addExpiryEstimatePending = true;
      try {
        var currentInventory = await api.getInventory();
        var existing = addEditingItem || currentInventory.find(function (item) {
          return item.category === "leftover" && addSelectedExistingId && (item.id === addSelectedExistingId || item.name === addSelectedExistingId);
        }) || currentInventory.find(function (item) { return item.category === "leftover" && item.name.trim().toLowerCase() === name; });
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
        show("fridge", "Saved " + name + " as a leftover on this browser.");
      } catch (error) {
        var feedback = document.getElementById("manual-message");
        if (feedback) feedback.textContent = error.message || "Could not save this leftover.";
      } finally { addExpiryEstimatePending = false; }
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
    var addButton = document.querySelector("[data-action='add']");
    if (addButton) { addButton.disabled = true; addButton.textContent = "Saving…"; }
    try {
      if (!expiryDate) {
        var estimate = await api.estimateExpiry(name);
        expiryDate = estimate.expiry_date || "";
        expiryDateSource = estimate.expiry_date_source || "unknown";
      }
      await api.scan(name, qty, unit, expiryDate, expiryDateSource, expiryDateSource === "printed" && printedDateConfirmed);
    } catch (error) {
      addManualMessage = error.message || "Could not add this item.";
      var manualFeedback = document.getElementById("manual-message");
      if (manualFeedback) manualFeedback.textContent = addManualMessage;
      return;
    } finally {
      addExpiryEstimatePending = false;
      if (addButton) { addButton.disabled = false; addButton.textContent = "Add to Fridge"; }
    }
    addEditingItem = null;
    addSelectedKind = "grocery";
    addSelectedExistingId = null;
    addManualMessage = "";
    show("fridge", "Added " + qty + " " + name + ".");
  }
};

document.addEventListener("click", function (e) {
  var el = e.target.closest("[data-action]");
  if (!el) return;
  var fn = actions[el.dataset.action];
  if (el.disabled || el.getAttribute && el.getAttribute("aria-disabled") === "true") return;
  if (fn) Promise.resolve().then(function () { return fn(el.dataset); }).catch(function (error) {
    var notice = document.createElement("div");
    notice.className = "error";
    notice.setAttribute("role", "alert");
    notice.textContent = error.message || "Could not complete this action. Please try again.";
    view.prepend(notice);
  });
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
  view.innerHTML = "<div class='error' role='alert'>" + escapeAddText(e.message) + "</div>";
});

show("fridge");

// Let native form submission (including Enter) use the existing validated action.
document.addEventListener("submit", function (event) {
  if (!event.target.classList.contains("grocery-edit-form")) return;
  event.preventDefault();
  actions["save-grocery"]({ id: fridgeViewState.editingGroceryId });
});
document.addEventListener("change", function (event) {
  if (event.target.id !== "cook-dietary") return;
  cookState.dietaryRestrictions = event.target.value ? [event.target.value] : [];
  cookState.selected = null;
  cookState.rejected = [];
  show("cook");
});
