// Dock service entry point (see docs/SPEC.md, milestones 1-4; vocabulary in
// CONTEXT.md). Owns one layer-shell panel per monitor, each rendering the
// same Items built by DockModel.buildDockItems from live Hyprland state,
// the Dock's own Pins, and this session's Placed positions — Hidden by
// default and Revealed by hovering its Reveal Strip, with the
// Active/Attention/running/workspace indicators from milestone 3, a
// context menu for Pin/Unpin/New Window/Close Window, and drag to reorder
// or drag out to unpin/snap back (CONTEXT.md "Placed").
import QtQuick
import Quickshell
import Quickshell.Io
import Quickshell.Wayland
import Quickshell.Hyprland
import qs.Commons
import qs.Ui
import "DockModel.js" as DockModel
import "DockConfig.js" as DockConfig

Item {
  id: root

  // Injected by omarchy-shell (the first-party/plugin service loader).
  property var shell: null

  // True for the whole of a drag, on any monitor (docs/SPEC.md "Input";
  // set/cleared around Service.qml's drag.onActiveChanged/finishDrag).
  // dockState.refresh() checks this and skips rebuilding dockState.items
  // while it holds: DockModel.buildDockItems always returns fresh Item
  // objects, so any refresh mid-drag — an unrelated Hyprland event fires
  // constantly on a real desktop — would make the Repeater tear down and
  // rebuild every delegate, destroying the very Item whose MouseArea is
  // driving the drag. finishDrag clears this before placeItem/unpinFromDrag
  // so the drop's own refresh (immediate for a Window Item, via the
  // settings write's reload for a Pin) is never the one that gets skipped.
  property bool dragInProgress: false

  // Icon size and auto-hide timing (SPEC.md "How the Dock behaves" and
  // "Configuration"): read from the Dock's own entry in the shell config
  // (dockSettings below) and defaulted by DockConfig when the entry has no
  // values, a value is missing, or a hand edit leaves one unusable.
  // hideDelayMs must comfortably exceed slideDurationMs: the pointer
  // crosses the sliver between the Reveal Strip and the risen Dock while
  // neither is hovered, and the hide timer must not win that race.
  readonly property int iconSize: dockSettings.iconSize
  readonly property int revealDelayMs: dockSettings.revealDelayMs
  readonly property int hideDelayMs: dockSettings.hideDelayMs
  readonly property int slideDurationMs: 150
  // Kept just thick enough to be reliably hoverable; the screen edge itself
  // stops the cursor, so the strip doesn't need real height to feel solid,
  // and staying thin keeps it from swallowing clicks meant for a maximized
  // window's bottom edge.
  readonly property int revealStripHeight: 4

  // Settings and Pins (docs/SPEC.md "Configuration"): read from the Dock's
  // own entry in the shell config's plugins[] array and written back
  // through shell.updateEntryInline, the write-back hook the shell gives
  // every plugin for its own entry (PluginShellApi.updateEntryInline).
  // rawEntry keeps the entry exactly as last read so write() can fold a
  // change onto it (DockConfig.mergeSettings) instead of replacing it
  // outright — updateEntryInline persists whatever object it's given as
  // the whole entry, so losing rawEntry's other keys here would lose them
  // from shell.json too. pins re-triggers dockState.refresh() on change
  // (below) the same way a Hyprland event does, so a hand edit to the
  // Pins list applies live exactly like a hand edit to a setting does.
  QtObject {
    id: dockSettings

    readonly property string pluginId: root.shell && root.shell.pluginId ? root.shell.pluginId : "bernard.dock"
    property var rawEntry: null
    property int iconSize: DockConfig.DEFAULT_ICON_SIZE
    property int revealDelayMs: DockConfig.DEFAULT_REVEAL_DELAY_MS
    property int hideDelayMs: DockConfig.DEFAULT_HIDE_DELAY_MS
    property var pins: []
    // A Placed Pin's own position (CONTEXT.md "Placed"), persisted here
    // the same way pins is. A Placed Window Item's lives only in
    // dockState.windowPlacements — it has no business surviving a
    // restart — so it isn't part of this settings object at all.
    property var placements: []

    onPinsChanged: dockState.refresh()
    onPlacementsChanged: dockState.refresh()

    function applyShellConfig(shellConfig) {
      var entry = DockConfig.findPluginEntry(shellConfig, dockSettings.pluginId)
      var effective = DockConfig.effectiveSettings(entry)
      dockSettings.rawEntry = entry
      dockSettings.iconSize = effective.iconSize
      dockSettings.revealDelayMs = effective.revealDelayMs
      dockSettings.hideDelayMs = effective.hideDelayMs
      dockSettings.pins = DockConfig.effectivePins(entry)
      dockSettings.placements = DockConfig.effectivePlacements(entry)
    }

    function write(patch) {
      if (!root.shell || typeof root.shell.updateEntryInline !== "function") return false
      var merged = DockConfig.mergeSettings(dockSettings.rawEntry, patch)
      return root.shell.updateEntryInline(dockSettings.pluginId, merged)
    }
  }

  FileView {
    id: shellConfigFile
    path: Quickshell.env("HOME") + "/.config/omarchy/shell.json"
    watchChanges: true
    printErrors: false

    function parseText() {
      try {
        return JSON.parse(text() || "{}")
      } catch (e) {
        return null
      }
    }

    onLoaded: dockSettings.applyShellConfig(shellConfigFile.parseText())
    onLoadFailed: dockSettings.applyShellConfig(null)
    onFileChanged: reload()
  }

  // Tracks Launch Order across live IPC updates: each Window's opened-at
  // rank is assigned the first time its address is seen and kept for as
  // long as the Window stays open, so closing one Window never reshuffles
  // the others. Named dockState, not state — every Item already has a
  // built-in `state` property, which would silently shadow an id of that
  // name in any binding written inside an Item (Repeater, Row, ...).
  QtObject {
    id: dockState

    property var openedAtByAddress: ({})
    property int nextOpenedAt: 0
    // A Placed Window Item's own position (CONTEXT.md "Placed"; DockModel.js
    // comment on `placements`): kept only here, in memory, keyed by Window
    // address exactly like openedAtByAddress, and pruned the same way on
    // every refresh — once a Window's address drops out, its entry drops
    // with it, so its Placed position doesn't linger for some later,
    // unrelated Window that happens to reuse the same address.
    property var windowPlacements: ({})
    property var items: []

    // The `placements` DockModel.buildDockItems applies (DockModel.js
    // comment on `placements`): the permanent, persisted Placed Pins from
    // settings, plus this session's Placed Window Items.
    function placements() {
      var combined = dockSettings.placements.slice()
      for (var address in dockState.windowPlacements) {
        combined.push({ key: "window:" + address, index: dockState.windowPlacements[address] })
      }
      return combined
    }

    function refresh() {
      if (root.dragInProgress) return

      var toplevels = Hyprland.toplevels ? Hyprland.toplevels.values : []
      var seenAddresses = {}
      var windows = []

      for (var i = 0; i < toplevels.length; i++) {
        var toplevel = toplevels[i]
        var address = toplevel.address
        if (typeof address !== "string" || address.length === 0) continue

        seenAddresses[address] = true
        if (!(address in dockState.openedAtByAddress)) {
          dockState.openedAtByAddress[address] = dockState.nextOpenedAt++
        }

        var info = toplevel.lastIpcObject || {}
        windows.push({
          id: address,
          class: info.class || "",
          workspace: toplevel.workspace ? toplevel.workspace.name : String((info.workspace && info.workspace.name) || ""),
          openedAt: dockState.openedAtByAddress[address],
          title: toplevel.title || info.title || "",
          active: !!toplevel.activated,
          attention: !!toplevel.urgent,
        })
      }

      var keptOpenedAt = {}
      for (var key in dockState.openedAtByAddress) {
        if (seenAddresses[key]) keptOpenedAt[key] = dockState.openedAtByAddress[key]
      }
      dockState.openedAtByAddress = keptOpenedAt

      var keptPlacements = {}
      for (var placedAddress in dockState.windowPlacements) {
        if (seenAddresses[placedAddress]) keptPlacements[placedAddress] = dockState.windowPlacements[placedAddress]
      }
      dockState.windowPlacements = keptPlacements

      dockState.items = DockModel.buildDockItems(windows, resolveApp, dockSettings.pins, resolveAppById, dockState.placements())
    }
  }

  Connections {
    target: Hyprland
    function onRawEvent(event) { dockState.refresh() }
  }

  Component.onCompleted: dockState.refresh()

  function resolveApp(window) {
    return window.class ? DesktopEntries.heuristicLookup(window.class) || null : null
  }

  // A Pin resolves its own App directly by the id it was pinned under
  // (CONTEXT.md "Pin"), independent of any Window — unlike resolveApp,
  // which only ever has a window class to go on. A falsy return here is
  // exactly the "App is no longer installed" case (docs/SPEC.md "What the
  // Dock shows").
  function resolveAppById(appId) {
    return appId ? DesktopEntries.byId(appId) || null : null
  }

  // HyprlandToplevel.address comes back as bare hex ("56538020a4f0"),
  // unlike hyprctl's own "0x"-prefixed address strings — normalize before
  // handing it to a dispatch's "address:0x.." window selector.
  function normalizedAddress(address) {
    if (typeof address !== "string") return null
    var hex = address.indexOf("0x") === 0 ? address.slice(2) : address
    return /^[0-9a-fA-F]+$/.test(hex) ? "0x" + hex : null
  }

  function focusWindow(address) {
    var normalized = normalizedAddress(address)
    if (!normalized) return
    // Toggle cursor:no_warps around the dispatch so clicking a Dock Item
    // never yanks the pointer off the Dock to the centre of the newly
    // focused Window.
    var script = "addr=\"$1\"; "
      + "orig=false; hyprctl -j getoption cursor:no_warps | grep -q '\"bool\": true' && orig=true; "
      + "hyprctl eval 'hl.config({ cursor = { no_warps = true } })' >/dev/null; "
      + "hyprctl dispatch \"hl.dsp.focus({ window = \\\"address:$addr\\\" })\"; "
      + "hyprctl eval \"hl.config({ cursor = { no_warps = $orig } })\" >/dev/null"
    Quickshell.execDetached(["bash", "-lc", script, "bash", normalized])
  }

  // Left click on a Pin with no Windows launches its App (docs/SPEC.md
  // "Input"). A missing App's Pin has no `execute` to call — clicking it
  // is a no-op until Unpin, same as a Letter Tile Window Item is a no-op
  // to click on today.
  function launchApp(app) {
    if (!app || typeof app.execute !== "function") return
    app.execute()
  }

  // Close Window (docs/SPEC.md "Input", the context menu): the same
  // dispatch convention as focusWindow, minus the cursor no-warp dance
  // that dispatch needs but this one doesn't.
  function closeWindow(address) {
    var normalized = normalizedAddress(address)
    if (!normalized) return
    Quickshell.execDetached(["bash", "-lc",
      "hyprctl dispatch \"hl.dsp.window.close({ window = \\\"address:$1\\\" })\"",
      "bash", normalized])
  }

  // Pin/Unpin (docs/SPEC.md "Input", the context menu): DockModel.nextPins
  // computes the Pins list's new contents; this only hands it to
  // dockSettings.write, the same write-back path a hand edit to Pins
  // already applies live through.
  function togglePin(appId, pinned) {
    if (!appId) return
    dockSettings.write({ pins: DockModel.nextPins(dockSettings.pins, appId, pinned) })
  }

  // Drag within the Dock (docs/SPEC.md "Input": "reorder"; CONTEXT.md
  // "Placed"): a Pin Item's own drop is persisted through dockSettings.write
  // exactly like Pin/Unpin already is, so it survives a restart. A Window
  // Item's drop only updates dockState.windowPlacements directly — it has
  // no write-back of its own to trigger dockState.refresh() the way a
  // settings change does, so this calls it explicitly.
  function placeItem(item, targetIndex) {
    if (item.kind === "pin") {
      dockSettings.write({ placements: DockModel.placeAt(dockSettings.placements, item.key, targetIndex) })
      return
    }
    dockState.windowPlacements[item.window.id] = targetIndex
    dockState.refresh()
  }

  // Drag out of the Dock, for an Item whose App is pinned (docs/SPEC.md
  // "Input": "Drag out of the Dock: unpin the Item's App if pinned"): one
  // write so dropping the App from Pins and dropping its own Pin's Placed
  // position (CONTEXT.md "Placed") land in the same shellConfig update —
  // two separate dockSettings.write calls here would each merge onto the
  // same pre-write rawEntry, and the first's change would be lost under
  // the second's. Dragging an unpinned Window Item out is a snap-back
  // (docs/SPEC.md "Input"): the Dock itself has nothing to persist for
  // that, so it never calls this at all.
  function unpinFromDrag(appId) {
    if (!appId) return
    dockSettings.write({
      pins: DockModel.nextPins(dockSettings.pins, appId, true),
      placements: DockModel.unplace(dockSettings.placements, "pin:" + appId),
    })
  }

  // A Pin's tooltip (docs/SPEC.md "What the Dock shows": "a 'missing'
  // tooltip"): the App's own name once resolved, its bare Pin id if the
  // App resolved but has none, or an explicit missing note once its App
  // is no longer installed.
  function pinTooltipText(item) {
    if (item.missing) return item.appId + " (missing)"
    return (item.app && item.app.name) || item.appId
  }

  // The Item's own App id for Pin/Unpin (docs/SPEC.md "Input"): a Pin's
  // own id directly, or a Window Item's resolved App id — DockModel.menuFor
  // already reports canPin false whenever a Window Item has none.
  function menuAppId(item) {
    return item.kind === "pin" ? item.appId : (item.app ? item.app.id : null)
  }

  function windowTooltipText(item) {
    return (item.window.title || item.window.class || "") + "\nWorkspace: " + (item.badge || "")
  }

  Variants {
    model: Quickshell.screens

    PanelWindow {
      id: panel

      required property var modelData
      screen: modelData
      visible: true
      color: "transparent"

      WlrLayershell.namespace: "omarchy-dock"
      WlrLayershell.layer: WlrLayer.Top
      WlrLayershell.keyboardFocus: WlrKeyboardFocus.None

      // exclusiveZone 0 with Normal mode reserves no space of our own but
      // still keeps us out of any space another layer surface (the bar)
      // has already claimed, so the panel's own geometry lands above it
      // automatically with no manual bar-height bookkeeping.
      exclusiveZone: 0
      exclusionMode: ExclusionMode.Normal

      anchors {
        top: true
        bottom: true
        left: true
        right: true
      }

      // The input region is the union of the Reveal Strip and the Dock
      // itself: whichever one the Row's slide currently makes zero-area
      // simply contributes nothing, so this holds for both Dock states.
      mask: Region {
        Region { item: revealStrip }
        Region { item: dockRow }
      }

      // Full-width, above any bar reservation because it's anchored to
      // this panel's own bottom edge, which ExclusionMode.Normal already
      // keeps clear of the bar's exclusive zone (see exclusionMode above).
      Item {
        id: revealStrip
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.bottom: parent.bottom
        height: root.revealStripHeight

        HoverHandler {
          onHoveredChanged: revealState.hoveringStrip = hovered
        }
      }

      // Hidden/Revealed and the reveal/hide timers (SPEC.md "How the Dock
      // behaves"). Kept per panel, so hovering one monitor's Reveal Strip
      // never reveals the other monitor's Dock. menuOpen holds the Dock
      // Revealed for the whole of a context-menu visit (SPEC.md "The Dock
      // stays Revealed while its context menu is open") independent of
      // hover, since the pointer moves onto the menu's own popup window
      // and away from both the strip and the Dock itself. dragging does
      // the same for the whole of a drag (SPEC.md "The Dock stays
      // Revealed ... for the whole of a drag; the hide timer starts after
      // the drop"): once it drops back to false the hide timer starts
      // exactly like it does when hover ends, with no separate handling
      // needed here.
      QtObject {
        id: revealState

        property bool hoveringStrip: false
        property bool hoveringDock: false
        property bool menuOpen: false
        property bool dragging: false
        property bool revealed: false
        readonly property bool hovering: hoveringStrip || hoveringDock || menuOpen || dragging

        onHoveringChanged: {
          if (hovering) {
            hideTimer.stop()
            if (!revealed) revealTimer.restart()
          } else {
            revealTimer.stop()
            hideTimer.restart()
          }
        }
      }

      Timer {
        id: revealTimer
        interval: root.revealDelayMs
        onTriggered: revealState.revealed = true
      }

      Timer {
        id: hideTimer
        interval: root.hideDelayMs
        onTriggered: revealState.revealed = false
      }

      Row {
        id: dockRow

        anchors.horizontalCenter: parent.horizontalCenter
        anchors.bottom: parent.bottom
        // Hidden parks the Row below the visible edge without unmapping
        // the panel itself; Revealed rests it at the usual gap. Slides
        // between the two over slideDurationMs.
        anchors.bottomMargin: revealState.revealed ? Style.gapsOut : -(height + Style.gapsOut)
        spacing: Style.spacing.sm

        Behavior on anchors.bottomMargin {
          NumberAnimation { duration: root.slideDurationMs; easing.type: Easing.InOutCubic }
        }

        HoverHandler {
          onHoveredChanged: revealState.hoveringDock = hovered
        }

        readonly property int baseIconSize: root.iconSize
        readonly property real maxWidth: Math.max(0, panel.width - Style.gapsOut * 2)
        readonly property int iconSize: {
          var count = repeater.count
          if (count <= 0) return baseIconSize
          var available = Math.max(0, maxWidth - spacing * Math.max(0, count - 1))
          var natural = baseIconSize * count
          return natural <= available ? baseIconSize : Math.max(16, Math.floor(available / count))
        }

        // Drag to reorder (docs/SPEC.md "Input"; CONTEXT.md "Placed"). The
        // dragged Item's own delegate stays put in the Repeater (so every
        // other Item's slot is undisturbed — reordering this Row's own
        // model mid-drag would make the Repeater tear down and rebuild
        // every delegate, destroying the very Item whose MouseArea is
        // driving the drag) but renders invisible for as long as its key
        // matches dragKey; dragGhost (declared below, a sibling of this
        // Row) shows in its place and follows the pointer, and dropLine
        // (also below) is the live insertion preview: a bar at whichever
        // gap dragPreviewIndex currently names. dragKey empty and
        // dragPreviewIndex -1 both mean "no drag in progress".
        property string dragKey: ""
        property int dragPreviewIndex: -1
        // Recomputed alongside dragPreviewIndex (see updateDragPreview):
        // hides dropLine once the drag has left the Dock, since a drag-out
        // has nothing to do with dragPreviewIndex any more (docs/SPEC.md
        // "Input": drag-out is unpin-or-snap-back, never a reorder).
        property bool draggingOutside: false

        function indexOfKey(items, key) {
          for (var i = 0; i < items.length; i++) {
            if (items[i].key === key) return i
          }
          return -1
        }

        // Recomputed from dragGhost's own position (docs/SPEC.md "Input")
        // as it follows the pointer, in this Row's own parent's coordinate
        // space — the same space dragGhost.x/y are set in, since both are
        // children of it (see dragGhost below).
        function updateDragPreview() {
          if (!dockRow.dragKey) return
          var step = dockRow.iconSize + dockRow.spacing
          var localX = (dragGhost.x + dragGhost.width / 2) - dockRow.x
          var index = step > 0 ? Math.round(localX / step) : 0
          dockRow.dragPreviewIndex = Math.max(0, Math.min(index, dockState.items.length - 1))
          dockRow.draggingOutside = dockRow.isGhostOutsideRow()
        }

        // Drag out of the Dock (docs/SPEC.md "Input"): dragGhost's centre
        // clear of this Row's own rectangle, widened by half an icon so a
        // drop right at the row's own edge still counts as a reorder.
        function isGhostOutsideRow() {
          var margin = dockRow.iconSize / 2
          var left = dockRow.x - margin
          var right = dockRow.x + dockRow.width + margin
          var top = dockRow.y - margin
          var bottom = dockRow.y + dockRow.height + margin
          var centerX = dragGhost.x + dragGhost.width / 2
          var centerY = dragGhost.y + dragGhost.height / 2
          return centerX < left || centerX > right || centerY < top || centerY > bottom
        }

        // The drop (docs/SPEC.md "Input"): reorder within the Dock, unpin
        // for an Item whose App is pinned dragged out, or (an unpinned
        // Window Item dragged out) a snap-back with nothing to persist —
        // dragGhost simply stops following the pointer and every Item,
        // this one included, falls back to dockState.items' own order.
        // Drag state (root.dragInProgress included) clears first, so the
        // refresh placeItem/unpinFromDrag triggers isn't the one
        // dockState.refresh's own drag guard skips.
        function finishDrag(item) {
          var draggedOut = dockRow.isGhostOutsideRow()
          var targetIndex = dockRow.dragPreviewIndex

          dockRow.dragKey = ""
          dockRow.dragPreviewIndex = -1
          dockRow.draggingOutside = false
          dragGhost.visible = false
          revealState.dragging = false
          root.dragInProgress = false

          if (draggedOut) {
            if (item.kind === "pin" || item.pinned) root.unpinFromDrag(root.menuAppId(item))
          } else if (targetIndex >= 0) {
            root.placeItem(item, targetIndex)
          }
        }

        Repeater {
          id: repeater
          model: dockState.items

          delegate: Item {
            id: dockItem
            required property var modelData

            readonly property bool active: dockItem.modelData.active
            readonly property bool attention: dockItem.modelData.attention
            readonly property bool isPin: dockItem.modelData.kind === "pin"
            // Guards onClicked below: MouseArea still emits clicked() on
            // release after a drag.target drag, so without this a drop
            // would also focus/launch the Item it was just dropped near.
            property bool wasDragged: false

            opacity: dockRow.dragKey === dockItem.modelData.key ? 0 : 1
            width: dockRow.iconSize
            height: icon.height + runningDot.height + Style.spacing.xxs

            // The Active Window's highlight and the Attention tint (SPEC.md
            // "Indicators"): CONTEXT.md says the Window Item itself is
            // highlighted/tinted, so these cover the whole Item — icon and
            // running dot both — not just the icon square. Drawn behind the
            // icon so both can show at once without fighting the icon/Letter
            // Tile for the same Rectangle.
            Rectangle {
              visible: dockItem.active
              anchors.fill: parent
              radius: Style.cornerRadius
              color: Style.selectedFill
              border.width: Style.selectedBorderWidth
              border.color: Style.selectedBorderColor
            }

            Rectangle {
              visible: dockItem.attention
              anchors.fill: parent
              radius: Style.cornerRadius
              color: Util.alpha(Color.urgent, 0.35)
            }

            Item {
              id: icon
              anchors.top: parent.top
              anchors.horizontalCenter: parent.horizontalCenter
              width: dockRow.iconSize
              height: dockRow.iconSize

              Image {
                visible: dockItem.modelData.app !== null
                anchors.fill: parent
                fillMode: Image.PreserveAspectFit
                asynchronous: true
                sourceSize.width: width * Screen.devicePixelRatio
                sourceSize.height: height * Screen.devicePixelRatio
                source: dockItem.modelData.app ? Quickshell.iconPath(dockItem.modelData.app.icon, true) : ""
              }

              Rectangle {
                visible: dockItem.modelData.app === null
                anchors.fill: parent
                radius: Style.cornerRadius
                color: Color.muted

                Text {
                  anchors.centerIn: parent
                  text: dockItem.modelData.letter || ""
                  color: Color.foreground
                  font.family: Style.font.family
                  font.pixelSize: Style.font.icon
                }
              }

              // Workspace badge (docs/SPEC.md "Indicators"): the model
              // has already turned a special workspace's "special:" IPC
              // name into its own name.
              Rectangle {
                visible: (dockItem.modelData.badge || "").length > 0
                anchors.right: parent.right
                anchors.bottom: parent.bottom
                radius: height / 2
                color: Color.background
                border.width: Style.normalBorderWidth
                border.color: Color.muted
                width: Math.max(height, badgeText.implicitWidth + Style.spacing.xs * 2)
                height: Style.font.caption + Style.spacing.xxs * 2

                Text {
                  id: badgeText
                  anchors.centerIn: parent
                  text: dockItem.modelData.badge || ""
                  color: Color.foreground
                  font.family: Style.font.family
                  font.pixelSize: Style.font.caption
                }
              }

              MouseArea {
                id: mouseArea
                anchors.fill: parent
                hoverEnabled: true
                acceptedButtons: Qt.LeftButton | Qt.MiddleButton | Qt.RightButton
                // Only a left-button press drags (docs/SPEC.md "Input"
                // reserves right/middle for the menu and launching); drag
                // moves dragGhost, a sibling of dockRow, not this Item
                // itself — dockRow is a positioner and would fight any
                // attempt to move dockItem directly.
                drag.target: dragGhost

                onPressed: function (mouse) {
                  dockItem.wasDragged = false
                  if (mouse.button !== Qt.LeftButton) {
                    mouseArea.drag.target = null
                    return
                  }
                  mouseArea.drag.target = dragGhost
                  dragGhost.item = dockItem.modelData
                  var origin = dockItem.mapToItem(dockRow.parent, 0, 0)
                  dragGhost.x = origin.x
                  dragGhost.y = origin.y
                  dragGhost.width = dockItem.width
                  dragGhost.height = dockItem.height
                }

                drag.onActiveChanged: {
                  if (mouseArea.drag.active) {
                    dockItem.wasDragged = true
                    root.dragInProgress = true
                    revealState.dragging = true
                    dockRow.dragKey = dockItem.modelData.key
                    dockRow.dragPreviewIndex = dockRow.indexOfKey(dockState.items, dockItem.modelData.key)
                    dragGhost.visible = true
                  } else if (dockRow.dragKey === dockItem.modelData.key) {
                    dockRow.finishDrag(dockItem.modelData)
                  }
                }

                onClicked: function (mouse) {
                  if (dockItem.wasDragged) return
                  if (mouse.button === Qt.RightButton) {
                    contextMenu.anchorItem = dockItem
                    contextMenu.menuItem = dockItem.modelData
                    contextMenu.visible = true
                    return
                  }
                  // Middle click on any Item with a resolvable App launches
                  // a new instance (docs/SPEC.md "Input"); launchApp is
                  // already a no-op when there's no App to launch.
                  if (mouse.button === Qt.MiddleButton) {
                    root.launchApp(dockItem.modelData.app)
                    return
                  }
                  if (dockItem.isPin) {
                    root.launchApp(dockItem.modelData.app)
                    return
                  }
                  if (dockItem.active) return
                  root.focusWindow(dockItem.modelData.window.id)
                }
              }

              // Bound to revealState.revealed, not just hover, so the
              // tooltip disappears the moment the Dock hides instead of
              // lingering until the pointer physically leaves the Item; it
              // has no hover handling of its own, so it never feeds
              // revealState and can't keep the Dock revealed on its own.
              PanelToolTip {
                visible: mouseArea.containsMouse && revealState.revealed
                text: dockItem.isPin
                  ? root.pinTooltipText(dockItem.modelData)
                  : root.windowTooltipText(dockItem.modelData)
              }
            }

            // The running dot (SPEC.md "Indicators"): every Window Item
            // shows one; a Pin with no Windows (CONTEXT.md "Pin") is the
            // only Item without it.
            Rectangle {
              id: runningDot
              visible: !dockItem.isPin
              anchors.top: icon.bottom
              anchors.topMargin: Style.spacing.xxs
              anchors.horizontalCenter: parent.horizontalCenter
              width: Style.spacing.xs
              height: Style.spacing.xs
              radius: width / 2
              color: Color.foreground
            }
          }
        }
      }

      // The floating icon a drag follows (docs/SPEC.md "Input": "Drag
      // within the Dock: reorder"; issue #16's own acceptance criteria add
      // "with a live insertion preview"). A sibling of dockRow, not one of
      // its Repeater delegates, so dockRow's own positioning never fights its
      // position; mouseArea.drag.target (above) moves it directly by the
      // pointer's own delta, in this shared parent's coordinate space,
      // starting from wherever the dragged delegate's onPressed measured
      // it to be.
      Item {
        id: dragGhost

        property var item: null

        visible: false
        z: 1000
        opacity: 0.85

        // Recomputes the live insertion preview directly off of the
        // position mouseArea.drag.target (above) is actually driving —
        // rather than off the mouse event that causes it, so this never
        // races whatever order Qt applies the two in.
        onXChanged: if (dockRow.dragKey) dockRow.updateDragPreview()
        onYChanged: if (dockRow.dragKey) dockRow.updateDragPreview()

        Image {
          visible: dragGhost.item && dragGhost.item.app !== null
          anchors.fill: parent
          fillMode: Image.PreserveAspectFit
          asynchronous: true
          sourceSize.width: width * Screen.devicePixelRatio
          sourceSize.height: height * Screen.devicePixelRatio
          source: dragGhost.item && dragGhost.item.app ? Quickshell.iconPath(dragGhost.item.app.icon, true) : ""
        }

        Rectangle {
          visible: dragGhost.item && dragGhost.item.app === null
          anchors.fill: parent
          radius: Style.cornerRadius
          color: Color.muted

          Text {
            anchors.centerIn: parent
            text: (dragGhost.item && dragGhost.item.letter) || ""
            color: Color.foreground
            font.family: Style.font.family
            font.pixelSize: Style.font.icon
          }
        }
      }

      // The live insertion preview itself (issue #16's acceptance
      // criteria, on top of docs/SPEC.md "Input"'s own "Drag within the
      // Dock: reorder"): a bar at the gap dragPreviewIndex names, hidden
      // once the drag has left the Dock (see draggingOutside) since
      // drag-out is never a reorder.
      Rectangle {
        id: dropLine

        visible: dockRow.dragKey !== "" && !dockRow.draggingOutside
        x: dockRow.x + dockRow.dragPreviewIndex * (dockRow.iconSize + dockRow.spacing) - dockRow.spacing / 2 - width / 2
        y: dockRow.y
        width: 2
        height: dockRow.height
        radius: 1
        color: Color.accent
      }

      // The context menu (docs/SPEC.md "Input": "Right click: menu with
      // exactly Pin/Unpin, New Window, Close Window. Pin is disabled on
      // Letter Tile Items"). One instance per monitor's panel, re-anchored
      // to whichever Item was right-clicked; DockModel.menuFor supplies
      // every row's enabled state from the Item alone, so this only turns
      // that into labels and the dispatch each row triggers on click.
      PopupWindow {
        id: contextMenu

        property var anchorItem: null
        property var menuItem: null
        readonly property var anchorWindow: contextMenu.anchorItem ? contextMenu.anchorItem.QsWindow.window : null
        readonly property int menuMargin: Style.spacing.xs
        readonly property int rowWidth: Style.space(160)

        readonly property var rows: {
          var item = contextMenu.menuItem
          if (!item) return []
          var menu = DockModel.menuFor(item)
          var appId = root.menuAppId(item)
          return [
            {
              label: menu.pinned ? "Unpin" : "Pin",
              enabled: menu.canPin,
              trigger: function () { root.togglePin(appId, menu.pinned) },
            },
            {
              label: "New Window",
              enabled: menu.canLaunch,
              trigger: function () { root.launchApp(item.app) },
            },
            {
              label: "Close Window",
              enabled: menu.canClose,
              trigger: function () { root.closeWindow(item.window.id) },
            },
          ]
        }

        function close() { contextMenu.visible = false }

        // Hovering the menu itself (docs/SPEC.md's own hide-timer feel:
        // leaving it closes the menu after hideDelayMs, the same delay the
        // Dock's own auto-hide uses, so a brief crossing between rows or
        // from the anchor Item onto the popup doesn't close it early).
        readonly property bool hoveringMenu: menuHover.hovered
        // The pointer needs a moment to travel from the anchor Item up to
        // the popup after a right click opens it — unlike the Dock's own
        // hide timer, there's no antecedent hover to fall back on, since
        // the click that opened the menu isn't itself a hover. graceTimer
        // holds off treating "not on the menu yet" as a reason to close
        // for graceMs after open; once it elapses, an Item the pointer
        // never reached at all still closes itself instead of sitting
        // open forever (an outside click always closes it regardless).
        readonly property int graceMs: 1500
        property bool graceElapsed: false

        // Without this, the popup renders on top but never actually
        // becomes the surface Hyprland routes pointer input to — hover
        // and clicks fall through to whatever's underneath, and any real
        // click reads as "outside" to the focus grab below.
        grabFocus: true

        visible: false
        color: "transparent"
        implicitWidth: contextMenu.rowWidth
        implicitHeight: menuColumn.implicitHeight

        onVisibleChanged: {
          revealState.menuOpen = contextMenu.visible
          if (contextMenu.visible) {
            contextMenu.graceElapsed = false
            menuGraceTimer.restart()
          } else {
            menuGraceTimer.stop()
            menuLeaveTimer.stop()
          }
        }

        onHoveringMenuChanged: {
          if (contextMenu.hoveringMenu) menuLeaveTimer.stop()
          else if (contextMenu.visible && contextMenu.graceElapsed) menuLeaveTimer.restart()
        }

        onGraceElapsedChanged: {
          if (contextMenu.graceElapsed && contextMenu.visible && !contextMenu.hoveringMenu) menuLeaveTimer.restart()
        }

        Timer {
          id: menuGraceTimer
          interval: contextMenu.graceMs
          onTriggered: contextMenu.graceElapsed = true
        }

        Timer {
          id: menuLeaveTimer
          interval: root.hideDelayMs
          onTriggered: contextMenu.close()
        }

        // Outside-click dismissal: grabFocus's own compositor grab already
        // dismisses the popup on an outside click; onClosed is the signal
        // it fires when that happens, so this only needs to mirror that
        // into `visible`. A second, separate HyprlandFocusGrab here (as
        // PopupCard uses, for a popup that does *not* set grabFocus)
        // fought this one and cleared it the instant it opened.
        onClosed: contextMenu.close()

        anchor {
          id: menuAnchor
          window: contextMenu.anchorWindow
          adjustment: PopupAdjustment.Slide
          edges: Edges.Top | Edges.Left
          gravity: Edges.Bottom | Edges.Right
          rect.width: 1
          rect.height: 1

          onAnchoring: {
            if (!contextMenu.anchorItem || !contextMenu.anchorWindow) return
            var target = contextMenu.anchorItem
            var popupWidth = contextMenu.implicitWidth
            var popupHeight = contextMenu.implicitHeight
            var localX = target.width / 2 - popupWidth / 2
            var localY = -popupHeight - contextMenu.menuMargin
            var point = contextMenu.anchorWindow.contentItem.mapFromItem(target, localX, localY)
            point.x = Math.max(contextMenu.menuMargin, Math.min(point.x, contextMenu.anchorWindow.width - popupWidth - contextMenu.menuMargin))
            point.y = Math.max(contextMenu.menuMargin, point.y)
            menuAnchor.rect.x = Math.round(point.x)
            menuAnchor.rect.y = Math.round(point.y)
          }
        }

        Rectangle {
          anchors.fill: parent
          radius: Style.cornerRadius
          color: Color.popups.background
          border.width: Style.normalBorderWidth
          border.color: Color.popups.border

          HoverHandler {
            id: menuHover
          }

          Column {
            id: menuColumn
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.top: parent.top
            anchors.margins: Style.spacing.xxs

            Repeater {
              model: contextMenu.rows

              delegate: Rectangle {
                id: menuRow
                required property var modelData

                width: menuColumn.width
                height: Style.spacing.popupRowHeight
                radius: Style.cornerRadius
                // containsMouse, not a HoverHandler, to match Button.qml's
                // own hover-fill convention.
                color: menuRow.modelData.enabled && rowMouse.containsMouse
                  ? Style.hoverFillFor(Color.foreground, Color.accent)
                  : "transparent"

                Text {
                  anchors.left: parent.left
                  anchors.right: parent.right
                  anchors.verticalCenter: parent.verticalCenter
                  anchors.leftMargin: Style.spacing.controlPaddingX
                  anchors.rightMargin: Style.spacing.controlPaddingX
                  text: menuRow.modelData.label
                  color: menuRow.modelData.enabled ? Color.popups.text : Color.muted
                  font.family: Style.font.family
                  font.pixelSize: Style.font.body
                }

                MouseArea {
                  id: rowMouse
                  anchors.fill: parent
                  hoverEnabled: true
                  enabled: menuRow.modelData.enabled
                  cursorShape: Qt.PointingHandCursor
                  onClicked: {
                    menuRow.modelData.trigger()
                    contextMenu.close()
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
