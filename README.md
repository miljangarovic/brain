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

## Prečice

- `Ctrl+Shift+T` — novi terminal u aktivnoj grupi
- `Ctrl+Shift+W` — zatvori aktivni terminal
- `Ctrl+PageDown` / `Ctrl+PageUp` — sljedeći / prethodni tab
- `Ctrl+Shift+C` / `Ctrl+Shift+V` — kopiraj / nalijepi

## Perzistencija

Struktura (grupe + terminali + cwd + startup komanda) čuva se u
`~/.config/Terminaltor/workspace.json` i obnavlja se na pokretanju sa svježim shell-ovima.
