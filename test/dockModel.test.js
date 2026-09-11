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

test("the Active Window's Item carries the Active flag, every other Item does not", () => {
  const windows = [
    makeWindow({ id: "w1", openedAt: 1, active: true }),
    makeWindow({ id: "w2", openedAt: 2 }),
  ];

  const items = buildDockItems(windows, () => null);

  assert.equal(items[0].active, true);
  assert.equal(items[1].active, false);
});

test("a Window requesting Attention has its Item carry the Attention flag", () => {
  const windows = [
    makeWindow({ id: "w1", openedAt: 1, attention: true }),
    makeWindow({ id: "w2", openedAt: 2 }),
  ];

  const items = buildDockItems(windows, () => null);

  assert.equal(items[0].attention, true);
  assert.equal(items[1].attention, false);
});

test("a Window Item's workspace badge is the workspace name for a regular workspace", () => {
  const windows = [makeWindow({ id: "w1", workspace: "3", openedAt: 1 })];

  const items = buildDockItems(windows, () => null);

  assert.equal(items[0].badge, "3");
});

test("a Window Item's workspace badge is the special workspace's own name, without Hyprland's \"special:\" prefix", () => {
  const windows = [
    makeWindow({ id: "w1", workspace: "special:scratchpad", openedAt: 1 }),
  ];

  const items = buildDockItems(windows, () => null);

  assert.equal(items[0].badge, "scratchpad");
});

function describeItem(item) {
  return item.kind === "pin" ? `pin:${item.appId}` : `window:${item.window.id}`;
}

function describeItems(items) {
  return items.map(describeItem);
}

test("a Window Item resolved to an App is reported as pinnable", () => {
  const windows = [makeWindow({ id: "w1", class: "firefox" })];

  const items = buildDockItems(windows, resolveBrowserAndTerminal);

  assert.equal(items[0].pinnable, true);
});

test("a Letter Tile Window Item is reported as not pinnable", () => {
  const windows = [makeWindow({ id: "w1", class: "Unknown-Editor" })];

  const items = buildDockItems(windows, () => null);

  assert.equal(items[0].pinnable, false);
});

test("a Pin with no Windows shows its App without a Letter Tile and isn't missing", () => {
  const items = buildDockItems(
    [],
    () => null,
    ["firefox"],
    (id) => ({ id, icon: "firefox-icon" }),
  );

  assert.deepEqual(describeItems(items), ["pin:firefox"]);
  assert.equal(items[0].app.id, "firefox");
  assert.equal(items[0].letter, null);
  assert.equal(items[0].missing, false);
});

test("while a pinned App has Windows, their Window Items occupy the Pin's slot instead of a bare Pin", () => {
  const windows = [makeWindow({ id: "firefox-1", class: "firefox" })];

  const items = buildDockItems(
    windows,
    resolveBrowserAndTerminal,
    ["firefox"],
    (id) => ({ id }),
  );

  assert.deepEqual(describeItems(items), ["window:firefox-1"]);
});

test("multiple Windows of a pinned App occupy its slot together, in Launch Order", () => {
  const windows = [
    makeWindow({ id: "firefox-2", class: "firefox", openedAt: 2 }),
    makeWindow({ id: "firefox-1", class: "firefox", openedAt: 1 }),
  ];

  const items = buildDockItems(
    windows,
    resolveBrowserAndTerminal,
    ["firefox"],
    (id) => ({ id }),
  );

  assert.deepEqual(describeItems(items), ["window:firefox-1", "window:firefox-2"]);
});

test("when the last Window of a pinned App closes, the Pin returns at the same slot", () => {
  const resolveAppById = (id) => ({ id });
  const withWindow = buildDockItems(
    [makeWindow({ id: "firefox-1", class: "firefox" })],
    resolveBrowserAndTerminal,
    ["alacritty", "firefox"],
    resolveAppById,
  );
  const withoutWindow = buildDockItems(
    [],
    resolveBrowserAndTerminal,
    ["alacritty", "firefox"],
    resolveAppById,
  );

  assert.deepEqual(describeItems(withWindow), ["pin:alacritty", "window:firefox-1"]);
  assert.deepEqual(describeItems(withoutWindow), ["pin:alacritty", "pin:firefox"]);
});

test("a Pin whose App is no longer installed shows a Letter Tile and is reported as missing", () => {
  const items = buildDockItems([], () => null, ["ghost-app"], () => null);

  assert.equal(items[0].app, null);
  assert.equal(items[0].missing, true);
  assert.equal(items[0].letter, "g");
});

test("Pins occupy the Dock's leading slots in their persisted order, ahead of every unpinned Window in Launch Order", () => {
  const windows = [
    makeWindow({ id: "unpinned-1", class: "btop", openedAt: 1 }),
    makeWindow({ id: "firefox-1", class: "firefox", openedAt: 2 }),
  ];

  const items = buildDockItems(
    windows,
    resolveBrowserAndTerminal,
    ["alacritty", "firefox"],
    (id) => ({ id }),
  );

  assert.deepEqual(describeItems(items), [
    "pin:alacritty",
    "window:firefox-1",
    "window:unpinned-1",
  ]);
});

test("an empty Pins list reproduces plain Launch Order, unchanged from before Pins existed", () => {
  const windows = [
    makeWindow({ id: "w1", class: "firefox", openedAt: 1 }),
    makeWindow({ id: "w2", class: "alacritty", openedAt: 2 }),
  ];

  const withEmptyPins = buildDockItems(windows, resolveBrowserAndTerminal, [], () => null);
  const withoutPinsArgs = buildDockItems(windows, resolveBrowserAndTerminal);

  assert.deepEqual(describeItems(withEmptyPins), describeItems(withoutPinsArgs));
});
