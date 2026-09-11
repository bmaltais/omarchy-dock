# Omarchy Dock: specification

Agreed on 2026-09-11 after a design interview. Vocabulary is defined in [CONTEXT.md](../CONTEXT.md); capitalised terms below refer to it.

## Identity

- Omarchy shell plugin, id `bernard.dock`, display name "Dock", licence MIT.
- Kind `service` with `keepLoaded: true`; the plugin owns its own layer-shell surfaces.
- This repository's root is the plugin directory (`manifest.json` at the root), so `omarchy plugin add <git-url>` installs it. For development, symlink the checkout into `~/.config/omarchy/plugins/bernard.dock/` so the shell hot-reloads on save.
- Personal project, published so others can use it.

## What the Dock shows

- One Dock per monitor, bottom centre. Every Dock shows the same Items.
- One Window Item per Window, across all workspaces and all monitors, including special workspaces.
- A Window whose App cannot be resolved shows a Letter Tile and cannot be pinned.
- Pins: an App kept in the Dock whether or not it has Windows. A Pin holds a slot; while its App has Windows their Window Items occupy that slot, otherwise the Pin is shown and launches the App on click. A Pin whose App is no longer installed shows a Letter Tile with a "missing" tooltip and stays until unpinned.
- Ordering: Launch Order, with a new Window joining the Window Items of its own App. Any Item may be dragged to a Placed position; a Placed Pin keeps it permanently, a Placed Window Item until the Window closes. Dragging one Window of a pinned App moves only that Window.
- Indicators: Active Window highlight, running dot on every Window Item, workspace badge on every Window Item, tooltip with title and workspace, urgent-colour tint for Attention. No magnification.
- Overflow: icons shrink until every Item fits the monitor width.
- Colours and fonts come from the current Omarchy theme and follow theme switches live.

## How the Dock behaves

- Default state Hidden. The Reveal Strip spans the full bottom edge of each monitor, above any space the bar reserves. Pointer resting on it for the reveal delay (default 200 ms) makes the Dock Revealed; the Dock returns to Hidden after the hide delay (default 300 ms) once the pointer leaves it. Reveal slides up from the edge in about 150 ms.
- The Dock stays Revealed while its context menu is open and for the whole of a drag; the hide timer starts after the drop or menu close.
- The Dock floats on the Top layer and never reserves screen space, so fullscreen windows cover it.
- Position is fixed at the bottom in version one.
- Attention never reveals the Dock by itself.

## Input

- Left click on a Window Item: focus the Window, switching workspace and monitor as needed; a special-workspace Window is toggled into view. Clicking the Active Window's Item does nothing.
- Left click on a Pin with no Windows: launch the App.
- Middle click on any Item with a resolvable App: launch a new instance.
- Right click: menu with exactly Pin/Unpin, New Window, Close Window. Pin is disabled on Letter Tile Items.
- Drag within the Dock: reorder (see Placed). Drag out of the Dock: unpin the Item's App if pinned, otherwise snap back.
- The Dock never takes keyboard focus.

## Configuration

Stored in the Dock's entry in Omarchy's shell config (`~/.config/omarchy/shell.json`, `plugins[]`), written through the shell's plugin write-back hook. Keys: icon size, reveal delay, hide delay, Pins with their Placed order. Nothing else is configurable in version one.

## Out of scope for version one

Pinned-only launcher mode, minimise-to-special-workspace on second click, configurable position, per-monitor enable, keyboard toggle, scripted tests.

## Verification

Manual checklist kept in the README, walked through after each milestone on a two-monitor Omarchy 4 machine.

## Milestones

1. Static Dock: Window Items with icons on both monitors, click to focus.
2. Auto-hide: Reveal Strip, Hidden/Revealed, slide animation.
3. Indicators: Active highlight, running dots, workspace badge, tooltip, Attention tint.
4. Pins, context menu, middle click, drag to reorder, settings.
5. README with checklist, publish.
