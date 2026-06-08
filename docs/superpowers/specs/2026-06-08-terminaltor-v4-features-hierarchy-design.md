# Terminaltor V4 — Features Hierarchy (Design)

**Datum:** 2026-06-08
**Status:** Odobreno (brainstorming faza)

Uvodi treći nivo hijerarhije (**Grupa → Feature → Terminal**), radni direktorijum
na nivou grupe (terminali ga nasljeđuju), pojednostavljeno kreiranje, rename na
svim nivoima, desni-klik meni na grupi (Rename / Open in Files), prikaz pwd-a grupe,
i live detekciju agenta (claude/codex) iz foreground procesa.

---

## 1. Model + migracija

```
Workspace { groups: Group[] }
Group   { id, name, cwd, collapsed, features: Feature[] }
Feature { id, name, collapsed, viewMode?: 'tabs' | 'grid', terminals: Terminal[] }
Terminal{ id, name, cwd, startupCommand?, kind? }
```

Promjene u odnosu na v3:
- **Group** dobija `cwd` (string; `''` === home `~`) i `features` umjesto `terminals`.
- **Feature** je novi entitet; `viewMode` (grid/tabs) se SELI sa grupe na feature.
- **Terminal** zadržava `cwd` (sada postavljen = grupin `cwd` pri kreiranju), `kind`,
  `startupCommand`. Spawn sloj (`nodePtySpawner`/`TerminalView`) ostaje nepromijenjen
  (i dalje koristi `terminal.cwd`).

**Migracija** — čista funkcija `migrateWorkspace(raw): Workspace` (poziva se u
`createInitialState`):
- Ako grupa ima `terminals` (stari oblik) i nema `features`: `group.features =
  [{ id, name: 'general', collapsed: false, terminals: group.terminals }]`,
  `group.cwd = group.cwd ?? ''`, ukloni `group.terminals`.
- Ako grupa već ima `features`: ostavi kako jeste (idempotentno).
- Stari `group.viewMode` (ako postoji) → prebaci na default feature.

**AppState** dobija `activeFeatureId` (uz postojeće `activeGroupId`, `activeTerminalId`).
Aktivni feature određuje skup tabova/grid; aktivni terminal pripada aktivnom feature-u.

## 2. Kreiranje (UX)

- **Grupa**: mali modal sa poljima *Ime* + *Radni direktorijum* (placeholder `~`,
  prazno === home) i **Browse…** dugmetom koje otvara nativni folder picker
  (`dialog.showOpenDialog`, `properties: ['openDirectory']`) preko novog IPC-a
  `dialog:pickDirectory`.
- **Feature**: inline ime (input u zaglavlju grupe, kao v3 grupni input), bez modala.
- **Terminal**: inline ime (input u zaglavlju feature-a), **bez modala**. `cwd` =
  grupin `cwd`; bez startup pitanja. Quick-launch (Claude/Codex) pravi terminal u
  aktivnom feature-u (ime `claude`/`codex`, `startupCommand`, `kind`, `cwd` = grupin).
- `NewTerminalDialog` se uklanja (zamijenjen inline unosom).

## 3. Sidebar (3 nivoa)

- Grupa (collapsible) → Feature (collapsible) → Terminal.
- Pored imena grupe prikazati `cwd` sitno, polu-transparentno (`text-fg-muted text-xs`),
  skraćeno (npr. `~/dev/proj` ili bazno ime).
- **Desni klik na grupu** → kontekst meni: **Rename**, **Open in Files**
  (`shell:openPath` → `shell.openPath(group.cwd || homedir)`).
- **Rename svuda** (grupa/feature/terminal): dvoklik na ime → inline edit (Enter
  potvrdi, Escape otkaži); za grupu dostupno i preko desnog klika.
- Hover akcije na **grupi**: `+ feature`, brisanje grupe (rename preko dvoklika/desnog klika).
- Hover akcije na **feature-u**: `+ terminal`, **Claude**, **Codex** (quick-launch u TAJ
  feature), grid toggle, brisanje feature-a. Quick-launch je dakle na feature nivou
  (+ u TabBar-u za aktivni feature) — nikad na grupi (grupa ima više feature-a).

## 4. Tabovi / grid

Po **aktivnom feature-u**:
- `TabBar` prikazuje terminale aktivnog feature-a.
- Grid toggle mijenja `feature.viewMode`; grid raspoređuje terminale aktivnog feature-a.
- App rendering: svi terminali (svih feature-a svih grupa) ostaju mountovani kao
  stabilni siblinzi (kao v3); vidljivost/raspored po aktivnom feature-u + viewMode.

## 5. Live ikonica (#3)

- Main: poller (`setInterval`, ~1000 ms) prolazi kroz aktivne PTY-jeve i čita
  `pty.process` (node-pty foreground proces). Mapiranje: ime sadrži `claude` →
  `'claude'`, `codex` → `'codex'`, inače `null`. Na promjenu šalje `pty:proc
  {id, agent}` rendereru.
- `ptyManager` izlaže `processName(id)`; poller u main `index.ts`/`ipc.ts`.
- Renderer drži transientnu mapu `liveAgents: Record<id, 'claude'|'codex'|undefined>`
  (NE perzistira se). Prikazana ikonica terminala = `liveAgents[id] ?? terminal.kind
  ?? 'shell'`. Kad agent izađe (`null`) → vraća se na `kind`/`shell`.
- Čista helper funkcija `detectAgent(processName): AgentKind | null` (testabilna).

## 6. Open in Files (IPC)

Novi kanal `shell:openPath` (renderer → main, fire-and-forget): main poziva
`shell.openPath(path)` (Electron) → otvara sistemski file manager na zadatom putu.

## 7. Testiranje

- `migrateWorkspace`: stari oblik (group.terminals) → novi (group.features=[general]);
  idempotentnost na novom obliku; prazna grupa.
- Store reduceri: `addGroup` (sa cwd), `renameGroup`, `addFeature`, `renameFeature`,
  `deleteFeature`, `toggleFeatureCollapsed`, `toggleFeatureViewMode`, `addTerminal`
  (u feature, nasljeđuje cwd), `removeTerminal`, `renameTerminal`, `setActiveFeature`,
  `setActiveTerminal` (postavlja i grupu i feature), selektori (`getActiveFeature`,
  `allTerminals`).
- `detectAgent(process)` mapiranje.
- Sidebar/TabBar render (3 nivoa, rename, kontekst meni stavke, launch dugmad).
- Live polling, native dialog, `shell.openPath` = manual E2E.

## 8. Faze (jedan spec → jedan plan u fazama)

1. **Model + migracija + store** (types, migrateWorkspace, svi reduceri/selektori, AppState.activeFeatureId).
2. **Sidebar 3-nivoa** (render Grupa→Feature→Terminal, cwd prikaz, ikone, rename inline).
3. **Kreiranje + IPC** (group modal+Browse `dialog:pickDirectory`, feature/terminal inline, `shell:openPath`, desni-klik meni).
4. **Tabovi/grid po feature-u + App glue** (active feature, viewMode po feature-u, grid render).
5. **Rename svuda** (feature/terminal inline; usklađivanje sa Sidebar-om iz faze 2 ako treba).
6. **Live ikonica** (ptyManager.processName, main poller, `pty:proc` IPC, renderer liveAgents, detectAgent).

## Van obima
Feature sa sopstvenim cwd-om; drag-and-drop premještanje terminala/feature-a; pretraga;
kontekst meni na feature/terminal nivou (osim rename dvoklikom).
