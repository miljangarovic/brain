# Terminaltor

Desktop wrapper nad terminalom za Linux: imenovani terminali sa punim PTY-jem,
grupisani u cjeline (sidebar stablo + tabovi) — za organizaciju AI agenata po feature-ima.

## Razvoj

```bash
npm install
npm run rebuild   # rebuild node-pty za Electron ABI
npm run dev       # pokreni aplikaciju
npm test          # unit testovi
```

## Pakovanje

```bash
npm run dist      # pravi instalere (Linux AppImage/.deb; mac dmg/zip; win nsis) u release/
npm run dist:dir  # samo raspakovan build (bez instalera), za brzu provjeru
```

## Prečice

- `Ctrl+Shift+T` — novi terminal u aktivnoj grupi
- `Ctrl+Shift+W` — zatvori aktivni terminal
- `Ctrl+PageDown` / `Ctrl+PageUp` — sljedeći / prethodni tab
- `Ctrl+Shift+C` / `Ctrl+Shift+V` — kopiraj / nalijepi
- `Shift+Enter` — novi red u unosu (umjesto slanja) — za claude/codex i slične agente

## Brzo pokretanje agenata

U tab baru (i na hover grupe u sidebar-u) pored `+` stoje dugmad **Claude** i
**Codex**. Jedan klik kreira terminal koji odmah pokreće taj agent (`claude` /
`codex` se očekuju na PATH-u). Terminali koji koriste agenta nose njegovu ikonicu
u sidebar-u i u tabovima, i pamte se kroz restart.

## Perzistencija

Struktura (grupe + terminali + cwd + startup komanda) čuva se u
`~/.config/Terminaltor/workspace.json` i obnavlja se na pokretanju sa svježim shell-ovima.
