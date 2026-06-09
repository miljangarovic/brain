# OrchestriX V5 — Cross-agent Review (Design)

**Datum:** 2026-06-08
**Status:** Odobreno (brainstorming faza)
**Grana:** nadovezuje se na `feat/v4-features-hierarchy`

Uvodi **unakrsni review**: bilo koji terminal može dobiti review od *drugog*
agenta (Claude ↔ Codex). Review se vrti kroz N iteracija, vođen **fajlovima**
(ne struganjem terminala), sa vizuelnim statusom (spinner / žuto) da korisnik
fire-and-forget okine review i vrati se na rezultat.

---

## 0. Polazna realnost (zašto baš ovako)

Terminal u OrchestriXu je sirovi PTY koji xterm renderuje. Kad u njemu radi
`claude`/`codex`, to su TUI (Ink) aplikacije koje stalno precrtavaju ekran. Zato:

- **Scrape xterm buffera / sirovog PTY streama je nepouzdan** za TUI — daješ
  reviewu šum (okviri, brojači tokena, cursor-move-ovi), ne čistu konverzaciju.
- **Zato review NE prima konverzaciju.** Prima **artefakt**: spec `.md` fajl ili
  `git diff`. To je čist, stabilan, jednoznačan ulaz.
- **Handoff ide preko fajla**, ne preko transkripta: reviewer (B) svoju kritiku
  *upiše u fajl*, mi samo ubacimo kratak pointer u implementatora (A). Nigdje ne
  parsiramo transkript, nigdje ne stružemo TUI.
- **Status („gotov / radi") se ne može pouzdano izvesti iz PTY-ja**, ali se MOŽE
  iz fajlova (`fs.watch`): „review fajl je zapisan" = reviewer gotov; „spec fajl
  izmijenjen" = implementator gotov. Status je dakle isto fajlovima-vođen.

## 1. Pojmovi

- **A — implementer (origin):** terminal čiji rad recenziramo (agent koji je
  napisao spec ili kod).
- **B — reviewer:** novi terminal sa *drugim* agentom, koji čita artefakt i piše
  kritiku u fajl.
- **Runda (N):** jedan ciklus B→A. Svaka runda ima svoj `review-N.md`.
- **Tip review-a:** `spec` (artefakt = `.md` fajl) ili `impl` (artefakt = `git diff`).

## 2. Tok (happy path)

```
[A: claude radi spec.md]
  │  desni klik na A → Review ▸ Codex (tip: spec, fajl: spec.md, namjera: "…")
  ▼
[B: codex spawnuje se u istom feature-u]   B status: 🔄 reviewing
  │  B čita spec.md, upiše kritiku u review-1.md
  ▼
  review-1.md zapisan (fs.watch)            B status: 🟡 review-ready
  │  korisnik klikne na B "→ Vrati u A"
  ▼
  inject u A stdin: "pročitaj review-1.md, ažuriraj spec.md"   A status: 🔄 applying
  │  A ažurira spec.md
  ▼
  spec.md izmijenjen (fs.watch)             A status: 🟡 iteration-done
  │  korisnik klikne na A "↻ Ponovi review"
  ▼
  inject u B stdin: "spec ažuriran, ponovo pregledaj, upiši review-2.md"
  … loop dok korisnik ne odluči da je gotovo …
```

Korisnik vodi petlju; **nema auto-konvergencije** (kad je „savršeno" odlučuje on).

## 3. Model (types)

`src/shared/types.ts` — `Terminal` dobija opcioni `review` (samo **reviewer**
terminal nosi link; origin se izvodi pretragom):

```ts
export type ReviewKind = 'spec' | 'impl'

export interface ReviewLink {
  originTerminalId: string   // A — koga ovaj terminal recenzira
  reviewKind: ReviewKind
  specPath?: string          // apsolutna putanja artefakta (samo za 'spec')
  reviewDir: string          // apsolutni dir za review-N.md (van projekta)
  round: number              // tekuća runda (1-based)
}

export interface Terminal {
  id: string
  name: string
  cwd: string
  startupCommand?: string
  shell?: string
  kind?: TerminalKind
  review?: ReviewLink        // prisutno samo na reviewer terminalu (B)
}
```

`review` se **perzistira** (u `workspace.json`) — da dugmad i runde prežive
restart. Na restart se startupCommand re-runuje (postojeće ponašanje za
claude/codex) → B bi se re-pokrenuo; prihvatljivo (vidi §9 Caveati).

**Status je transientan** (NE perzistira), kao `liveAgents` u V4:

```ts
export type ReviewStatus = 'reviewing' | 'review-ready' | 'applying' | 'iteration-done'
// Mapa u App-u: reviewStatus: Record<terminalId, ReviewStatus | undefined>
```

Vizuelno: `reviewing`/`applying` → 🔄 spinner (animiran); `review-ready`/
`iteration-done` → 🟡 žuti dot. Odsustvo → bez indikatora.

## 4. Putanje fajlova (van projekta)

Review fajlovi **ne smiju u git**. Žive u app-data diru (kao `workspace.json`):

```
<userData>/reviews/<originTerminalId>/review-<N>.md
```

- `userData` = `app.getPath('userData')` (npr. `~/.config/OrchestriX`).
- Ključ je **originTerminalId** (A) — sve runde jednog review-a su na okupu.
- Dir se kreira lijeno (`mkdir -p`) pri startu review-a.

## 5. Prompt-ovi (čiste funkcije)

`src/renderer/src/review/prompt.ts` — sve su čiste funkcije (testabilne), vraćaju
string koji ide kao `startupCommand` (za B) ili kao inject u stdin (relay).

- `reviewerPrompt({ kind, specPath, reviewFile, intent })`:
  - **spec:** „Pregledaj spec u `<specPath>`. Cilj autora: `<intent | izvedi iz
    dokumenta>`. Oceni: ispravnost, rupe, kontradikcije, scope (YAGNI),
    izvodljivost. Budi konkretan i kritičan. Kritiku **upiši** u `<reviewFile>`.
    Ne mijenjaj spec sam."
  - **impl:** „Pokreni `git status` i `git diff` u ovom repou i pregledaj
    necommitovane izmjene. Cilj: `<intent>`. Oceni: bugove, edge-case-ove,
    ispravnost, jednostavnost. Kritiku **upiši** u `<reviewFile>`. Ne commituj."
- `relayToOriginPrompt({ kind, reviewFile, specPath })`:
  - **spec:** „Reviewer je ostavio kritiku u `<reviewFile>`. Pročitaj je i ažuriraj
    `<specPath>` gdje se slažeš; gdje se NE slažeš, ukratko objasni zašto."
  - **impl:** „Reviewer je ostavio kritiku u `<reviewFile>`. Primijeni ispravke u
    kodu gdje se slažeš; gdje ne, objasni. Ne commituj."
- `reReviewPrompt({ kind, specPath, reviewFile })`: „Ažurirano je. Ponovo pregledaj
  `<specPath | git diff>` i upiši novu kritiku u `<reviewFile>` (runda N+1)."

Svi koriste **apsolutne** putanje (B i A mogu biti van cwd-a — vidi caveat dozvola).

## 6. Relay (injekcija u stdin)

Relay = `window.orchestrix.writePty(targetId, text)`. Pošto su A/B interaktivni
claude/codex:

- Višelinijski prompt: linije spojene sa `\n` (LF = nova linija, agent ne
  submituje), pa **na kraju jedan `\r`** (CR = submit). Isto kao postojeća
  Shift+Enter logika u `TerminalView`.
- Pretpostavka: meta terminal je **idle** (na promptu). Ako još odgovara, inject
  se može pomiješati — UI okida relay tek u `review-ready`/`iteration-done`
  stanju, što je upravo „meta je gotov".

## 7. IPC (nove kanale)

`src/shared/ipc.ts` + preload + `main/ipc.ts`:

| Kanal | Smjer | Svrha |
|-------|-------|-------|
| `dialog:pickFile` | invoke | File picker za spec (filter `*.md`), vraća abs put ili `null` |
| `review:suggestSpec` | invoke `{ cwd }` | Vrati abs put **zadnje-mijenjanog** `.md` ispod cwd-a (bounded depth, preskoči `node_modules`/`.git`), ili `null` |
| `review:resolveDir` | invoke `{ originTerminalId }` | `mkdir -p <userData>/reviews/<id>`, vrati abs dir |
| `fs:watch` | send `{ watchId, path }` | Počni pratiti fajl; debounce ~400 ms |
| `fs:unwatch` | send `{ watchId }` | Prekini praćenje |
| `fs:changed` | main→rend `{ watchId }` | Emit kad watchovani fajl nastane/se izmijeni |

Main drži `Map<watchId, FSWatcher>` + debounce tajmere. `fs.watch` na **fajlu**
(reviewFile ili specPath); za `impl` „A done" vidi §8.

## 8. Detekcija statusa (fs-vođena)

Renderer (App) drži `reviewStatus` mapu i pretplate na `fs:changed`. Watch-evi se
postavljaju u trenucima kad mi pokrećemo akcije:

| Trenutak (mi ga znamo) | Akcija | Watch koji postavljamo | Na `fs:changed` |
|---|---|---|---|
| Spawn B (runda N) | `B = reviewing` | `watch(reviewFile_N)` | `B = review-ready` |
| Klik „→ Vrati u A" | `A = applying` | spec: `watch(specPath)` · impl: §8.1 | `A = iteration-done` |
| Klik „↻ Ponovi review" | `B = reviewing`, round++ | `watch(reviewFile_N+1)` | `B = review-ready` |

**§8.1 — „A done" za `impl`:** nema jednog fajla. Best-effort: watch nad `cwd`
(rekurzivno, debounce dok se ne „smiri" ~1.5 s), ili **ručno** „označi gotovim"
dugme. V5: za `impl` tip → fallback na ručno dugme + (opciono) cwd-quiet
heuristiku; za `spec` tip → pun auto preko spec-file watch-a.

Spinner kreće odmah (mi znamo spawn/relay trenutak); žuto stiže iz fajla. Ako B
prvo traži dozvolu pa tek onda piše fajl — spinner korektno stoji do zapisa.

## 9. UI

**Ulazna tačka — pokreni review:**
- Desni-klik (context meni) na terminal **u Sidebar-u** i na **tab u TabBar-u** →
  stavka **„Review ▸ Claude / Codex"** (ponudi samo *drugi* agent u odnosu na
  `liveAgents[id] ?? kind`; ako je shell, ponudi oba).
- Otvara `ReviewDialog`.

**`ReviewDialog` (`components/ReviewDialog.tsx`):**
- *Reviewer:* Claude / Codex (predizabran suprotni agent).
- *Tip:* `Spec/plan` | `Implementacija` (radio).
- *Artefakt:* `spec` → input sa **auto-predloženim** putem (`review:suggestSpec`)
  + **Browse…** (`dialog:pickFile`); `impl` → prikaži „`git diff` u `<cwd>`"
  (bez unosa).
- *Namjera (opciono):* jedna linija.
- Confirm → orkestracija (§10).

**Status indikatori:** mali dot uz ime terminala **u Sidebar-u i na TabBar tabu**:
🔄 (reviewing/applying, animiran) / 🟡 (review-ready/iteration-done). Reuse stila
živih ikona iz V4.

**Relay dugmad** (u TabBar-u, za **aktivni** terminal koji učestvuje u review-u):
- aktivni je **reviewer (B)** i status `review-ready` → **„→ Vrati u A"**.
- aktivni je **origin (A)** (ima pridruženog reviewer-a) i status `iteration-done`
  → **„↻ Ponovi review"**.
- (opciono) `impl` A u `applying` → **„✓ Označi gotovim"** (ručni fallback, §8.1).

## 10. Orkestracija (renderer)

`src/renderer/src/review/orchestrate.ts` (ili hook `useReview`) — povezuje store,
IPC i prompt-ove. Glavne operacije:

- `startReview(originId, { reviewer, kind, specPath, intent })`:
  1. `reviewDir = await resolveDir(originId)`; `round = 1`; `reviewFile = reviewDir/review-1.md`.
  2. Kreiraj B: `addTerminal(activeFeatureOf(originId), { name: 'review: <reviewer>',
     kind: reviewer, startupCommand: reviewerPrompt(...) })`, pa na njega zalijepi
     `review: { originTerminalId, reviewKind, specPath, reviewDir, round }`.
  3. `reviewStatus[B] = 'reviewing'`; `fs:watch(reviewFile)`.
- `relayToOrigin(reviewerId)`: inject `relayToOriginPrompt(...)` u origin stdin;
  `reviewStatus[origin] = 'applying'`; watch spec (ili §8.1).
- `reReview(originId)`: nađi reviewer-a (`review.originTerminalId === originId`),
  `round++`, novi `reviewFile`, inject `reReviewPrompt(...)` u B; `reviewing` +
  watch.

Pure builderi (`prompt.ts`, putanje) su izolovani i testabilni; orchestrate samo
lijepi store-mutacije + IPC.

## 11. Testiranje

- **`prompt.ts`** (čiste): reviewerPrompt/relay/reReview za `spec` i `impl`,
  apsolutne putanje, prisustvo/odsustvo `intent`.
- **putanje:** `reviewFile(dir, n)` format, dir po originId.
- **store:** `Terminal.review` preživi addTerminal/rename/remove; selektor
  „nađi reviewer-a za origin"; round++ helper.
- **status reducer:** mapiranje (trenutak → status), `fs:changed` → tranzicija;
  dot boja po statusu.
- **`suggestSpec`** (čista jezgra ako se izdvoji): biranje najnovijeg `.md`,
  ignorisanje `node_modules`/`.git`.
- **Manual E2E:** stvarni claude↔codex round-trip, dozvole, relay submit,
  `fs.watch` debounce, restart sa perzistiranim `review`.

## 12. Faze (jedan spec → jedan plan u fazama)

1. **Model + putanje + prompt-ovi** (types `ReviewLink`/`ReviewStatus`,
   `review/paths.ts`, `review/prompt.ts` + testovi). Bez UI.
2. **IPC sloj** (`dialog:pickFile`, `review:suggestSpec`, `review:resolveDir`,
   `fs:watch`/`fs:unwatch`/`fs:changed` + preload/api/main).
3. **Orkestracija + store glue** (`review/orchestrate.ts`, `Terminal.review`
   perzistencija, `reviewStatus` u App-u, watch→status tranzicije).
4. **ReviewDialog + ulazna tačka** (context meni na Sidebar/TabBar, dijalog,
   auto-predlog spec-a).
5. **Status indikatori + relay dugmad** (dot u Sidebar/TabBar, „Vrati u A",
   „Ponovi review", `impl` ručni fallback).

## 13. Caveati (pošteno zabilježeno)

- **Dozvole:** review fajlovi su van cwd-a → A i B mogu jednom tražiti dozvolu za
  čitanje/pisanje van projekta. Podnošljivo (jednom po terminalu). Alternativa ako
  smeta: gitignored `.orchestrix/` *unutar* projekta (van obima V5).
- **Relay timing:** inject pretpostavlja idle meta-terminal; UI ga nudi tek u
  „gotov" stanju, ali nije 100% garancija.
- **`impl` „A done":** nema jednog fajla → ručni fallback / cwd-quiet heuristika.
- **`git diff`:** hvata samo necommitovane izmjene; ako agent commituje usput,
  treba `git diff <base>..HEAD` (van obima V5; intent linija može to pomenuti).
- **Restart:** perzistirani `review` + re-run startupCommand → B bi se mogao
  re-pokrenuti na startu. Prihvatljivo; po potrebi kasnije očistiti startupCommand
  poslije prvog runa.

## 14. Van obima (YAGNI)

Auto-konvergencija / „kreci mi kad je savršeno"; više reviewer-a istovremeno nad
istim A; review nad feature-om (više terminala odjednom); čitanje transkripta;
diff protiv base grane; in-project gitignored varijanta; headless reviewer.
