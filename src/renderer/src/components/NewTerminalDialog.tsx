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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onCancel}>
      <div className="w-96 rounded-lg bg-gray-800 p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-4 text-lg font-semibold text-gray-100">Novi terminal</h2>

        <label className="block mb-3 text-sm text-gray-300">
          Ime
          <input
            autoFocus
            aria-label="Ime"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
            className="mt-1 w-full rounded bg-gray-900 px-2 py-1 text-gray-100 outline-none focus:ring-1 focus:ring-blue-500"
          />
        </label>

        <label className="block mb-3 text-sm text-gray-300">
          Radni direktorijum (cwd)
          <input
            aria-label="Radni direktorijum (cwd)"
            value={cwd}
            placeholder="~ (home ako prazno)"
            onChange={(e) => setCwd(e.target.value)}
            className="mt-1 w-full rounded bg-gray-900 px-2 py-1 text-gray-100 placeholder-gray-500 outline-none focus:ring-1 focus:ring-blue-500"
          />
        </label>

        <label className="block mb-4 text-sm text-gray-300">
          Startup komanda
          <input
            aria-label="Startup komanda"
            value={startupCommand}
            placeholder="npr. claude (opciono)"
            onChange={(e) => setStartupCommand(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
            className="mt-1 w-full rounded bg-gray-900 px-2 py-1 text-gray-100 placeholder-gray-500 outline-none focus:ring-1 focus:ring-blue-500"
          />
        </label>

        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="rounded px-3 py-1 text-gray-300 hover:bg-gray-700">Otkaži</button>
          <button onClick={submit} className="rounded bg-blue-600 px-3 py-1 text-white hover:bg-blue-500">Kreiraj</button>
        </div>
      </div>
    </div>
  )
}
