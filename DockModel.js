// Pure Dock model (see docs/SPEC.md, milestones M2-M4; vocabulary in
// CONTEXT.md). No Quickshell or QML imports, so the exact same file loads
// as a JS import inside the shell and via `require` under Node for the
// test suite.
//
// Placed positions (CONTEXT.md "Placed"; docs/SPEC.md "Ordering" and
// "Input"): every Item carries a stable `key` ("pin:<appId>" for a Pin
// Item, "window:<windowId>" for a Window Item). `placements` is an
// optional array of `{ key, index }` recording the absolute slot a drag
// dropped that key at; `buildDockItems` applies it as a final pass over
// the Launch-Order/Pin-slot arrangement below, via `applyPlacements`. A
// Placed Pin's `{ key, index }` is meant to be persisted (DockConfig.js)
// so it survives a restart; a Placed Window Item's is meant to be kept
// only in memory for as long as its Window stays open — buildDockItems
// itself doesn't care which, since a placement whose key matches nothing
// currently on the Dock (a closed Window, a Pin not currently shown
// because its App has Windows) is simply ignored, which is exactly what
// lets a Placed Pin's slot reassert itself the moment its bare Pin Item
// reappears. `placeAt`/`unplace` compute the next `placements` array for
// the drag gesture (which lives in Service.qml) to persist or hold.
//
// A Window is `{ id, class, workspace, openedAt, title, active, attention }`.
// `openedAt` is a monotonically increasing value (timestamp or counter)
// recording when the Window appeared; it is what Launch Order sorts by.
// `title` is passed through onto the Item for the Quickshell side's
// tooltip; the model itself has no use for it. `active` is true for the
// Active Window (CONTEXT.md); `attention` is true while the Window is
// requesting Attention. Both default to falsy when omitted. `resolveApp(window)`
// returns the matching App (an object with at least an `id`) or a falsy
// value when the Window's App cannot be identified.
//
// `pins` is the Dock's persisted Pins list (CONTEXT.md "Pin"): an ordered
// array of App ids, each holding a slot at its index. `resolveAppById(id)`
// resolves a Pin's own App id directly (as opposed to `resolveApp`, which
// resolves a Window's App from its class) and returns a falsy value when
// that App is no longer installed. Both `pins` and `resolveAppById` are
// optional; omitting them (as every pre-Pins caller does) reproduces the
// exact Launch-Order-only behaviour from before this ticket.
//
// A Pin's slot holds its own Window Items — in Launch Order among
// themselves — for as long as its App has any open Windows, and falls
// back to a single Pin Item (CONTEXT.md "Pin") the moment it doesn't. Pins
// occupy the Dock's leading slots in their persisted order; every Window
// belonging to an unpinned App follows in Launch Order, exactly as
// buildDockItems ordered every Window before Pins existed.

var SPECIAL_WORKSPACE_PREFIX = "special:";

function groupKeyFor(window, app) {
  return app ? "app:" + app.id : "class:" + window.class;
}

// resolveApp(window) is only ever used through this, so every caller sees
// the same falsy-to-null normalization instead of each repeating it.
function resolveWindowApp(window, resolveApp) {
  return resolveApp(window) || null;
}

// The workspace badge (docs/SPEC.md "Indicators"): the workspace name
// as-is for a regular workspace, or the special workspace's own name with
// Hyprland's "special:" prefix stripped.
function badgeFor(workspace) {
  var name = workspace || "";
  if (name.indexOf(SPECIAL_WORKSPACE_PREFIX) === 0) {
    return name.slice(SPECIAL_WORKSPACE_PREFIX.length) || name;
  }
  return name;
}

function toWindowItem(window, app, pinned) {
  return {
    kind: "window",
    key: "window:" + window.id,
    window: window,
    app: app,
    letter: app ? null : window.class ? window.class.charAt(0) : "",
    active: !!window.active,
    attention: !!window.attention,
    badge: badgeFor(window.workspace),
    // A Letter Tile Window can't be pinned (CONTEXT.md "Pin" needs an App
    // to hold a slot for).
    pinnable: !!app,
    // True for a Window Item occupying a Pin's slot (CONTEXT.md "Pin"):
    // its App is already pinned, so the menu shows Unpin rather than Pin.
    pinned: !!pinned,
  };
}

// The Pin Item shown in place of its Window Items once the last of them
// closes (CONTEXT.md "Pin"). `app` is the Pin's own App resolved directly
// by id, independent of any Window; a falsy `app` means the App is no
// longer installed, so `missing` drives the "missing" tooltip and the
// Letter Tile falls back to the Pin's own id the way a Window's Letter
// Tile falls back to its window class.
function toPinItem(pinId, app) {
  return {
    kind: "pin",
    key: "pin:" + pinId,
    appId: pinId,
    app: app || null,
    letter: app ? null : pinId ? pinId.charAt(0) : "",
    missing: !app,
    active: false,
    attention: false,
    badge: "",
  };
}

// Returns Window Items in Launch Order: windows are replayed oldest
// `openedAt` first, and each new Window is inserted right after the last
// Item of its own App (or, for a Window whose App can't be resolved, the
// last Item sharing its window class) instead of at the end of the list.
function buildWindowItems(windows, resolveApp, pinned) {
  var ordered = windows.slice().sort(function (a, b) {
    return a.openedAt - b.openedAt;
  });

  var items = [];
  var groupEnd = {};

  for (var i = 0; i < ordered.length; i++) {
    var window = ordered[i];
    var app = resolveWindowApp(window, resolveApp);
    var groupKey = groupKeyFor(window, app);
    var item = toWindowItem(window, app, pinned);

    var insertAt =
      groupKey in groupEnd ? groupEnd[groupKey] + 1 : items.length;
    items.splice(insertAt, 0, item);

    for (var key in groupEnd) {
      if (groupEnd[key] >= insertAt) {
        groupEnd[key] += 1;
      }
    }
    groupEnd[groupKey] = insertAt;
  }

  return items;
}

// Splits windows into the ones whose App is a Pin (bucketed by which Pin,
// preserving Pins' own order) and the rest, by resolved App id — the same
// identity buildWindowItems's own grouping already keys Window Items on.
function partitionByPin(windows, resolveApp, pinIds) {
  var slotIndexById = {};
  for (var i = 0; i < pinIds.length; i++) slotIndexById[pinIds[i]] = i;

  var pinnedSlots = pinIds.map(function () {
    return [];
  });
  var unpinned = [];

  for (var w = 0; w < windows.length; w++) {
    var window = windows[w];
    var app = resolveWindowApp(window, resolveApp);
    var slot = app ? slotIndexById[app.id] : undefined;
    if (slot !== undefined) pinnedSlots[slot].push(window);
    else unpinned.push(window);
  }

  return { pinnedSlots: pinnedSlots, unpinned: unpinned };
}

// Applies Placed positions (CONTEXT.md "Placed") as a final pass over an
// already-ordered Items array. Each `{ key, index }` in `placements` whose
// key matches a current Item pulls that Item out of its default slot;
// every such Item is then reinserted, ascending by its recorded `index`
// (ties keep `placements`' own order), clamped to the list's bounds so a
// stale index from before other Items came or went still lands somewhere
// sane rather than being dropped. Items with no matching placement keep
// their existing relative order around the reinserted ones. A placement
// whose key matches nothing (a closed Window, a Pin currently hidden
// behind its App's own Window Items) is silently ignored — this is what
// lets a Placed Pin's slot reassert itself the moment the bare Pin Item
// reappears, with no restart-detection logic needed here at all.
function applyPlacements(items, placements) {
  var list = Array.isArray(placements) ? placements : [];
  if (list.length === 0) return items;

  var byKey = {};
  for (var i = 0; i < items.length; i++) byKey[items[i].key] = items[i];

  var placedEntries = [];
  for (var p = 0; p < list.length; p++) {
    var entry = list[p];
    var item = entry && typeof entry.key === "string" ? byKey[entry.key] : null;
    if (item) placedEntries.push({ item: item, index: Number(entry.index) || 0 });
  }
  if (placedEntries.length === 0) return items;

  placedEntries.sort(function (a, b) {
    return a.index - b.index;
  });

  var placedKeys = {};
  for (var k = 0; k < placedEntries.length; k++) {
    placedKeys[placedEntries[k].item.key] = true;
  }

  var result = [];
  for (var r = 0; r < items.length; r++) {
    if (!placedKeys[items[r].key]) result.push(items[r]);
  }

  for (var e = 0; e < placedEntries.length; e++) {
    var target = Math.max(0, Math.min(placedEntries[e].index, result.length));
    result.splice(target, 0, placedEntries[e].item);
  }

  return result;
}

// Builds the Dock's Items: a Pin Item, or its App's own Window Items in
// Launch Order, for every Pin in the order `pins` lists them, followed by
// every other Window in Launch Order (docs/SPEC.md, "Ordering") — then
// `placements` (CONTEXT.md "Placed") is applied over that as a final pass.
// `pins`, `resolveAppById`, and `placements` are all optional; without
// them this is Launch Order alone, unchanged from before Pins existed.
function buildDockItems(windows, resolveApp, pins, resolveAppById, placements) {
  var pinIds = Array.isArray(pins) ? pins : [];
  var items;

  if (pinIds.length === 0) {
    items = buildWindowItems(windows, resolveApp);
  } else {
    var resolvePinnedApp = typeof resolveAppById === "function"
      ? resolveAppById
      : function () {
          return null;
        };
    var partitioned = partitionByPin(windows, resolveApp, pinIds);

    items = [];
    for (var s = 0; s < pinIds.length; s++) {
      var windowsForSlot = partitioned.pinnedSlots[s];
      if (windowsForSlot.length > 0) {
        items = items.concat(buildWindowItems(windowsForSlot, resolveApp, true));
      } else {
        items.push(toPinItem(pinIds[s], resolvePinnedApp(pinIds[s])));
      }
    }

    items = items.concat(buildWindowItems(partitioned.unpinned, resolveApp));
  }

  return applyPlacements(items, placements);
}

// The context menu's state for an Item (docs/SPEC.md "Input": "Right
// click: menu with exactly Pin/Unpin, New Window, Close Window. Pin is
// disabled on Letter Tile Items"). `pinned` tells Pin from Unpin: always
// true for a Pin Item (CONTEXT.md "Pin"), true for a Window Item occupying
// one's slot. `canPin` is false only for a Letter Tile Window Item, which
// has no App to hold a slot for — a Pin keeps Unpin enabled even once its
// own App goes missing, since Unpin is the only way to remove it.
// `canLaunch` mirrors "New Window launches another instance": there must
// be a resolved App to launch. `canClose` is true only for a Window Item;
// a bare Pin has no Window to close.
function menuFor(item) {
  var pinned = item.kind === "pin" || !!item.pinned;
  return {
    pinned: pinned,
    canPin: item.kind === "pin" ? true : !!item.pinnable,
    canLaunch: !!item.app,
    canClose: item.kind === "window",
  };
}

// The Dock's Pins list after Pin/Unpin (docs/SPEC.md "Input", the context
// menu): appends `appId` when Pin is chosen and it isn't pinned yet, drops
// it when Unpin is chosen, and otherwise leaves `pins` alone — a hand edit
// that already added or removed it, or a stale menu click, is a no-op
// rather than a duplicate slot or a second removal.
function nextPins(pins, appId, pinned) {
  var index = pins.indexOf(appId);
  if (pinned) {
    if (index === -1) return pins.slice();
    var withoutId = pins.slice();
    withoutId.splice(index, 1);
    return withoutId;
  }
  if (index !== -1) return pins.slice();
  return pins.concat([appId]);
}

// The Dock's `placements` after a within-Dock drop (docs/SPEC.md "Input":
// "Drag within the Dock: reorder"; CONTEXT.md "Placed"): drops `key`'s
// previous placement, if any, then records it at `index` — a re-drag of
// an already-Placed Item moves it rather than stacking a second entry.
function placeAt(placements, key, index) {
  var list = unplace(placements, key);
  list.push({ key: key, index: index });
  return list;
}

// The Dock's `placements` after Unplacing `key` (docs/SPEC.md "Input":
// unpinning an App drops its own Pin's Placed position along with it —
// see Service.qml's drag-out handling). A no-op when `key` was never
// Placed.
function unplace(placements, key) {
  var list = Array.isArray(placements) ? placements : [];
  return list.filter(function (entry) {
    return !entry || entry.key !== key;
  });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    buildDockItems: buildDockItems,
    menuFor: menuFor,
    nextPins: nextPins,
    placeAt: placeAt,
    unplace: unplace,
  };
}
