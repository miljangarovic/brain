# OrchestriX V6 — Feature header + objedinjeni „+" meni (Design)

**Datum:** 2026-06-08
**Status:** Odobreno (brainstorming faza)
**Grana:** `feat/v6-feature-header` (od `master`)

Tri UX izmjene: (1) jedinstveni „+" meni {Claude, Codex, Terminal} umjesto odvojenih
dugmadi; (2) klik na grid aktivira feature (ne samo toggle); (3) novi *feature header*
iznad tabova (naziv + relay + grid + „+"), red tabova ostaje čist.

---

## 1. Nove komponente

### `AddMenuButton.tsx`
„+▾" dugme koje otvara mali meni sa tri stavke: **Claude · Codex · Terminal**.
- Reuse postojećeg `ContextMenu` (`{ x, y, items, onClose }`); pozicija = ispod
  dugmeta preko `e.currentTarget.getBoundingClientRect()` (x=`rect.left`, y=`rect.bottom`).
- Drži svoje lokalno `open`/coords stanje.
- Prop: `onAdd(kind: 'shell' | 'claude' | 'codex'): void`. Stavke:
  Claude → `onAdd('claude')`, Codex → `onAdd('codex')`, Terminal → `onAdd('shell')`.
- Koristi se na **dva** mjesta (glavni header + sidebar feature-red) → DRY.

### `FeatureHeader.tsx`
Traka iznad `TabBar`-a; renderuje se **samo kad postoji aktivan feature**.
- Lijevo: naziv aktivnog feature-a (`text-sm font-medium`).
- Desno (cluster): relay dugmad (uslovno) → Grid toggle → `AddMenuButton`.
- Props:
  ```ts
  {
    featureName: string
    viewMode: 'tabs' | 'grid'
    onToggleView: () => void
    onAdd: (kind: 'shell' | 'claude' | 'codex') => void
    relay: { canReturn: boolean; canReReview: boolean; canMarkApplied: boolean }
    onReturnToOrigin: () => void
    onReReview: () => void
    onMarkApplied: () => void
  }
  ```
- Relay dugmad (`→ Vrati u A`, `↻ Ponovi review`, `✓ Gotovo`) i Grid dugme = isti
  izgled/klase kao sad u `TabBar`-u (samo premješteni).

## 2. Izmjene postojećih

### `TabBar.tsx` (stanjenje)
- **Uklanja** iz desnog clustera: relay dugmad, Grid toggle, „+", Claude, Codex.
  Cijeli desni `<div>` cluster nestaje.
- Props se svode na: `terminals, activeId, liveAgents, onSelect, onClose,
  reviewStatus, onReviewTerminal`. (Uklanjaju se: `viewMode, onAdd, onLaunch,
  onToggleView, relay, onReturnToOrigin, onReReview, onMarkApplied`.)
- Red tabova (ikona · status-dot · ime · review-hover · ×) ostaje nepromijenjen.

### `Sidebar.tsx`
- Feature-red: tri dugmeta (`+`, Claude, Codex) → jedan `AddMenuButton` sa
  `onAdd={(kind) => kind === 'shell' ? onAddTerminal(f.id) : onLaunchAgent(f.id, kind)}`.
  Grid i Trash ostaju. (`hoverBtn` stil zadržan za AddMenuButton trigger po mogućnosti.)
- Grid dugme i dalje zove `onToggleFeatureView(f.id)` — promjena je u App handleru (§3).

### `App.tsx`
- Renderuje `<FeatureHeader>` između sidebar-glavne-kolone i `<TabBar>`-a, samo kad
  `activeFeature` postoji.
- `<TabBar>` poziv: ukloni premještene props-e.
- `<FeatureHeader>` poziv: `featureName={activeFeature.name}`,
  `viewMode={activeFeature.viewMode ?? 'tabs'}`,
  `onToggleView={() => apply(s => toggleFeatureViewMode(s, activeFeature.id))}`,
  `onAdd={(kind) => kind === 'shell' ? apply(s => addTerminal(s, activeFeature.id, { name: 'shell' })) : launchAgent(activeFeature.id, kind)}`,
  `relay={relayFlags}` + tri relay handlera (kao što su sad na TabBar-u).
- **#2 grid-activate:** `onToggleFeatureView` prosljeđen Sidebar-u postaje
  „aktiviraj pa toggluj": `apply(s => toggleFeatureViewMode(setActiveFeature(s, fid), fid))`.
  (`setActiveFeature` već postoji u store-u i postavlja aktivni feature + prvi terminal.)
  Header-ov grid (feature je već aktivan) može koristiti običan toggle — ali radi
  konzistentnosti koristi isti composed handler je bezbjedno.

## 3. Ponašanje (sažeto)

- **#1:** „+" svuda otvara meni {Claude, Codex, Terminal}; bira se vrsta novog terminala.
- **#2:** klik na grid (sidebar) na neaktivnom feature-u → feature postane aktivan u grid
  prikazu; na aktivnom → toggle grid/tabs.
- **#3:** glavni ekran = `FeatureHeader` (naziv | relay · grid · +) iznad `TabBar`-a
  (samo tabovi) iznad terminal površine.

## 4. Testiranje

- `AddMenuButton.test.tsx`: klik na „+" otvara meni sa tri stavke; klik na stavku zove
  `onAdd` sa ispravnim `kind`-om (`claude`/`codex`/`shell`).
- `FeatureHeader.test.tsx`: prikazuje naziv; Grid dugme zove `onToggleView`; „+" stavke
  zovu `onAdd`; relay dugmad se prikazuju/skrivaju po `relay` flagovima i zovu handlere.
- `TabBar.test.tsx`: ukloniti props-e koji više ne postoje; assert da grid/+/relay
  više NISU u TabBar-u (po potrebi); tabovi i dalje rade.
- `Sidebar.test.tsx`: AddMenuButton prisutan; klik na grid zove `onToggleFeatureView`.
- Postojeći store testovi za `setActiveFeature`/`toggleFeatureViewMode` pokrivaju #2
  kompoziciju (App-level glue je manual/E2E).

## 5. Van obima
Spawn logika, review petlja, persistencija, keybindings — netaknuti. Bez novih store
reducera (koristi se postojeći `setActiveFeature` + `toggleFeatureViewMode`).
