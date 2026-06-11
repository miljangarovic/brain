# Brain

A desktop wrapper around the terminal: named terminals with full PTY, organized
into projects (sidebar tree + tabs) — for orchestrating and monitoring AI agents
per feature, even dozens at once. Developed and primarily tested on Linux.

## Development (run from source — any platform)

Prerequisites: Node.js 20+, git, and a C++ toolchain for `node-pty`
(Linux: `build-essential` + `python3`; macOS: `xcode-select --install`;
Windows: Visual Studio Build Tools with the "Desktop development with C++"
workload, including Spectre-mitigated libraries).

```bash
git clone <repo-url> && cd brain
npm install
npm run rebuild   # rebuild node-pty for the Electron ABI
npm run dev       # run the app
npm test          # unit tests
```

For agent features, `claude` and/or `codex` CLIs must be on the PATH.

## Install on Linux

Build the installers (or grab them from a release):

```bash
sudo apt install -y dpkg fakeroot libfuse2   # system deps for the .deb / AppImage targets
npm run dist                                  # → release/<version>/
```

**.deb (Debian/Ubuntu):**

```bash
sudo apt install ./release/0.1.0/brain_0.1.0_amd64.deb   # resolves deps automatically
# then launch from your app menu, or run: /opt/Brain/brain
# uninstall: sudo apt remove brain
```

**AppImage (any distro):**

```bash
chmod +x release/0.1.0/Brain-0.1.0.AppImage
./release/0.1.0/Brain-0.1.0.AppImage
```

## Install on macOS

Packaging must run **on a Mac** (native `node-pty` + DMG tooling). On the Mac:

```bash
xcode-select --install
npm install && npm run rebuild
npm run dist      # → release/<version>/Brain-<version>.dmg (host arch; add --x64/--arm64 for both)
```

Open the DMG and drag **Brain** into **Applications**. The app is not
code-signed/notarized, so on first launch Gatekeeper will block it — either go
to **System Settings → Privacy & Security → "Open Anyway"**, or clear the
quarantine flag:

```bash
xattr -cr /Applications/Brain.app
```

(Proper signing/notarization needs an Apple Developer account; the
electron-builder config is ready for it.)

## Install on Windows

> Windows support is untested. The codebase is Windows-aware (ConPTY via
> node-pty, `cmd.exe`/`COMSPEC` shell fallback), but live-agent icon detection
> is degraded and the `codex` CLI generally requires WSL there.

Packaging must run **on Windows** (native `node-pty`):

```powershell
npm install ; npm run rebuild
npm run dist     # → release\<version>\Brain Setup <version>.exe (NSIS installer)
```

Run the installer; Brain appears in the Start menu. Unsigned binaries trigger
SmartScreen — choose **More info → Run anyway**.

**Recommended alternative:** run the Linux build under **WSL2 + WSLg** — agents
(`claude`/`codex`) are first-class in Linux, and the GUI shows up on the
Windows desktop. Inside the WSL distro, install the `.deb` exactly as in the
Linux section above.

## Packaging reference

```bash
npm run dist      # build installers for the host platform into release/
npm run dist:dir  # unpacked build only (no installer), for a quick check
```

Cross-building is not supported: each platform's installer must be built on
that platform (native `node-pty` module + platform packaging tools).

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

## Voice commands

- **Voice commands** — control the app by voice (Serbian or English): switch features, toggle the grid, launch agent terminals with a spoken prompt, drive review loops (accept / more rounds / stop), cycle and bulk-close tabs, create or archive features. Local whisper.cpp transcription — audio never leaves the machine; only the transcript and workspace names are sent to Groq for intent parsing. Press `Ctrl+Alt+Space`, click the mic button, or use a mouse side button (see below).

### Voice setup (Groq API key)

Transcription is fully local (the whisper model downloads on first use,
~1.1 GB), but intent parsing needs a **free** Groq API key:

1. Go to <https://console.groq.com> and sign in (free tier: ~2000 requests/day,
   no card required).
2. **API Keys → Create API Key**, copy the `gsk_...` value (it is shown only
   once).
3. Create `voice.json` in the app's **user-data directory** — the same folder
   that holds `workspace.json` (see [Persistence](#persistence) for all
   platforms; on Linux that's `~/.config/Brain/` for the installed app and
   `~/.config/brain/` when running from source — **mind the capital B**):

```json
{
  "groqApiKey": "gsk_..."
}
```

4. Restart the app — `voice.json` is read once at startup.

Alternatively, the `GROQ_API_KEY` environment variable overrides the file.
The key is read in the main process only and never reaches the renderer,
the repo, or the packaged build.

### Voice config reference (`voice.json`)

| Field | Default | Meaning |
|---|---|---|
| `groqApiKey` | — | Groq key for intent parsing (required for commands to execute) |
| `mouseTrigger` | `"forward"` | Mouse side button that drives voice: `"forward"`, `"back"`, or `"off"` |
| `mouseTriggerMode` | `"hold"` | `"hold"` = push-to-talk (press records, release sends); `"click"` = first click starts listening, silence or a second click ends it |
| `shortcut` | `"Ctrl+Alt+Space"` | Global shortcut (X11) |
| `language` | `"sr"` | Whisper transcription language |
| `modelId` | `"sagicc-large-v3-sr-q5_0"` | Whisper model (Serbian-tuned large-v3) |
| `enabled` | `true` | `false` disables voice entirely |

> **Logitech MX note:** on MX mice a held side button doubles as the
> horizontal-scroll modifier, so the firmware emits the button press only on
> release — push-to-talk (`"hold"`) cannot work there. Use
> `"mouseTriggerMode": "click"` instead.

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
`workspace.json` in the app's user-data directory and restored on launch with
fresh shells:

- Linux: `~/.config/Brain/` (`~/.config/brain/` when running from source)
- macOS: `~/Library/Application Support/Brain/`
- Windows: `%APPDATA%\Brain\`
