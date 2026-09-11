# Omarchy Dock

A macOS/Windows-style dock for Omarchy that gives mouse-driven access to every open window on every workspace and monitor, plus a launcher strip of pinned apps.

## Language

**Dock**:
The panel along the bottom edge of a monitor that holds Items. Every monitor gets its own Dock, and each Dock shows the same Items.
_Avoid_: taskbar, bar (that word is taken by the Omarchy top bar), panel

**Item**:
One slot in the Dock. An Item is either a Window Item or a Pin.
_Avoid_: icon (an icon is what an Item displays), entry, button

**Window**:
A single top-level window managed by Hyprland, on any workspace of any monitor. Each Window is represented by exactly one Window Item.
_Avoid_: client, toplevel, application (a Window belongs to an App; the two are different)

**App**:
The desktop entry that identifies which program a Window belongs to. An App supplies the icon and the launch command.
_Avoid_: application, program, class

**Pin**:
An App the user has chosen to keep in the Dock whether or not it currently has any Windows. A Pin holds a slot: while its App has Windows, their Window Items occupy that slot; when the last one closes, the Pin itself is shown and clicking it launches the App. A Pin is removed by Unpin in the Item's menu or by dragging the Item out of the Dock.
_Avoid_: favourite, shortcut, bookmark, dock entry

**Active Window**:
The Window that currently has keyboard focus. Its Window Item is highlighted.
_Avoid_: focused window, current window

**Attention**:
The state of a Window that has asked for the user's attention. Its Window Item is tinted with the theme's urgent colour; the Dock does not reveal itself for it.
_Avoid_: urgent, alert, bounce

**Letter Tile**:
The fallback shown for a Window whose App cannot be identified: the first letter of the window class in a themed square.
_Avoid_: placeholder, generic icon, missing icon

**Launch Order**:
The order in which Windows appeared, except that a new Window joins the Window Items of its own App rather than going to the end. It is the Dock's default ordering rule for Window Items that the user has not Placed.
_Avoid_: creation order, open order, z-order

**Placed**:
An Item the user has dragged to a position of their choosing. A Placed Pin keeps its position permanently; a Placed Window Item keeps it until the Window closes.
_Avoid_: reordered, moved, custom order

## Dock states

**Revealed**:
The Dock is visible, floating over windows. It never reserves screen space.

**Hidden**:
The Dock is off screen. It is the default state; the Dock becomes Revealed when the pointer rests on the Reveal Strip and returns to Hidden once the pointer has left the Dock.
_Avoid_: collapsed, minimised, auto-hidden (auto-hide is the behaviour, Hidden is the state)

**Reveal Strip**:
The invisible band along the full bottom edge of a monitor, above any space the bar reserves, that turns a Hidden Dock into a Revealed one.
_Avoid_: hot zone, trigger area, edge
