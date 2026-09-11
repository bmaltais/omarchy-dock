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
