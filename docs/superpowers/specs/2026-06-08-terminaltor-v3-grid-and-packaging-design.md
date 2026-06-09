# OrchestriX V3 — Split Grid + Packaging (Design)

**Datum:** 2026-06-08
**Status:** Odobreno (brainstorming faza)

Dvije nezavisne funkcije: (A) split paneli unutar grupe preko "grid" view-moda i
(B) pakovanje aplikacije u AppImage i .deb. Rade se na jednoj grani
(`feat/v3-grid-and-packaging`) sa jednim planom (dvije sekcije); split prvi (kod),
pakovanje drugo (build).

---

## A) Split paneli — Grid toggle

### Cilj
Grupa se može gledati kao **Tabs** (fokus jedan terminal — trenutno ponašanje) ili
**Grid** (svi terminali grupe poslagani u ravnomjernu mrežu, vidljivi istovremeno).
Motiv: pratiti više AI agenata u jednom feature-u odjednom.

### Model
- `Group` dobija `viewMode?: 'tabs' | 'grid'` (default `tabs`, perzistira se;
  `undefined` === `tabs` za backward compat sa starim workspace-ima).
- Store reducer `toggleGroupViewMode(state, groupId)` — flipuje mod grupe.

### Layout (sigurno po PTY-jeve)
Princip: **svi `TerminalView`-ovi ostaju mountovani kao stabilna lista siblinga**
u jednom kontejneru; pri promjeni moda mijenja se samo CSS (klasa/stil), nikad
pozicija u React stablu — pa se nijedan shell ne ubija/remount-uje.

Za svaki terminal `t` (preko svih grupa) računa se njegov layout od:
- `inActiveGroup` — pripada li aktivnoj grupi
- `gridMode` — `activeGroup.viewMode === 'grid'`
- `isActive` — `t.id === activeTerminalId`

Pravila:
- `!inActiveGroup` → `display:none` (živ, skriven).
- `inActiveGroup && !gridMode` → `absolute inset-0`, vidljiv samo ako `isActive`.
- `inActiveGroup && gridMode` → grid ćelija (`position: relative`, `display:block`),
  svi vidljivi; fokusirani (`isActive`) dobija accent ivicu; klik na ćeliju ga
  postavlja aktivnim.

Kontejner:
- `gridMode` → `display:grid`, `grid-template-columns: repeat(cols, 1fr)` gdje je
  `cols = gridColumns(n)` za `n` = broj terminala aktivne grupe; `display:none`
  ćelije (drugih grupa) ispadaju iz mreže.
- inače → `position: relative` (kao sada).

`gridColumns(n)`: `n<=1 → 1`, inače `ceil(sqrt(n))` (1→1, 2→2, 3→2, 4→2, 5→3, 9→3).

**Refit:** postojeći `ResizeObserver` u `TerminalView` okida `fit()` kad ćelija
pređe iz `display:none` (0px) u stvarnu veličinu — pa grid prikaz radi bez izmjene
`TerminalView`-a. (Ako se u praksi pokaže potreba, dodaje se eksplicitan refit na
promjenu `gridMode`.)

### UI
- Dugme u `TabBar` (desno, uz `+`) sa grid/tabs ikonicom prebacuje `viewMode`
  aktivne grupe (`aria-label` "Grid prikaz" / "Tabs prikaz").
- Prečica `Ctrl+Shift+G` — toggle grida aktivne grupe.

### Komponente
- `store.ts` — `toggleGroupViewMode` (+ `Group.viewMode`).
- `layout.ts` (novi, renderer) — čista funkcija `gridColumns(n)` i helper za
  per-terminal layout odluku (`terminalLayout(...)`) da App ostane tanak i testabilan.
- `TabBar.tsx` — dugme za toggle (+ ikonica grid/tabs u `icons.tsx`).
- `App.tsx` — koristi `viewMode`/layout helper da rasporedi terminale; `Ctrl+Shift+G`.

### Testovi
- `layout.test.ts` — `gridColumns(n)` za niz vrijednosti; `terminalLayout` vraća
  ispravan mod (hidden/stacked/grid) po ulazu.
- `store.test.ts` — `toggleGroupViewMode` flipuje i default je `tabs`.
- `TabBar.test.tsx` — toggle dugme zove handler; ikonica reflektuje mod.
- Sam vizuelni grid = manual E2E.

### Van obima
Ručni binarni split (tmux), drag-resize ivica, izbor podskupa panela.

---

## B) Pakovanje — AppImage + .deb

### Cilj
`npm run package` proizvodi distribuirajuće Linux artefakte (AppImage i .deb) u
`release/`.

### Alat i konfiguracija
- `electron-builder` (devDep). Config u `electron-builder.yml`.
- `appId: com.orchestrix.app`, `productName: OrchestriX`, kategorija `Development`.
- `directories.output: release`, `directories.buildResources: build`.
- `files`: `out/**` (electron-vite output) + `package.json`.
- Linux targeti: `AppImage`, `deb`; `maintainer`, `synopsis`.

### Native modul (node-pty)
- `asarUnpack: ['**/node_modules/node-pty/**']` da se `.node` učita iz raspakovanog
  foldera u pakovanoj app.
- `electron-builder install-app-deps` (preko `postinstall` ili ručno) rebuild-uje
  node-pty za ciljani Electron ABI prije pakovanja.

### Ikona
- `build/icon.svg` — One Dark mark: tamni rounded kvadrat (`--od-surface`) + accent
  `>_` prompt (`--od-accent`).
- Rasterizacija u `build/icon.png` (512×512) skriptom `scripts/make-icon.mjs`.
  Redoslijed pokušaja alata: `rsvg-convert` → ImageMagick `convert`/`magick` →
  Node `sharp` (devDep fallback). Skripta bira prvi dostupan; ako nijedan, jasno
  prijavi i uputi korisnika. `icon.png` se commituje da build ne zavisi od alata.

### Skripte (package.json)
- `"package": "electron-vite build && electron-builder --linux AppImage deb"`
- `"icon": "node scripts/make-icon.mjs"`

### Provjera (headless ograničenje)
`electron-builder` pakovanje radi headless (ne treba GUI), ali je sporo i pravi
velike artefakte. Implementacija provjerava da `electron-vite build` prođe i da je
`electron-builder.yml` validan; **stvarni `npm run package`** (koji preuzima
electron binarije i pravi AppImage/deb) je korak koji pokreće korisnik/agent
jednom na kraju, uz napomenu o veličini/trajanju.

### Testovi
Build/konfiguracija — nema unit testova; verifikacija je uspješan `electron-vite
build` + (na kraju) uspješan `electron-builder` koji ispiše putanje do `.AppImage`
i `.deb`.

### Van obima
Auto-update, code signing, Windows/macOS targeti, Flatpak/snap.

---

## Redoslijed
1. A1–A4: grid (store → layout helper → TabBar/icon → App glue + shortcut).
2. B1–B3: electron-builder config → ikona → package skripta + (završni) build.
