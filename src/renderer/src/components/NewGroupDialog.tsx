import { useEffect, useState } from 'react'

export interface NewGroupInput {
  name: string
  cwd: string
}

export function NewGroupDialog({
  onCreate, onCancel
}: {
  onCreate: (input: NewGroupInput) => void
  onCancel: () => void
}) {
  const [name, setName] = useState('')
  const [cwd, setCwd] = useState('')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const submit = () => {
    const n = name.trim()
    if (!n) return
    onCreate({ name: n, cwd: cwd.trim() })
  }

  const browse = async () => {
    const dir = await window.orchestrix.pickDirectory()
    if (dir) setCwd(dir)
  }

  const field = 'mt-1 w-full rounded-md bg-field px-2.5 py-1.5 text-fg-bright placeholder-fg-muted outline-none ring-1 ring-line focus:ring-accent transition'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onCancel}>
      <div className="w-[26rem] rounded-xl bg-elevated border border-line p-5 shadow-2xl shadow-black/50" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-4 text-lg font-semibold tracking-tight text-fg-bright">New Project</h2>

        <label className="block mb-3 text-sm text-fg">
          Project name
          <input autoFocus aria-label="Project name" value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit() }} className={field} />
        </label>

        <label className="block mb-4 text-sm text-fg">
          Working directory
          <div className="mt-1 flex gap-2">
            <input aria-label="Working directory" value={cwd} placeholder="~ (home if empty)"
              onChange={(e) => setCwd(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
              className="flex-1 rounded-md bg-field px-2.5 py-1.5 text-fg-bright placeholder-fg-muted outline-none ring-1 ring-line focus:ring-accent transition" />
            <button type="button" onClick={browse}
              className="shrink-0 rounded-md px-3 py-1.5 text-sm text-fg ring-1 ring-line hover:bg-hover transition-colors">Browse…</button>
          </div>
        </label>

        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="rounded-md px-3 py-1.5 text-sm text-fg hover:bg-hover transition-colors">Cancel</button>
          <button onClick={submit} className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-surface hover:bg-accent-strong transition-colors">Create</button>
        </div>
      </div>
    </div>
  )
}
