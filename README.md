# OrchestriX

A desktop wrapper around the terminal for Linux: named terminals with full PTY,
organized into projects (sidebar tree + tabs) — for orchestrating and monitoring
AI agents per feature, even dozens at once.

## Development

```bash
npm install
npm run rebuild   # rebuild node-pty for the Electron ABI
npm run dev       # run the app
npm test          # unit tests
```

## Packaging

```bash
npm run dist      # build installers (Linux AppImage/.deb; mac dmg/zip; win nsis) into release/
npm run dist:dir  # unpacked build only (no installer), for a quick check
```

## Shortcuts

- `Ctrl+Shift+T` — new terminal in the active project
- `Ctrl+Shift+W` — close the active terminal
- `Ctrl+PageDown` / `Ctrl+PageUp` — next / previous tab
- `Ctrl+Shift+C` / `Ctrl+Shift+V` — copy / paste
- `Shift+Enter` — newline in the input (instead of submitting) — for claude/codex and similar agents

## Launching agents quickly

In the tab bar (and on hover of a project/feature in the sidebar) the `+` is
joined by **Claude** and **Codex** buttons. A single click creates a terminal
that immediately starts that agent (`claude` / `codex` are expected on the
PATH). Terminals running an agent carry its icon in the sidebar and tabs, and
are remembered across restarts.

## Hierarchy

Project (with a working directory) → Feature → Terminal. A terminal inherits the
project's cwd. Double-clicking a project/feature/terminal name renames it. Tabs
and grid view apply to the active feature.

## Native

- **Browse…** in the new-project dialog picks the working directory with the native picker.
- **Right-click a project** → Rename / Open in Files (open the cwd in the file manager).
- A terminal's icon changes live when `claude`/`codex` is running (and reverts when it exits).

## Persistence

The structure (projects + terminals + cwd + startup command) is saved to
`~/.config/OrchestriX/workspace.json` and restored on launch with fresh shells.
