// Pure Dock model (see docs/SPEC.md, milestones M2-M3; vocabulary in
// CONTEXT.md). No Quickshell or QML imports, so the exact same file loads
// as a JS import inside the shell and via `require` under Node for the
// test suite. This ticket adds the Active and Attention flags and the
// workspace badge to Window Items; Pins and Placed positions extend
// `buildDockItems` in later tickets.
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

var SPECIAL_WORKSPACE_PREFIX = "special:";

function groupKeyFor(window, app) {
  return app ? "app:" + app.id : "class:" + window.class;
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
  };
}

// Returns Window Items in Launch Order: windows are replayed oldest
// `openedAt` first, and each new Window is inserted right after the last
// Item of its own App (or, for a Window whose App can't be resolved, the
// last Item sharing its window class) instead of at the end of the list.
function buildDockItems(windows, resolveApp) {
  var ordered = windows.slice().sort(function (a, b) {
    return a.openedAt - b.openedAt;
  });

  var items = [];
  var groupEnd = {};

  for (var i = 0; i < ordered.length; i++) {
    var window = ordered[i];
    var app = resolveApp(window) || null;
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

if (typeof module !== "undefined" && module.exports) {
  module.exports = { buildDockItems: buildDockItems };
}
