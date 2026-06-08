# Terminaltor — Dizajn (v1)

**Datum:** 2026-06-08
**Status:** Odobreno (brainstorming faza)

Terminaltor je desktop aplikacija za Linux koja služi kao UI wrapper nad
terminalom. Omogućava da se lako otvore imenovani terminali sa punom
funkcionalnošću (svi nativni komandni programi), te da se više terminala grupiše
u jednu cjelinu. Glavni motiv grupisanja je organizacija AI agenata po feature-ima
(npr. grupa `feature-auth` sadrži terminale `claude-api`, `tests`, `server`).

## Ključne odluke

| Odluka | Izbor |
|---|---|
| Raspored/grupisanje | **A** — sidebar stablo grupa + tabovi terminala (VS Code stil) |
| Tech stack | **Electron** + `xterm.js` + `node-pty` |
| Renderer | React + TypeScript + Vite (`electron-vite`) + Tailwind |
| Perzistencija | Struktura (grupe + terminali + cwd + startup komanda); svjež shell na startu |
| Startup komanda | Opciona, po terminalu |

## 1. Arhitektura (Electron: main + renderer)

- **Main proces (Node):** vlasnik pravih shell procesa (`node-pty`), perzistencije
  (JSON) i prozora. Za svaki terminal spawnuje jedan PTY.
- **Renderer (web UI):** sidebar, tabovi, `xterm.js` paneli. Šalje pritiske
  tastera u main, prima ispis nazad.
- **Preload (contextBridge):** siguran IPC most. `contextIsolation: on`,
  `nodeIntegration: off`.

**Tok podataka:**

- Kucanje: xterm.js → renderer šalje `pty:input {id, data}` → main piše u node-pty.
- Ispis: PTY → main šalje `pty:data {id, data}` → renderer ispiše u xterm.js.
- Resize: fit-addon izračuna `cols`/`rows` → `pty:resize {id, cols, rows}` →
  `pty.resize()`.

> `node-pty` je native modul — zahtijeva rebuild za Electron ABI
> (`electron-rebuild` ili `@electron/rebuild`).

## 2. Domenski model

```
Workspace { groups: Group[] }
Group     { id, name, collapsed, terminals: Terminal[] }
Terminal  { id, name, cwd, startupCommand?, shell? }   // config (perzistira se)
            + runtime: živi PTY + xterm instanca (NE perzistira se)
```

Perzistencija: `~/.config/Terminaltor/workspace.json` (debounced save).
Na startu: pročita JSON → rekreira grupe/terminale → spawnuje **svježe** shell-ove
u sačuvanom `cwd` → pokrene `startupCommand` ako postoji. Scrollback se NE čuva u v1.

## 3. Komponente (fokusirane jedinice)

**Renderer:**

- `Sidebar` — stablo grupa (collapsible), add/rename/delete grupe, dodavanje
  terminala, izbor aktivnog terminala.
- `TabBar` — tabovi terminala aktivne grupe; switch/close/add.
- `TerminalView` — jedan `xterm.js` + fit-addon, vezan za PTY `id`. Mountuje se
  po terminalu; sakriven kad nije aktivan, ali ostaje živ da ispis teče.
- `store` — workspace state (aktivna grupa/terminal) + akcije; lagani custom store.

**Main:**

- `ptyManager` — create/write/resize/kill PTY po `id`-u; emituje data evente.
- `persistence` — load/save workspace JSON (debounced).
- `ipc` — žičenje IPC kanala između renderera i ptyManager/persistence.
- `main` — app/prozor lifecycle.

Princip: svaka jedinica ima jasnu svrhu, definisan interfejs, testabilna nezavisno.

## 4. Obim v1 (MVP)

**U obimu:**

- Kreiranje / rename / brisanje grupe.
- Kreiranje terminala sa imenom + opcioni `cwd` (default: home `~`) + opciona
  `startupCommand`. Default shell je `$SHELL` (fallback `/bin/bash`).
- Pun PTY: bilo koja komanda, interaktivni programi (vim, htop, claude), boje, resize.
- Sidebar stablo + tab bar po grupi + prebacivanje aktivnog terminala.
- Zatvaranje terminala (ubije PTY).
- Perzistencija strukture (grupe + terminali + cwd + startupCommand); restore na startu.
- Copy/paste (Ctrl+Shift+C / Ctrl+Shift+V).
- Osnovne prečice: novi terminal, nova grupa, prebaci tab.

**Van obima v1 (vidi Roadmap):** split paneli, drag-and-drop, šabloni grupa,
perzistencija scrollback-a, pakovanje, settings/theme UI, pretraga.

## 5. Rukovanje greškama

- PTY spawn fail (loš cwd/shell) → poruka u panelu, terminal označen kao errored, retry.
- PTY izlaz (`exit` / proces gotov) → `[proces završen]` u panelu + opcija restart.
- Persistence write fail → toast, ne-fatalno (log).
- IPC: validacija `id`-a prije rada sa PTY-jem.

## 6. Testiranje

- Main jedinice (`ptyManager`, `persistence`) — unit testovi (Vitest): spawn `echo`
  i provjera data; save/load roundtrip na temp direktorijumu.
- Renderer logika (`Sidebar`, `TabBar`) — Vitest + Testing Library.
- `TerminalView` namjerno tanak (xterm teško unit-testirati) → manual E2E za
  stvarnu interakciju.

## 7. Distribucija (v1)

Pokretanje preko `npm run dev` (electron-vite dev) i `npm start`. Pakovanje u
AppImage/.deb je V2 (vidi dole).

---

## Roadmap (dalji koraci)

### V2 — produktivnost i pakovanje

- **Split paneli unutar grupe** (kombinacija A + B): više terminala vidljivo
  istovremeno, tmux-stil tiling — direktno korisno za paralelno praćenje agenata.
- **Drag-and-drop** redosljeda grupa i terminala (i premještanje terminala između grupa).
- **Grupni šabloni:** "Nova grupa iz šablona" — predefinisan skup terminala, svaki
  sa svojim cwd i komandom (npr. šablon `feature-dev`).
- **Pakovanje** preko `electron-builder` → AppImage i `.deb`; ikona, desktop entry.
- **Settings / theme UI:** izbor teme, font, default shell, ponašanje na `exit`.

### V3 — dubina

- **Perzistencija scrollback-a** po terminalu (opciono, sa limitom).
- **Pretraga u terminalu** (xterm search addon).
- **Shell profili** (bash/zsh/fish, env varijable po profilu/grupi).
- **Export / import workspace** (dijeljenje setup-a između mašina).
- **Global hotkey** za prizivanje prozora.
- **AI-agent status indikatori:** badge na terminalu kad agent čeka input ili je
  završio (heuristika nad PTY ispisom).

### Dalje (ideje)

- **Remote / SSH terminali** kao tip terminala.
- **Broadcast komande** na sve terminale u grupi odjednom.
- **Agent dashboard:** pregled svih grupa sa statusom svakog agenta.
- **Po-grupi metrika** (vrijeme rada, broj komandi).
