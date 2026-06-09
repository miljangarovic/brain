# Review Pipeline — dizajn

**Datum:** 2026-06-09
**Status:** predlog (čeka odobrenje)

## Problem

Trenutni review radi samo nad **jednim artefaktom** (`spec` ili `impl`) i svaki
korak je ručan (relay → mark applied → re-review). Reviewer nikad ne vidi
konverzaciju origin agenta. Želimo:

1. Review **konverzacije/intenta**, **spec/plana** i **implementacije**.
2. Da to teče kroz **N iteracija** sa jasnim, automatskim flowom.

## Odluke (iz brainstorminga)

| Tema | Odluka |
|---|---|
| Struktura | **Pipeline sa kapijama**: `intent → spec → impl` |
| Unutar faze | **Auto petlja**; reviewer presuđuje `APPROVED` / `NEEDS-WORK`; `maxRounds` cap |
| Izvor konverzacije | **Session transcript fajlovi** (Claude Code / codex JSONL) |
| Granica faze | **Korisnička kapija** — faza ide auto do `APPROVED`, pa stane na tvoj klik |
| Artefakt faze `intent` | **`intent.md`** (problem, ciljevi, constraints, success kriterijumi) |
| Reviewer terminal | **Trajno vezan za origin**, reuse kroz sve faze i runde |

## Arhitektura

### Model stanja

Reviewer (B) je jedan terminal trajno vezan za origin (A) preko `ReviewLink`.
`ReviewKind` se zamjenjuje fazom, a `ReviewLink` prati gdje smo u pipeline-u.

```ts
// src/shared/types.ts
export type ReviewPhase = 'intent' | 'spec' | 'impl'

export interface ReviewLink {
  originTerminalId: string
  phase: ReviewPhase          // gdje smo u pipeline-u
  round: number               // runda UNUTAR trenutne faze (1-based)
  maxRounds: number           // safety cap, npr. 5
  reviewDir: string           // dir za review-{phase}-{round}.md
  transcriptPath?: string     // origin-ov JSONL (intent faza ga zahtijeva)
  intentPath?: string         // artefakt intent faze
  specPath?: string           // artefakt spec faze
}

export type ReviewStatus =
  | 'reviewing'        // spinner na B — reviewer piše kritiku
  | 'applying'         // spinner na A — origin primjenjuje feedback
  | 'phase-approved'   // attention — faza APPROVED, čeka tvoju kapiju
  | 'needs-decision'   // attention — maxRounds dostignut, čeka tvoju odluku
```

`'review-ready'` i `'iteration-done'` (raniji ručni handoff koraci) **nestaju** —
sad su automatski.

### Petlja jedne faze (auto)

```
START FAZE
  │
  ▼  pošalji reviewer prompt (čitaj artefakt+transcript, piši review-{phase}-{N}.md,
  │   PRVA LINIJA = VERDICT: APPROVED | NEEDS-WORK)
  │   status B = 'reviewing'
  ▼
watcher vidi review fajl  →  pročitaj fajl  →  parsiraj prvu liniju (VERDICT)
  │
  ├── APPROVED ──────────► status B = 'phase-approved'  ⛔ STANI (tvoja kapija)
  │
  └── NEEDS-WORK ────────► AUTO pošalji kritiku origin-u (writePty)
                           status A = 'applying'
                             │
                             ▼  origin agent: busy → idle  (busyTracker)
                           round++
                             │
                             ├── round > maxRounds ─► status='needs-decision' ⛔ STANI
                             └── inače ─────────────► nazad na START FAZE
```

### Cijeli pipeline

```
intent (auto) ⛔kapija→ spec (auto) ⛔kapija→ impl (auto) ⛔kraj
```

Na kapiji (`phase-approved`) klikneš **„Odobri → sljedeća faza"**: `phase`
napreduje, `round` se resetuje na 1, prethodni artefakt postaje ulaz sljedeće
faze. Na poslednjoj fazi kapija znači „gotovo".

### Dvije nove tehničke poluge

1. **VERDICT parsing.** Reviewer prompt zahtijeva da PRVA linija review fajla
   bude tačno `VERDICT: APPROVED` ili `VERDICT: NEEDS-WORK`. Loop čita fajl
   (ne samo „fajl promijenjen") i grana na osnovu toga. Zahtijeva `readFile`
   IPC u renderer-u (provjeriti da li već postoji; ako ne — dodati).

2. **„Origin gotov" auto-signal.** Umjesto ručnog „Mark applied" / „Re-review",
   koristimo postojeći `busyTracker`. Kad pošaljemo relay origin-u, naoružamo
   „čekam origin idle" zastavicu; prvi `busy → idle` prelaz origin terminala
   nakon toga = origin završio → okini sljedeću rundu. (Agentski idle prag je
   ~1500ms, što smanjuje lažne idle blip-ove.)

## Artefakti i prompti po fazi

Artefakti se grade kumulativno; reviewer u svakoj fazi ima sve više konteksta.

| Faza | Reviewer čita | Origin popravlja | `APPROVED` znači |
|---|---|---|---|
| **intent** | `transcriptPath` (JSONL) | `intent.md` | intent jasan: problem, ciljevi, constraints, success — bez rupa/dvosmislenosti |
| **spec** | `intentPath` + transcript | `specPath` (`spec.md`) | spec pokriva intent, izvodljiv, bez kontradikcija, YAGNI |
| **impl** | `intentPath` + `specPath` + `git diff` | kod (radni tree) | implementacija prati spec; bez bug-ova/edge-case rupa |

**VERDICT contract** (kraj svakog reviewer prompta):

```
On the FIRST line of the file write EXACTLY one of:
  VERDICT: APPROVED
  VERDICT: NEEDS-WORK
Use APPROVED only when you have no blocking concerns. Then write the critique below.
```

**Relay prompt** (NEEDS-WORK → origin): „Reviewer left a critique in
`review-{phase}-{N}.md`. Apply it to `<artefakt>` where you agree; where you
disagree, briefly explain. Do not commit." Za intent fazu artefakt je `intent.md`
(kreiraj ako ne postoji).

## Otkrivanje transcript fajla

Novi IPC `resolveTranscript(originTerminalId)` u main procesu:

- **Claude Code:** `~/.claude/projects/<enc-cwd>/*.jsonl`, gdje `<enc-cwd>` je
  cwd sa `/` → `-` (npr. `/home/miljan/terminaltor` → `-home-miljan-terminaltor`).
  Uzmi `*.jsonl` sa najnovijim `mtime` (aktivna sesija).
- **codex:** analogno iz codex session direktorijuma (format potvrditi).

**Rizik:** više sesija u istom cwd → biramo najnoviju po mtime; obično tačno, ali
nije garantovano. Fallback: ako transcript nije nađen, intent faza traži ručni
unos intenta (kao sad `intent` polje u dialogu).

## Kontrolni UI

- **ReviewDialog** (`components/ReviewDialog.tsx`): bira reviewer agenta,
  **početnu fazu** (default `intent`) i **maxRounds** (default 5). Putanje
  `intent.md` / `spec.md` se auto-rezolvuju (`reviewDir` ili projekat).
- **Status tačke** (`review/status.ts`): `reviewing`/`applying` → spinner;
  `phase-approved`/`needs-decision` → attention.
- **Indikator na origin terminalu (onom koji se review-a):** dok god je review
  aktivan i poslednji verdikt nije `APPROVED` (tj. ima neriješenog posla —
  `NEEDS-WORK`), origin terminal (A) nosi vidljiv „under review" indikator — i u
  sidebar redu i na tabu. Izvodi se iz `findReviewerFor(originId)` + njegovog
  statusa (nije nova perzistentna vrijednost). Gasi se na `phase-approved`
  (kapija), na kraju pipeline-a, ili na „Stani petlju".
- **Dugmad** na reviewer terminalu:
  - `phase-approved` → **„Odobri → sljedeća faza"** (ili „Završi" na impl).
  - `needs-decision` → **„Još rundi"** / **„Prihvati ovako → kapija"** / **„Stop"**.
  - Uvijek dostupno: **„Stani petlju"** (prekini auto petlju ručno).

## Promjene po fajlovima

| Fajl | Promjena |
|---|---|
| `src/shared/types.ts` | `ReviewKind`→`ReviewPhase`; novi `ReviewLink` polja; novi `ReviewStatus` union |
| `src/renderer/src/review/prompt.ts` | prompti po fazi + VERDICT contract; intent-faza prompti |
| `src/renderer/src/review/useReview.ts` | zamijeni ručni relay/markApplied/reReview auto state-machine-om: watcher→parse verdict, origin idle→next round, `advancePhase()` |
| `src/renderer/src/review/status.ts` | mapiranje novih statusa |
| `src/renderer/src/components/ReviewDialog.tsx` | izbor faze + maxRounds |
| `src/main` (`ipc.ts`/novi) | `resolveTranscript` IPC; `readFile` IPC (ako ne postoji) za VERDICT |
| `src/main/ipc.ts` + busy pipeline | izloži origin `busy→idle` prelaze renderer-u (vjerovatno već postoji iz commita „busy spinner only while AI responding") |

## Rizici / otvorena pitanja

- **Origin idle false-positive:** agent može „zastati" sred posla i izgledati
  idle. Ublaženo agentskim ~1500ms pragom; „Stani petlju" je ručni escape.
- **Transcript format:** codex JSONL lokacija/format treba potvrditi.
- **VERDICT disciplina:** ako agent ne ispoštuje format prve linije, tretiramo
  kao `NEEDS-WORK` (sigurnija default grana) i logujemo.

## Van opsega (YAGNI)

- Multi-reviewer konsenzus.
- Auto-advance kroz cijeli pipeline bez kapija (odbačeno — biraš kapiju po fazi).
- Pamćenje istorije rundi u promptu (svaka runda i dalje single-shot; artefakt
  nosi stanje).
