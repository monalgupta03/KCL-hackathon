var addCameraStream = null;
var addCameraRequest = 0;
var addEditingItem = null;
var addSelectedKind = "grocery";
var addDetectedItems = [];
var addSelectedExistingId = null;
var addManualMessage = "";
var addPendingScanItems = [];
var addPendingScanSubmitting = false;

function escapeAddText(value) {
  return String(value).replace(/[&<>"']/g, function (character) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[character];
  });
}

function addDateTimeValue(value) {
  if (!value) return "";
  var date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) date = new Date();
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function existingLeftoverPicker() {
  if (!addDetectedItems.length) return "";
  return "<label class='add-field-label' for='leftover-existing'>Already in your inventory?</label>" +
    "<select id='leftover-existing'><option value=''>Add a new leftover</option>" +
    addDetectedItems.map(function (item, index) {
      return "<option value='" + index + "'>" + escapeAddText(item.name + " · " + item.qty + (item.unit ? " " + item.unit : "")) + "</option>";
    }).join("") + "</select>";
}

async function renderAdd() {
  var editing = addEditingItem;
  var selectedKind = editing ? "leftover" : addSelectedKind;
  var location = editing && editing.location ? editing.location : "";
  addDetectedItems = [];
  if (selectedKind === "leftover") {
    try {
      addDetectedItems = (await api.getInventory()).filter(function (item) { return item.category !== "leftover"; });
    } catch (error) {
      addDetectedItems = [];
    }
  }
  var html = "<section class='add-page'>" +
    "<div class='add-heading'><p class='add-eyebrow'>YOUR INVENTORY</p>" +
    "<h2>Add to your fridge</h2><p>Keep everything in one easy place.</p></div>" +
    "<section class='smart-card' aria-labelledby='smart-fridge-title'>" +
    "<div class='smart-icon' aria-hidden='true'>❄</div>" +
    "<div class='smart-copy'><p class='add-eyebrow'>AUTOMATIC INVENTORY</p>" +
    "<h3 id='smart-fridge-title'>Smart Fridge</h3>" +
    "<p>Your fridge automatically tracks what goes in.</p></div>" +
    "<div class='smart-status'><span class='status-dot'></span>" +
    (USE_MOCK ? "Not connected · demo inventory" : "Backend configured · hardware status unknown") + "</div>" +
    "<button class='btn main big add-sync' data-action='sync'>Sync from Fridge</button>" +
    "<p id='sync-message' class='add-feedback' role='status' aria-live='polite'></p></section>" +
    "<details id='scan-details' class='add-section'>" +
    "<summary><span class='section-icon' aria-hidden='true'>📷</span>" +
    "<span class='section-title'><strong>Scan an Item</strong>" +
    "<small>Missed something? Scan it yourself.</small></span></summary>" +
    "<div class='section-content'><div class='camera-frame'>" +
    "<div id='camera-placeholder' class='camera-placeholder'>" +
    "<span aria-hidden='true'>⌁</span><p>Your camera preview will appear here</p></div>" +
    "<video id='camera-video' autoplay playsinline muted hidden></video>" +
    "<img id='camera-photo' alt='Photo captured for item scanning' hidden></div>" +
    "<p id='camera-message' class='add-feedback' role='status' aria-live='polite'></p>" +
    "<div class='camera-actions'><button class='btn main big' data-action='open-camera'>Open Camera</button>" +
    "<button class='btn main big' data-action='capture' hidden>Capture</button>" +
    "<button class='btn big' data-action='retake' hidden>Retake</button>" +
    "<button class='btn main big' data-action='use-photo' hidden>Use Photo</button></div>" +
    "<div id='scan-result' class='scan-result' hidden>" +
    "<p class='add-label'>REVIEW DETECTED ITEMS</p>" +
    "<p class='scan-result-note'>Review each item, correct any mistakes, then add the confirmed ones to your fridge. Estimates are freshness guidance, not verified food-safety dates.</p>" +
    "<div id='scan-result-items' class='scan-result-list'></div>" +
    "<button class='btn main big' data-action='confirm-detected-items' type='button'>Confirm & Add to Fridge</button>" +
    "</div></div></details>" +
    "<details class='add-section'" + (selectedKind === "leftover" ? " open" : "") + ">" +
    "<summary><span class='section-icon' aria-hidden='true'>＋</span>" +
    "<span class='section-title'><strong>Add Manually</strong>" +
    "<small>Add an item or correct something that was missed.</small></span></summary>" +
    "<div class='section-content'><p class='add-label'>QUICK ADD</p><div class='quick-add-list'>";

  ["tomato", "eggs", "spinach", "bread", "cheese"].forEach(function (n) {
    html += "<button class='btn quick-add' data-action='quick' data-name='" + n + "'>+ " + n + "</button>";
  });

  html += "</div><p class='add-label'>ITEM DETAILS</p>" +
    "<label class='add-field-label' for='add-name'>Item name</label>" +
    "<input id='add-name' placeholder='e.g. mushrooms' autocomplete='off' value='" + escapeAddText(editing ? editing.name : "") + "'>" +
    "<label class='add-field-label' for='add-kind'>Category</label><select id='add-kind' class='add-kind-select'>" +
    "<option value='grocery'" + (selectedKind === "grocery" ? " selected" : "") + ">Grocery</option>" +
    "<option value='leftover'" + (selectedKind === "leftover" ? " selected" : "") + ">Leftover</option></select>" +
    "<label class='add-field-label' for='add-qty'>Quantity</label>" +
    "<input id='add-qty' type='number' value='" + escapeAddText(editing ? editing.qty : "1") + "' min='0.1' step='0.1' inputmode='decimal'>" +
    "<label class='add-field-label' for='add-unit'>Unit</label>" +
    "<input id='add-unit' placeholder='e.g. pieces, grams, servings' value='" + escapeAddText(editing ? editing.unit || "" : "") + "'>" +
    (selectedKind === "leftover" ? "" :
      "<label class='add-field-label' for='add-expiry-source'>Expiry date source</label>" +
      "<select id='add-expiry-source'><option value='unknown'>Unknown — no date</option>" +
      "<option value='printed'>Printed on packaging</option>" +
      "<option value='estimated'>Estimated freshness</option></select>" +
      "<label class='add-field-label' for='add-expiry-date'>Expiry or freshness date</label>" +
      "<input id='add-expiry-date' type='date'>" +
      "<label id='printed-date-confirmation' class='expiry-confirmation' hidden>" +
      "<input id='printed-date-confirmed' type='checkbox'>I checked this date on the package</label>" +
      "<p class='small'>Enter printed dates from the package, or enter your own estimated freshness date. Estimates are guidance, not verified food-safety dates.</p>") +
    "<div id='leftover-fields' class='add-leftover-fields'" + (selectedKind === "leftover" ? "" : " hidden") + ">" +
    "<label class='add-field-label' for='add-prepared-at'>Prepared at (approximate)</label>" +
    "<input id='add-prepared-at' type='datetime-local' required value='" + escapeAddText(addDateTimeValue(editing ? editing.preparedAt : "")) + "'>" +
    "<label class='add-field-label' for='add-location'>Storage location</label><select id='add-location'>" +
    "<option value=''" + (!location ? " selected" : "") + ">Unknown</option>" +
    "<option value='fridge'" + (location === "fridge" ? " selected" : "") + ">Fridge</option>" +
    "<option value='freezer'" + (location === "freezer" ? " selected" : "") + ">Freezer</option>" +
    "<option value='pantry'" + (location === "pantry" ? " selected" : "") + ">Pantry</option></select></div>" +
    "<div id='leftover-existing-container'" + (selectedKind === "leftover" ? "" : " hidden") + ">" + existingLeftoverPicker() + "</div>" +
    "<p id='manual-message' class='add-feedback' role='status' aria-live='polite'>" + escapeAddText(addManualMessage) + "</p>" +
    "<button class='btn main big' data-action='add'>" + (editing ? "Save Leftover" : "Add to Fridge") + "</button>" +
    (editing ? "<button class='btn big' data-action='cancel-add-edit'>Cancel</button>" : "") +
    "</div></details></section>";
  return html;
}

function renderDetectedScanItems() {
  var container = document.getElementById("scan-result-items");
  var panel = document.getElementById("scan-result");
  var confirmButton = document.querySelector("[data-action='confirm-detected-items']");
  if (!container || !panel) return;

  if (!addPendingScanItems.length) {
    container.innerHTML = "<p class='scan-result-note'>No food item was clearly identified in this photo. Retake or add it manually.</p>";
    if (confirmButton) confirmButton.hidden = true;
    return;
  }

  if (confirmButton) confirmButton.hidden = false;
  container.innerHTML = addPendingScanItems.map(function (item, index) {
    var name = item.name || "";
    var quantity = item.quantity == null ? "" : item.quantity;
    var unit = item.unit || "";
    var expiryNote = item.expiryDate
      ? "<p class='scan-result-expiry'>" + escapeAddText((item.expiryDateSource === "printed" ? "Printed date detected" : "Estimated freshness guidance") + ": " + item.expiryDate) + "</p>"
      : "<p class='scan-result-expiry'>Expiry unknown; freshness estimates are not food-safety dates.</p>";
    return "<div class='scan-result-item'>" +
      "<div class='scan-result-header'>" +
      "<span class='add-label'>" + escapeAddText((index + 1) + ".") + "</span>" +
      "<button class='scan-result-remove' type='button' data-action='remove-detected-item' data-index='" + index + "'>Remove</button>" +
      "</div>" +
      expiryNote +
      "<div class='scan-result-item-row'>" +
      "<div><label class='add-field-label' for='scan-result-name-" + index + "'>Name</label><input id='scan-result-name-" + index + "' data-field='name' data-index='" + index + "' value='" + escapeAddText(name) + "' autocomplete='off'></div>" +
      "<div><label class='add-field-label' for='scan-result-quantity-" + index + "'>Qty</label><input id='scan-result-quantity-" + index + "' type='number' min='1' step='1' inputmode='numeric' data-field='quantity' data-index='" + index + "' value='" + escapeAddText(quantity) + "' placeholder='Unknown'></div>" +
      "<div><label class='add-field-label' for='scan-result-unit-" + index + "'>Unit</label><input id='scan-result-unit-" + index + "' data-field='unit' data-index='" + index + "' value='" + escapeAddText(unit) + "' autocomplete='off' placeholder='piece'></div>" +
      "</div>" +
      "</div>";
  }).join("");
}

function parseDetectedQuantity(value) {
  var parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed);
}

async function confirmDetectedItems() {
  var message = document.getElementById("camera-message");
  var resultPanel = document.getElementById("scan-result");

  if (addPendingScanSubmitting) return;
  if (!addPendingScanItems.length) {
    message.textContent = "No detected items to add yet.";
    return;
  }

  var selected = [];
  for (var i = 0; i < addPendingScanItems.length; i++) {
    var item = addPendingScanItems[i];
    var name = String(item.name || "").trim();
    var quantity = parseDetectedQuantity(item.quantity);
    if (!name) continue;
    if (quantity == null) {
      message.textContent = "Enter a valid quantity for \"" + name + "\" before adding it.";
      return;
    }
    selected.push({
      name: name,
      quantity: quantity,
      unit: String(item.unit || "").trim(),
      expiryDate: item.expiryDate || "",
      expiryDateSource: item.expiryDateSource || "unknown",
      pendingItem: item
    });
  }

  if (!selected.length) {
    message.textContent = "No confirmed items remain. Remove or correct the detected items and try again.";
    return;
  }

  addPendingScanSubmitting = true;
  message.textContent = "Adding detected items...";

  try {
    for (var j = 0; j < selected.length; j++) {
      await api.scan(
        selected[j].name,
        selected[j].quantity,
        selected[j].unit || "",
        selected[j].expiryDate,
        selected[j].expiryDateSource,
        selected[j].expiryDateSource === "printed"
      );
      // Keep only unsaved items available if a later POST fails.
      var savedIndex = addPendingScanItems.indexOf(selected[j].pendingItem);
      if (savedIndex !== -1) addPendingScanItems.splice(savedIndex, 1);
    }
    addPendingScanItems = [];
    renderDetectedScanItems();
    resultPanel.hidden = true;
    show("fridge", selected.length + " item" + (selected.length === 1 ? "" : "s") + " added to your fridge!");
  } catch (error) {
    renderDetectedScanItems();
    message.textContent = error && error.message ? error.message : "Could not add the detected items to your fridge.";
  } finally {
    addPendingScanSubmitting = false;
  }
}

async function recognizeAddPhoto() {
  var message = document.getElementById("camera-message");
  var photo = document.getElementById("camera-photo");
  var resultPanel = document.getElementById("scan-result");
  var usePhotoButton = document.querySelector("[data-action='use-photo']");

  if (!photo || !photo.src || photo.hidden) {
    message.textContent = "Capture an image before identifying an item.";
    return;
  }

  addPendingScanSubmitting = false;
  resultPanel.hidden = true;
  usePhotoButton.disabled = true;
  message.textContent = "Identifying items...";

  try {
    var imageResponse = await fetch(photo.src);
    var imageBlob = await imageResponse.blob();
    var formData = new FormData();
    formData.append("image", imageBlob, "capture.jpg");

    var response = await fetch("http://127.0.0.1:8000/scan", {
      method: "POST",
      body: formData
    });
    var result = await response.json();
    if (!response.ok) {
      throw new Error(result.detail || "Gemini could not identify this image.");
    }
    if (!result || !Array.isArray(result.items)) {
      throw new Error("Gemini returned an unusable result. Try another image.");
    }

    addPendingScanItems = result.items.filter(function (item) {
      return item && typeof item.name === "string" && item.name.trim();
    }).map(function (item) {
      return {
        name: String(item.name).trim(),
        quantity: item.quantity == null ? null : Number(item.quantity),
        unit: item.unit ? String(item.unit).trim() : "",
        expiryDate: item.expiry_date ? String(item.expiry_date) : "",
        expiryDateSource: item.expiry_date_source || "unknown"
      };
    });

    renderDetectedScanItems();
    resultPanel.hidden = false;

    if (!addPendingScanItems.length) {
      message.textContent = "No food item was clearly identified. Retake the photo or add it manually.";
      return;
    }

    message.textContent = addPendingScanItems.length === 1
      ? "Gemini found one item. Review and confirm it before adding it to your fridge."
      : "Gemini found " + addPendingScanItems.length + " items. Review and confirm them before adding to your fridge.";
  } catch (error) {
    addPendingScanItems = [];
    renderDetectedScanItems();
    message.textContent = error instanceof TypeError
      ? "Cannot reach the backend. Check that FastAPI is running."
      : error.message;
  } finally {
    usePhotoButton.disabled = false;
  }
}

async function openAddCamera() {
  var message = document.getElementById("camera-message");
  var openButton = document.querySelector("[data-action='open-camera']");
  var requestId = ++addCameraRequest;

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    message.textContent = "Camera access requires localhost or HTTPS in a supported browser.";
    return;
  }

  openButton.disabled = true;
  openButton.textContent = "Opening camera...";
  message.textContent = "";

  try {
    var stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } },
      audio: false
    });
    if (requestId !== addCameraRequest || !document.getElementById("camera-video")) {
      stream.getTracks().forEach(function (track) { track.stop(); });
      return;
    }

    addCameraStream = stream;
    var video = document.getElementById("camera-video");
    video.srcObject = stream;
    document.getElementById("camera-placeholder").hidden = true;
    video.hidden = false;
    openButton.hidden = true;
    document.querySelector("[data-action='capture']").hidden = false;
    await video.play();
  } catch (err) {
    if (requestId !== addCameraRequest) return;
    openButton.disabled = false;
    openButton.textContent = "Open Camera";
    if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
      message.textContent = "Camera permission was denied. Allow camera access in your browser settings and try again.";
    } else if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
      message.textContent = "No camera was found on this device.";
    } else {
      message.textContent = "The camera could not be opened. Check that it is available and try again.";
    }
  }
}

function captureAddPhoto() {
  var video = document.getElementById("camera-video");
  var message = document.getElementById("camera-message");
  if (!video || !video.videoWidth || !video.videoHeight) {
    message.textContent = "Wait for the camera preview, then try again.";
    return;
  }

  var canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
  document.getElementById("camera-photo").src = canvas.toDataURL("image/jpeg", 0.9);
  video.hidden = true;
  document.getElementById("camera-photo").hidden = false;
  document.querySelector("[data-action='capture']").hidden = true;
  document.querySelector("[data-action='retake']").hidden = false;
  document.querySelector("[data-action='use-photo']").hidden = false;
  message.textContent = "";
}

async function retakeAddPhoto() {
  document.getElementById("camera-photo").hidden = true;
  document.querySelector("[data-action='retake']").hidden = true;
  document.querySelector("[data-action='use-photo']").hidden = true;
  if (!addCameraStream) {
    await openAddCamera();
    return;
  }
  document.getElementById("camera-video").hidden = false;
  document.querySelector("[data-action='capture']").hidden = false;
}

function stopAddCamera() {
  addCameraRequest += 1;
  if (addCameraStream) {
    addCameraStream.getTracks().forEach(function (track) { track.stop(); });
    addCameraStream = null;
  }

  var video = document.getElementById("camera-video");
  if (!video) return;
  video.pause();
  video.srcObject = null;
  video.hidden = true;
  document.getElementById("camera-photo").removeAttribute("src");
  document.getElementById("camera-photo").hidden = true;
  document.getElementById("camera-placeholder").hidden = false;
  document.getElementById("camera-message").textContent = "";
  document.querySelector("[data-action='open-camera']").hidden = false;
  document.querySelector("[data-action='open-camera']").disabled = false;
  document.querySelector("[data-action='open-camera']").textContent = "Open Camera";
  document.querySelector("[data-action='capture']").hidden = true;
  document.querySelector("[data-action='retake']").hidden = true;
  document.querySelector("[data-action='use-photo']").hidden = true;
}

document.addEventListener("toggle", function (event) {
  if (event.target.id === "scan-details" && !event.target.open) stopAddCamera();
}, true);

document.addEventListener("change", async function (event) {
  if (event.target.id === "add-kind") {
    addSelectedKind = event.target.value;
    document.getElementById("leftover-fields").hidden = addSelectedKind !== "leftover";
    document.getElementById("leftover-existing-container").hidden = addSelectedKind !== "leftover";
    addSelectedExistingId = null;
    if (addSelectedKind === "leftover" && !addDetectedItems.length) {
      try {
        addDetectedItems = (await api.getInventory()).filter(function (item) { return item.category !== "leftover"; });
        document.getElementById("leftover-existing-container").innerHTML = existingLeftoverPicker();
      } catch (error) {
        addDetectedItems = [];
      }
    }
  }
  if (event.target.id === "leftover-existing") {
    var selectedIndex = event.target.value === "" ? -1 : Number(event.target.value);
    var selected = addDetectedItems[selectedIndex];
    addSelectedExistingId = selected ? selected.id || selected.name : null;
    if (selected) {
      document.getElementById("add-name").value = selected.name;
      document.getElementById("add-qty").value = selected.qty;
      document.getElementById("add-unit").value = selected.unit || "serving";
      document.getElementById("add-prepared-at").value = addDateTimeValue(selected.preparedAt || "");
      document.getElementById("add-location").value = selected.location || "";
    }
  }
});
