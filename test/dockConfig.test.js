const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  DEFAULT_ICON_SIZE,
  DEFAULT_REVEAL_DELAY_MS,
  DEFAULT_HIDE_DELAY_MS,
  findPluginEntry,
  effectiveSettings,
  effectivePins,
  effectivePlacements,
  mergeSettings,
} = require("../DockConfig.js");

const PLUGIN_ID = "bernard.dock";

test("DockConfig has no Quickshell or QML imports, so Node can load it directly", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "DockConfig.js"),
    "utf8",
  );
  assert.doesNotMatch(source, /^\s*import\s/m);
  assert.equal(typeof findPluginEntry, "function");
  assert.equal(typeof effectiveSettings, "function");
  assert.equal(typeof mergeSettings, "function");
});

test("findPluginEntry finds the Dock's own entry among other plugins", () => {
  const shellConfig = {
    plugins: [{ id: "axel.window-close-buttons" }, { id: PLUGIN_ID, iconSize: 64 }],
  };

  const entry = findPluginEntry(shellConfig, PLUGIN_ID);

  assert.deepEqual(entry, { id: PLUGIN_ID, iconSize: 64 });
});

test("findPluginEntry returns null when the Dock has no entry", () => {
  const shellConfig = { plugins: [{ id: "axel.window-close-buttons" }] };

  assert.equal(findPluginEntry(shellConfig, PLUGIN_ID), null);
});

test("findPluginEntry returns null when the config has no plugins array", () => {
  assert.equal(findPluginEntry({}, PLUGIN_ID), null);
  assert.equal(findPluginEntry(null, PLUGIN_ID), null);
});

test("effectiveSettings defaults to 48px icons, a 200ms reveal delay, and a 300ms hide delay when the entry has no values", () => {
  assert.deepEqual(effectiveSettings(null), {
    iconSize: DEFAULT_ICON_SIZE,
    revealDelayMs: DEFAULT_REVEAL_DELAY_MS,
    hideDelayMs: DEFAULT_HIDE_DELAY_MS,
  });
  assert.deepEqual(effectiveSettings({ id: PLUGIN_ID }), {
    iconSize: DEFAULT_ICON_SIZE,
    revealDelayMs: DEFAULT_REVEAL_DELAY_MS,
    hideDelayMs: DEFAULT_HIDE_DELAY_MS,
  });
});

test("effectiveSettings uses the entry's own values when present", () => {
  const settings = effectiveSettings({
    id: PLUGIN_ID,
    iconSize: 64,
    revealDelayMs: 100,
    hideDelayMs: 500,
  });

  assert.deepEqual(settings, {
    iconSize: 64,
    revealDelayMs: 100,
    hideDelayMs: 500,
  });
});

test("effectiveSettings falls back to defaults for a hand-edited value that isn't a usable positive number", () => {
  const settings = effectiveSettings({
    iconSize: "not-a-number",
    revealDelayMs: -50,
    hideDelayMs: 0,
  });

  assert.deepEqual(settings, {
    iconSize: DEFAULT_ICON_SIZE,
    revealDelayMs: DEFAULT_REVEAL_DELAY_MS,
    hideDelayMs: DEFAULT_HIDE_DELAY_MS,
  });
});

test("mergeSettings folds a patch onto the raw entry without dropping keys the patch doesn't mention", () => {
  const entry = { id: PLUGIN_ID, iconSize: 48, pins: ["firefox"] };

  const merged = mergeSettings(entry, { iconSize: 64 });

  assert.deepEqual(merged, { id: PLUGIN_ID, iconSize: 64, pins: ["firefox"] });
});

test("mergeSettings starts from an empty object when there is no existing entry", () => {
  const merged = mergeSettings(null, { iconSize: 64 });

  assert.deepEqual(merged, { iconSize: 64 });
});

test("effectivePins is empty when the entry has no Pins", () => {
  assert.deepEqual(effectivePins(null), []);
  assert.deepEqual(effectivePins({ id: PLUGIN_ID }), []);
});

test("effectivePins passes through a well-formed Pins list in its persisted order", () => {
  const pins = effectivePins({ id: PLUGIN_ID, pins: ["firefox", "alacritty"] });

  assert.deepEqual(pins, ["firefox", "alacritty"]);
});

test("effectivePins drops a hand-edited entry that isn't a usable App id", () => {
  const pins = effectivePins({
    pins: ["firefox", 42, null, "", "alacritty"],
  });

  assert.deepEqual(pins, ["firefox", "alacritty"]);
});

test("effectivePins dedupes a repeated App id, keeping its first slot", () => {
  const pins = effectivePins({ pins: ["firefox", "alacritty", "firefox"] });

  assert.deepEqual(pins, ["firefox", "alacritty"]);
});

test("effectivePlacements is empty when the entry has no placements", () => {
  assert.deepEqual(effectivePlacements(null), []);
  assert.deepEqual(effectivePlacements({ id: PLUGIN_ID }), []);
});

test("effectivePlacements passes through a well-formed Placed Pin entry", () => {
  const placements = effectivePlacements({
    id: PLUGIN_ID,
    placements: [{ key: "pin:firefox", index: 2 }],
  });

  assert.deepEqual(placements, [{ key: "pin:firefox", index: 2 }]);
});

test("effectivePlacements drops an entry whose key isn't a Placed Pin, since a Placed Window Item is never persisted", () => {
  const placements = effectivePlacements({
    placements: [{ key: "window:w1", index: 0 }, { key: "pin:firefox", index: 1 }],
  });

  assert.deepEqual(placements, [{ key: "pin:firefox", index: 1 }]);
});

test("effectivePlacements drops a hand-edited entry with no usable key or a negative/non-numeric index", () => {
  const placements = effectivePlacements({
    placements: [
      { key: "pin:firefox", index: "not-a-number" },
      { key: "pin:alacritty", index: -1 },
      { key: 42, index: 0 },
      null,
      { key: "pin:btop", index: 3 },
    ],
  });

  assert.deepEqual(placements, [{ key: "pin:btop", index: 3 }]);
});

test("effectivePlacements dedupes a repeated key, keeping its first entry", () => {
  const placements = effectivePlacements({
    placements: [{ key: "pin:firefox", index: 0 }, { key: "pin:firefox", index: 5 }],
  });

  assert.deepEqual(placements, [{ key: "pin:firefox", index: 0 }]);
});
