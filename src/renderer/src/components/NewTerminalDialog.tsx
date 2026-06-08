import { useState } from 'react'

export interface NewTerminalInput {
  name: string
  cwd: string
  startupCommand?: string
}

export function NewTerminalDialog({
  onCreate, onCancel
}: {
  onCreate: (input: NewTerminalInput) => void
  onCancel: () => void
}) {
  const [name, setName] = useState('')
  const [cwd, setCwd] = useState('')
  const [startupCommand, setStartupCommand] = useState('')

  const submit = () => {
    const n = name.trim()
    if (!n) return
    onCreate({
      name: n,
      cwd: cwd.trim(),
      startupCommand: startupCommand.trim() || undefined
    })
  }

  const field =
    'mt-1 w-full rounded-md bg-field px-2.5 py-1.5 text-fg-bright placeholder-fg-muted outline-none ring-1 ring-line focus:ring-accent transition'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="w-[26rem] rounded-xl bg-elevated border border-line p-5 shadow-2xl shadow-black/50"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-lg font-semibold tracking-tight text-fg-bright">Novi terminal</h2>

        <label className="block mb-3 text-sm text-fg">
          Ime
          <input
            autoFocus
            aria-label="Ime"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
            className={field}
          />
        </label>

        <label className="block mb-3 text-sm text-fg">
          Radni direktorijum (cwd)
          <input
            aria-label="Radni direktorijum (cwd)"
            value={cwd}
            placeholder="~ (home ako prazno)"
            onChange={(e) => setCwd(e.target.value)}
            className={field}
          />
        </label>

        <label className="block mb-4 text-sm text-fg">
          Startup komanda
          <input
            aria-label="Startup komanda"
            value={startupCommand}
            placeholder="npr. claude (opciono)"
            onChange={(e) => setStartupCommand(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
            className={field}
          />
        </label>

        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-md px-3 py-1.5 text-sm text-fg hover:bg-hover transition-colors"
          >
            Otkaži
          </button>
          <button
            onClick={submit}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-surface hover:bg-accent-strong transition-colors"
          >
            Kreiraj
          </button>
        </div>
      </div>
    </div>
  )
}
