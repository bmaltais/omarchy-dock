// Dock service entry point (see docs/SPEC.md, milestones 1-3; vocabulary in
// CONTEXT.md). Owns one layer-shell panel per monitor, each rendering the
// same Window Items built by DockModel.buildDockItems from live Hyprland
// state, Hidden by default and Revealed by hovering its Reveal Strip, with
// the Active/Attention/running/workspace indicators from milestone 3. Pins
// land in a later milestone.
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

  // Settings (docs/SPEC.md "Configuration"): read from the Dock's own entry
  // in the shell config's plugins[] array and written back through
  // shell.updateEntryInline, the write-back hook the shell gives every
  // plugin for its own entry (PluginShellApi.updateEntryInline). rawEntry
  // keeps the entry exactly as last read so write() can fold a settings
  // change onto it (DockConfig.mergeSettings) instead of replacing it
  // outright — updateEntryInline persists whatever object it's given as the
  // whole entry, so losing rawEntry's other keys here would lose them from
  // shell.json too, including Pins once a later milestone adds them.
  QtObject {
    id: dockSettings

    readonly property string pluginId: root.shell && root.shell.pluginId ? root.shell.pluginId : "bernard.dock"
    property var rawEntry: null
    property int iconSize: DockConfig.DEFAULT_ICON_SIZE
    property int revealDelayMs: DockConfig.DEFAULT_REVEAL_DELAY_MS
    property int hideDelayMs: DockConfig.DEFAULT_HIDE_DELAY_MS

    function applyShellConfig(shellConfig) {
      var entry = DockConfig.findPluginEntry(shellConfig, dockSettings.pluginId)
      var effective = DockConfig.effectiveSettings(entry)
      dockSettings.rawEntry = entry
      dockSettings.iconSize = effective.iconSize
      dockSettings.revealDelayMs = effective.revealDelayMs
      dockSettings.hideDelayMs = effective.hideDelayMs
    }

    // No caller yet — a settings UI lands with Pins in a later milestone —
    // but applying a write's result still goes through shellConfigFile's
    // own reload, the same path a hand edit takes, so there will be exactly
    // one place that turns config into live settings once one exists.
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
    property var items: []

    function refresh() {
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

      dockState.items = DockModel.buildDockItems(windows, resolveApp)
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
      // never reveals the other monitor's Dock.
      QtObject {
        id: revealState

        property bool hoveringStrip: false
        property bool hoveringDock: false
        property bool revealed: false
        readonly property bool hovering: hoveringStrip || hoveringDock

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

        Repeater {
          id: repeater
          model: dockState.items

          delegate: Item {
            id: dockItem
            required property var modelData

            readonly property bool active: dockItem.modelData.active
            readonly property bool attention: dockItem.modelData.attention

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
                acceptedButtons: Qt.LeftButton
                onClicked: {
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
                text: (dockItem.modelData.window.title || dockItem.modelData.window.class || "")
                  + "\nWorkspace: " + (dockItem.modelData.badge || "")
              }
            }

            // The running dot (SPEC.md "Indicators"): every Window Item
            // shows one, so a future Pin with no Windows is the only Item
            // without it.
            Rectangle {
              id: runningDot
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
    }
  }
}
