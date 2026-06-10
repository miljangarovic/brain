# Attention Routing — „koji agent traži mene?" (Dizajn)

**Datum:** 2026-06-09
**Status:** Odobreno (brainstorming faza)

## Cilj

OrchestriX postoji da bi se pratilo i orkestriralo više AI-agent terminala
odjednom. Kad vrtiš desetine agenata, ne možeš da gledaš sve — treba ti da te
app **sam pozove** kad neki agent traži tvoju pažnju. Trenutno `busyTracker`
detektuje samo *da agent proizvodi izlaz*; ne postoji pojam „agent te čeka", a
nativne OS notifikacije se nigde ne koriste.

Ovaj feature uvodi **attention routing**: detekciju kad agent treba korisnika i
usmeravanje te informacije kroz četiri kanala (OS notifikacija, zvuk, sidebar
badge, attention queue).

## Obim

**U obimu:**

- **Samo agent terminali** (`kind` = `claude` / `codex`). Obični shell-ovi se
  ignorišu — „idle/gotovo" i „permission prompt" imaju jasno značenje samo za
  agente, i to drži feature bez šuma.
- Tri okidača:
  1. **`waiting-input`** — agent je stao na permission/confirm prompt (hitno).
  2. **`done`** — agent je prestao da proizvodi izlaz i izgleda gotov / čeka
     sledeću instrukciju (info).
  3. **`error`** — proces je izašao s ne-nula kodom / neočekivano.
- Četiri kanala obaveštavanja: nativna OS notifikacija, zvučni signal,
  in-app sidebar badge/dot, attention queue (lista).

**Van obima (YAGNI):**

- Ručni „ping me kad ovaj završi" (može kasnije).
- Settings/theme panel — za v1 samo mute toggle u `localStorage`.
- Custom zvučni fajlovi — v1 koristi Web Audio beep bez asseta.
- Non-agent (shell) terminali.
- Perzistencija attention stanja — transientno je, kao `busy`; ne ide u
  `workspace.json`.

## Model stanja (runtime, ne perzistira se)

Po terminalu jedan `AttentionState`:

```ts
type AttentionState = 'waiting-input' | 'done' | 'error' | 'none'
```

- `waiting-input` — permission/confirm prompt (amber, hitno)
- `done` — agent stao, izgleda gotov / čeka instrukciju (plavo, info)
- `error` — proces izašao s ne-nula kodom (crveno)
- `none` — sve čisto

Globalni **attention queue**: uređena lista stavki, sortirana po vremenu (najnovije
gore):

```ts
type AttentionItem = { terminalId: string; state: AttentionState; lastLine: string; ts: number }
```

`ts` se prosleđuje spolja (renderer stamp-uje vreme kroz `Date.now()` u event
handleru) — čista logika ga ne generiše sama.

## Arhitektura i komponente

Svaka jedinica ima jednu jasnu svrhu, definisan interfejs, testira se nezavisno.

### Main proces (nova nativna sposobnost)

**`src/main/notifications.ts`**

- Odgovornost: prikaz nativne OS notifikacije i propagacija klika.
- Interfejs:
  - `showNotification({ key, title, body }: { key: string; title: string; body: string }): void`
    — kreira Electron `Notification`; na `click` fokusira `BrowserWindow` i šalje
    push `notification:click { key }` rendereru.
  - Ako `Notification.isSupported()` vrati `false` ili konstrukcija baci →
    no-op (try/catch).
- Novi IPC:
  - `notify:show` (send) — payload `{ key, title, body }`.
  - `notification:click` (push, main→renderer) — payload `{ key }`.
- `key` = `terminalId`, da klik može da se mapira nazad na terminal.

Registruje se u `registerIpc()` (`src/main/ipc.ts`); preload izlaže
`window.orchestrix.showNotification(...)` i `onNotificationClick(cb)`.

### Renderer (paralela postojećem `src/renderer/src/review/`)

**`src/renderer/src/attention/detect.ts`** — čista logika (bez side-efekata)

```ts
type IdleState = 'waiting-input' | 'done'
function stripAnsi(s: string): string
const PERMISSION_PATTERNS: RegExp[]
function classifyIdle(tail: string): IdleState   // pattern match → 'waiting-input', inače 'done'
```

`PERMISSION_PATTERNS` (početni skup, lako proširiv, case-insensitive):
`(y/n)`, `[y/N]`, `[Y/n]`, `do you want`, `would you like`, `approve`, `allow`,
`proceed?`, `❯ 1.` (numbered choice prompt), `press enter`, `continue?`.
Ovo je jedini „fragilan" deo — izolovan, 100% unit-testabilan, degradira
graciozno (fallback `done`).

**`src/renderer/src/attention/sound.ts`** — tanak

```ts
function beep(state: AttentionState): void   // Web Audio oscillator; drugačiji ton za 'error'
```

- Mute stanje čita iz `localStorage` (`attentionMuted`). Ako je AudioContext
  blokiran (autoplay policy) → progutaj tiho.

**`src/renderer/src/attention/useAttention.ts`** — hook (kao `useReview`)

- Odgovornost: žičenje svega zajedno.
- Sluša `pty:busy` i `pty:exit`.
- Na `busy:false` za **agent** terminal koji NIJE pod review nadležnošću: čita
  tail preko registry-ja → `classifyIdle` → primeni suzbijanje → po potrebi
  postavi stanje, dodaj u queue, okини notifikaciju + zvuk.
- Na `pty:exit { code }`: ako `code !== 0` → `error` (ista logika suzbijanja);
  `code === 0` → tiho (čist exit, pretpostavka: namerno).
- Izlaže: `attention: Map<terminalId, AttentionState>`, `queue: AttentionItem[]`,
  i akcije `clear(terminalId)`, `clearAll()`, `toggleMute()`.

**Tail registry** — `src/renderer/src/attention/tailRegistry.ts`

```ts
function registerTail(id: string, read: () => string): void
function unregisterTail(id: string): void
function readTail(id: string): string   // '' ako nije registrovan
```

`TerminalView` na mountu registruje čitač koji vraća zadnjih ~20 linija iz svog
`xterm` bafera (`term.buffer.active`), join-ovane kao plain tekst; na unmountu
deregistruje. Tako attention logika dobija poslednji izlaz već ANSI-parsiran, bez
zasebnog baferovanja u main-u.

**UI komponente**

- `src/renderer/src/components/AttentionBell.tsx` — zvonce + brojač na vrhu
  sidebar-a (cross-project scope). Brojač = broj terminala u stanju ≠ `none`.
  Klik otvara popover.
- `src/renderer/src/components/AttentionQueue.tsx` — popover lista: ikonica
  stanja, putanja `Projekat › Feature › Terminal`, snippet poslednje linije,
  relativno vreme. Klik na stavku → bira terminal (set aktivni grupu/feature/
  terminal) + `clear`. Dugmad **Clear all** i **mute** (zvučnik).
- Per-terminal dot — u `Sidebar` redovima i `TabBar` tabovima, isti slot/pattern
  kao `ReviewStatusDot`, zasebna paleta: `waiting-input`=amber, `done`=plavo,
  `error`=crveno.

`App.tsx` instancira `useAttention`, prosleđuje `attention` mapu Sidebar-u/
TabBar-u, i renderuje `AttentionBell`.

## Tok podataka

```
pty:busy {id, busy:false}   (agent terminal; busyTracker već debounce-uje, prag ~1.5s = isti kao spinner)
        │
        ▼
useAttention: terminal pod review nadležnošću?  → DA → preskoči (review status vodi njega)
        │ NE
        ▼
readTail(id) → classifyIdle(tail) → state ('waiting-input' | 'done')
        │
        ├─ terminal aktivan I prozor fokusiran?  → ti već gledaš → state ostaje 'none'
        │
        └─ inače → set state, dodaj u queue (ts = Date.now()), OS notifikacija + zvuk + badge

pty:exit {id, code≠0}  → state='error' (ista logika suzbijanja);  code===0 → tiho

Čišćenje:
  terminal postane aktivan + prozor fokusiran  → clear(id)
  terminal ponovo busy (busy:true, odgovorio si) → clear(id)
  klik na stavku u queue-u                       → select + clear(id)
```

**Granica nadležnosti prema review-u:** preskaču se (a) terminali koji imaju
`review` link (reviewer terminali) i (b) terminali na koje neki aktivni reviewer
pokazuje preko `review.originTerminalId` (origin terminali). Oba skupa su
izvodljiva iz postojećeg workspace stanja. Review status već signalizira te
terminale — bez duplih signala.

## Pravila suzbijanja (precizno)

1. OS notifikacija + zvuk + badge se okidaju **samo ako NIJE** (terminal aktivan
   **I** prozor fokusiran).
2. Ako u trenutku okidanja jeste aktivan+fokusiran → stanje ostaje `none`.
3. **Jedna** notifikacija + **jedan** zvuk po *ulasku* u stanje — bez ponavljanja
   dok stanje traje (dedup po `terminalId` + prelazu).
4. **Čišćenje** kad: terminal postane aktivan+fokusiran, **ili** terminal ponovo
   postane busy, **ili** klik na stavku u queue-u.
5. **Mute** gasi samo zvuk; badge i OS notifikacija ostaju.
6. **Čist exit (kod 0) = tiho.** Samo ne-nula kod → `error`.
7. Prag „idle" = isti `busy→idle` signal koji već pokreće spinner (~1.5s), pa je
   konzistentno s onim što korisnik vidi; kratke pauze ne okidaju.
8. **Startup grace (~4s):** odmah po pokretanju app-a, restaurirani agenti se
   „slegnu" (resume redraw → idle) i bez ovoga bi izbacili roj notifikacija.
   Tokom grace prozora `idle`/`exit` događaji se ignorišu (bez stanja, bez zvuka,
   bez notifikacije). Sprečava notification-storm na svakom pokretanju.
9. **„Armed" gating (revizija „touched" pravila):** idle-izvedeni signali
   (`waiting-input`/`done`) okidaju samo za terminale u kojima je korisnik kucao
   **od poslednjeg alerta** (keydown naoruža, okidanje alerta razoruža). Restaurirani
   agenti koje korisnik nije dirao nikad ne alarmiraju; pozadinski repaint posle
   već isporučenog alerta ne okida ponovo. `error` (exit) NIJE gate-ovan — pad je
   vredan znati i za nedirnut terminal.
10. **Minimalni radni raspon (`MIN_WORK_MS` = 1.5s):** `busy→idle` prelaz važi kao
   „turn je završen" samo ako je busy faza trajala ≥ 1.5s. Redraw blip (resize/
   SIGWINCH/prebacivanje feature-a → burst izlaza → idle) traje ispod sekunde i
   ne sme da okine „{ime} is done" za sesiju koja se nije ni vrtela. Span se meri
   u rendereru od `busy:true` do `busy:false`; `busy:false` bez viđenog starta
   računa se kao raspon 0 (suzbijeno).

Prozor-fokus se prati u rendereru (`window` `focus`/`blur` + `document.hasFocus()`)
— nije potreban novi IPC za fokus. „Aktivni terminal" je već u `App` stanju.

## Rukovanje greškama

- `Notification` nedostupan / baci → try/catch no-op; badge i queue rade dalje.
- Tail čitanje padne (terminal disposed / nije u registry) → fallback `done`.
- Zvuk blokiran (autoplay policy) / AudioContext baci → progutaj tiho.
- Prazan xterm bafer → `done`.

## Testiranje

- `detect.ts` — unit: permission pattern-i (pozitivni i negativni primeri),
  `stripAnsi`, fallback na `done`.
- `useAttention` — sa mock listener-ima + mock registry: suzbijanje
  (aktivan+fokusiran), čišćenje na busy, čišćenje na fokus, redosled queue-a,
  preskakanje review terminala, dedup (jedan notify po prelazu), exit kod 0 vs ≠0.
- `notifications.ts` (main) — tanak smoke test (mock Electron `Notification`):
  poziva konstruktor, klik emituje `notification:click`.
- `AttentionQueue` / `AttentionBell` — render test: brojač, lista, klik
  bira+čisti, mute toggle.
- `sound.ts` — tanak; manuelna provera tona.

## Novi IPC kanali (rezime)

| Kanal | Smer | Payload | Svrha |
|---|---|---|---|
| `notify:show` | renderer→main (send) | `{ key, title, body }` | Prikaži OS notifikaciju |
| `notification:click` | main→renderer (push) | `{ key }` | Klik na notifikaciju → fokusiraj terminal |
