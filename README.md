# Omarchy Dock

A macOS/Windows-style dock for [Omarchy](https://omarchy.org): every open window on every workspace and monitor, pinned apps, auto-hide.

Status: in design. See [docs/SPEC.md](docs/SPEC.md) for the agreed behaviour and [CONTEXT.md](CONTEXT.md) for vocabulary. Work is tracked in the GitHub issues, grouped by milestone.

## Development install

This repository's root is the plugin directory (`manifest.json` at the root), with id `bernard.dock`.

1. Symlink the checkout into the Omarchy plugins directory:

   ```sh
   ln -s "$(pwd)" ~/.config/omarchy/plugins/bernard.dock
   ```

2. Enable it in the shell:

   ```sh
   omarchy plugin enable bernard.dock
   ```

3. Confirm it's loaded:

   ```sh
   omarchy plugin list        # bernard.dock should show as enabled, third-party, service
   omarchy plugin validate .  # validates manifest.json against the shell's plugin schema
   ```

The shell watches `~/.config/omarchy/plugins/` for changes and reloads automatically, but its watcher does not follow directory symlinks, so edits made in this checkout are not picked up on save when it's symlinked in this way. After editing, force a reload with:

```sh
omarchy-shell shell rescanPlugins
```

Check `journalctl --user -t omarchy-shell` for load warnings or errors.
