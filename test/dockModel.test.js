const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { buildDockItems } = require("../DockModel.js");

function makeWindow(overrides) {
  return Object.assign(
    { id: "win", class: "App", workspace: "1", openedAt: 0 },
    overrides,
  );
}

function resolverFor(appsByClass) {
  return function resolveApp(window) {
    return appsByClass[window.class] || null;
  };
}

function itemIds(items) {
  return items.map((item) => item.window.id);
}

const resolveBrowserAndTerminal = resolverFor({
  firefox: { id: "firefox" },
  alacritty: { id: "alacritty" },
});

test("DockModel has no Quickshell or QML imports, so Node can load it directly", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "DockModel.js"),
    "utf8",
  );
  assert.doesNotMatch(source, /^\s*import\s/m);
  assert.equal(typeof buildDockItems, "function");
});

test("Window Items come out in Launch Order", () => {
  const resolveApp = resolveBrowserAndTerminal;
  const windows = [
    makeWindow({ id: "w1", class: "firefox", openedAt: 2 }),
    makeWindow({ id: "w2", class: "alacritty", openedAt: 1 }),
  ];

  const items = buildDockItems(windows, resolveApp);

  assert.deepEqual(itemIds(items), ["w2", "w1"]);
});

test("a new Window joins the Window Items of its own App rather than the end of Launch Order", () => {
  const resolveApp = resolveBrowserAndTerminal;
  const windows = [
    makeWindow({ id: "firefox-1", class: "firefox", openedAt: 1 }),
    makeWindow({ id: "alacritty-1", class: "alacritty", openedAt: 2 }),
    makeWindow({ id: "firefox-2", class: "firefox", openedAt: 3 }),
  ];

  const items = buildDockItems(windows, resolveApp);

  assert.deepEqual(itemIds(items), ["firefox-1", "firefox-2", "alacritty-1"]);
});

test("Launch Order is recomputed from the current Windows, so closing one doesn't strand its App's other Windows", () => {
  const resolveApp = resolveBrowserAndTerminal;
  const windows = [
    makeWindow({ id: "alacritty-1", class: "alacritty", openedAt: 2 }),
    makeWindow({ id: "firefox-2", class: "firefox", openedAt: 3 }),
  ];

  const items = buildDockItems(windows, resolveApp);

  assert.deepEqual(itemIds(items), ["alacritty-1", "firefox-2"]);
});

test("a Window whose App the resolver cannot identify yields a Letter Tile Item showing the first letter of its class", () => {
  const windows = [makeWindow({ id: "w1", class: "Unknown-Editor", openedAt: 1 })];

  const items = buildDockItems(windows, () => undefined);

  assert.equal(items[0].app, null);
  assert.equal(items[0].letter, "U");
});

test("a new Window whose App can't be resolved joins the Letter Tile Items of its own class rather than the end of Launch Order", () => {
  const windows = [
    makeWindow({ id: "unknown-1", class: "Unknown-Editor", openedAt: 1 }),
    makeWindow({ id: "firefox-1", class: "firefox", openedAt: 2 }),
    makeWindow({ id: "unknown-2", class: "Unknown-Editor", openedAt: 3 }),
  ];

  const items = buildDockItems(windows, resolverFor({ firefox: { id: "firefox" } }));

  assert.deepEqual(itemIds(items), ["unknown-1", "unknown-2", "firefox-1"]);
});

test("Windows resolved to an App carry no Letter Tile", () => {
  const windows = [makeWindow({ id: "w1", class: "firefox", openedAt: 1 })];

  const items = buildDockItems(windows, resolverFor({ firefox: { id: "firefox" } }));

  assert.equal(items[0].app.id, "firefox");
  assert.equal(items[0].letter, null);
});

test("Windows on a special workspace are included among the Window Items", () => {
  const windows = [
    makeWindow({ id: "w1", class: "firefox", workspace: "1", openedAt: 1 }),
    makeWindow({
      id: "w2",
      class: "btop",
      workspace: "special:scratchpad",
      openedAt: 2,
    }),
  ];

  const items = buildDockItems(windows, () => null);

  assert.deepEqual(itemIds(items), ["w1", "w2"]);
});
