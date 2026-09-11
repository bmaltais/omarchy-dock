// Plugin skeleton for the Dock (see docs/SPEC.md, milestone M1). This
// service entry point does not yet render anything — it only proves the
// plugin loads and hot-reloads cleanly inside the Omarchy shell. The Dock's
// own layer-shell surfaces (one per monitor) land in a later milestone.
import QtQuick

Item {
  id: root

  // Injected by omarchy-shell (the first-party/plugin service loader).
  property var shell: null

  Component.onCompleted: console.log("bernard.dock: service loaded")
}
