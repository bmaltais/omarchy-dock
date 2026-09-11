// Pure Dock model (see docs/SPEC.md, milestone M2; vocabulary in
// CONTEXT.md). No Quickshell or QML imports, so the exact same file loads
// as a JS import inside the shell and via `require` under Node for the
// test suite. This ticket covers Window Items only; Pins, Placed
// positions, and flags extend `buildDockItems` in later tickets.
//
// A Window is `{ id, class, workspace, openedAt }`. `openedAt` is a
// monotonically increasing value (timestamp or counter) recording when the
// Window appeared; it is what Launch Order sorts by. `resolveApp(window)`
// returns the matching App (an object with at least an `id`) or a falsy
// value when the Window's App cannot be identified.

function groupKeyFor(window, app) {
  return app ? "app:" + app.id : "class:" + window.class;
}

function toWindowItem(window, app) {
  return {
    kind: "window",
    window: window,
    app: app,
    letter: app ? null : window.class ? window.class.charAt(0) : "",
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
