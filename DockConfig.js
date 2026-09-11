// Dock settings (see docs/SPEC.md "Configuration"; vocabulary in CONTEXT.md).
// No Quickshell or QML imports, so the exact same file loads as a JS import
// inside the shell and via `require` under Node for the test suite, same as
// DockModel.js.
//
// Settings live in the Dock's own entry in the shell config's `plugins[]`
// array: `{ id: "bernard.dock", iconSize, revealDelayMs, hideDelayMs, pins }`.
// findPluginEntry locates that entry (or null if the Dock has never been
// enabled or the config can't be read); effectiveSettings turns it into the
// three settings the Dock actually uses, defaulting anything missing or not
// a usable positive number. effectivePins reads the same entry's `pins`
// (the ordered array of App ids DockModel.js's buildDockItems takes),
// cleaned of anything a hand edit could leave unusable — not a string, or
// a duplicate that would give two slots to the same App. effectivePlacements
// reads the entry's `placements` (a Placed Pin's `{ key, index }`,
// CONTEXT.md "Placed"; DockModel.js's placeAt/unplace compute the next
// value for a write-back) — only entries keyed "pin:...", since a Placed
// Window Item's position (docs/SPEC.md "Ordering") lives only in memory
// for as long as its Window stays open and is never written here.
// mergeSettings folds a settings change onto the raw entry rather than
// replacing it outright, so keys a change doesn't mention (pins and
// placements included, when the change is only to icon size or a delay)
// survive a write-back.

var DEFAULT_ICON_SIZE = 48;
var DEFAULT_REVEAL_DELAY_MS = 200;
var DEFAULT_HIDE_DELAY_MS = 300;

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function positiveNumberOr(value, fallback) {
  var number = Number(value);
  return isFinite(number) && number > 0 ? number : fallback;
}

function findPluginEntry(shellConfig, pluginId) {
  var plugins =
    isPlainObject(shellConfig) && Array.isArray(shellConfig.plugins)
      ? shellConfig.plugins
      : [];
  for (var i = 0; i < plugins.length; i++) {
    if (isPlainObject(plugins[i]) && plugins[i].id === pluginId) {
      return plugins[i];
    }
  }
  return null;
}

function effectiveSettings(entry) {
  var source = isPlainObject(entry) ? entry : {};
  return {
    iconSize: positiveNumberOr(source.iconSize, DEFAULT_ICON_SIZE),
    revealDelayMs: positiveNumberOr(
      source.revealDelayMs,
      DEFAULT_REVEAL_DELAY_MS,
    ),
    hideDelayMs: positiveNumberOr(source.hideDelayMs, DEFAULT_HIDE_DELAY_MS),
  };
}

function effectivePins(entry) {
  var source = isPlainObject(entry) ? entry : {};
  var rawPins = Array.isArray(source.pins) ? source.pins : [];
  var seen = {};
  var pins = [];
  for (var i = 0; i < rawPins.length; i++) {
    var id = rawPins[i];
    if (typeof id === "string" && id.length > 0 && !seen[id]) {
      seen[id] = true;
      pins.push(id);
    }
  }
  return pins;
}

function effectivePlacements(entry) {
  var source = isPlainObject(entry) ? entry : {};
  var rawPlacements = Array.isArray(source.placements) ? source.placements : [];
  var seen = {};
  var placements = [];
  for (var i = 0; i < rawPlacements.length; i++) {
    var candidate = rawPlacements[i];
    if (!isPlainObject(candidate)) continue;
    var key = candidate.key;
    var index = Number(candidate.index);
    if (typeof key !== "string" || key.indexOf("pin:") !== 0) continue;
    if (seen[key]) continue;
    if (!isFinite(index) || index < 0) continue;
    seen[key] = true;
    placements.push({ key: key, index: Math.floor(index) });
  }
  return placements;
}

function mergeSettings(entry, patch) {
  var next = {};
  var source = isPlainObject(entry) ? entry : {};
  var updates = isPlainObject(patch) ? patch : {};
  for (var key in source) next[key] = source[key];
  for (var patchKey in updates) next[patchKey] = updates[patchKey];
  return next;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    DEFAULT_ICON_SIZE: DEFAULT_ICON_SIZE,
    DEFAULT_REVEAL_DELAY_MS: DEFAULT_REVEAL_DELAY_MS,
    DEFAULT_HIDE_DELAY_MS: DEFAULT_HIDE_DELAY_MS,
    findPluginEntry: findPluginEntry,
    effectiveSettings: effectiveSettings,
    effectivePins: effectivePins,
    effectivePlacements: effectivePlacements,
    mergeSettings: mergeSettings,
  };
}
