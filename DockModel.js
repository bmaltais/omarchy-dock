// Pure Dock model (see docs/SPEC.md, milestones M2-M4; vocabulary in
// CONTEXT.md). No Quickshell or QML imports, so the exact same file loads
// as a JS import inside the shell and via `require` under Node for the
// test suite. This ticket adds Pins: an App kept in the Dock whether or
// not it has Windows. Placed positions (drag to reorder) extend
// `buildDockItems` in a later ticket.
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

function toWindowItem(window, app) {
  return {
    kind: "window",
    window: window,
    app: app,
    letter: app ? null : window.class ? window.class.charAt(0) : "",
    active: !!window.active,
    attention: !!window.attention,
    badge: badgeFor(window.workspace),
    // A Letter Tile Window can't be pinned (CONTEXT.md "Pin" needs an App
    // to hold a slot for); an already-pinned Window is still pinnable
    // here; the menu ticket tells "Pin" from "Unpin" by checking the
    // Pins list itself, not this flag.
    pinnable: !!app,
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
function buildWindowItems(windows, resolveApp) {
  var ordered = windows.slice().sort(function (a, b) {
    return a.openedAt - b.openedAt;
  });

  var items = [];
  var groupEnd = {};

  for (var i = 0; i < ordered.length; i++) {
    var window = ordered[i];
    var app = resolveWindowApp(window, resolveApp);
    var groupKey = groupKeyFor(window, app);
    var item = toWindowItem(window, app);

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

// Builds the Dock's Items: a Pin Item, or its App's own Window Items in
// Launch Order, for every Pin in the order `pins` lists them — CONTEXT.md's
// "Placed" is specifically a dragged-to position, which Pins don't have
// until a later ticket adds the drag gesture; until then this is simply
// the order the Pins list persists them in — followed by every other
// Window in Launch Order (docs/SPEC.md, "Ordering"). `pins` and
// `resolveAppById` are optional; without them this is Launch Order alone,
// unchanged from before Pins existed.
function buildDockItems(windows, resolveApp, pins, resolveAppById) {
  var pinIds = Array.isArray(pins) ? pins : [];
  if (pinIds.length === 0) return buildWindowItems(windows, resolveApp);

  var resolvePinnedApp = typeof resolveAppById === "function"
    ? resolveAppById
    : function () {
        return null;
      };
  var partitioned = partitionByPin(windows, resolveApp, pinIds);

  var items = [];
  for (var s = 0; s < pinIds.length; s++) {
    var windowsForSlot = partitioned.pinnedSlots[s];
    if (windowsForSlot.length > 0) {
      items = items.concat(buildWindowItems(windowsForSlot, resolveApp));
    } else {
      items.push(toPinItem(pinIds[s], resolvePinnedApp(pinIds[s])));
    }
  }

  return items.concat(buildWindowItems(partitioned.unpinned, resolveApp));
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { buildDockItems: buildDockItems };
}
