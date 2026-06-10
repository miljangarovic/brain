import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

// Rendered markdown for a file pane. Read-only; links open in the system
// browser (the renderer must never navigate). Styling is hand-rolled tailwind —
// no typography plugin dependency.
export function MarkdownView({ source }: { source: string }) {
  return (
    <div
      className="h-full overflow-y-auto bg-surface px-6 py-4"
      onClick={(e) => {
        const a = (e.target as HTMLElement).closest('a')
        if (!a) return
        e.preventDefault()
        // The RAW attribute, not a.href: the resolved property would point
        // relative links at the dev-server origin (dev) or file:// (prod).
        // Only absolute http(s) goes to the browser; relative/anchor links are
        // swallowed — the renderer must never navigate.
        const href = a.getAttribute('href') ?? ''
        if (/^https?:\/\//i.test(href)) window.brain.openExternal(href)
      }}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // react-markdown passes a `node` prop to overrides — destructure it
          // away or React warns about an unknown DOM attribute on every element.
          h1: ({ node: _n, ...p }) => <h1 className="mt-2 mb-3 text-2xl font-semibold tracking-tight text-fg-bright" {...p} />,
          h2: ({ node: _n, ...p }) => <h2 className="mt-5 mb-2 text-xl font-semibold tracking-tight text-fg-bright" {...p} />,
          h3: ({ node: _n, ...p }) => <h3 className="mt-4 mb-1.5 text-lg font-semibold text-fg-bright" {...p} />,
          h4: ({ node: _n, ...p }) => <h4 className="mt-3 mb-1 text-base font-semibold text-fg-bright" {...p} />,
          p: ({ node: _n, ...p }) => <p className="my-2 text-sm leading-relaxed text-fg" {...p} />,
          a: ({ node: _n, ...p }) => <a className="text-accent underline decoration-accent/40 hover:decoration-accent cursor-pointer" {...p} />,
          ul: ({ node: _n, ...p }) => <ul className="my-2 list-disc pl-6 text-sm text-fg" {...p} />,
          ol: ({ node: _n, ...p }) => <ol className="my-2 list-decimal pl-6 text-sm text-fg" {...p} />,
          li: ({ node: _n, ...p }) => <li className="my-0.5 leading-relaxed" {...p} />,
          blockquote: ({ node: _n, ...p }) => <blockquote className="my-2 border-l-2 border-accent/50 pl-3 text-sm text-fg-muted" {...p} />,
          code: ({ node: _n, ...p }) => <code className="rounded bg-panel px-1 py-0.5 text-[0.85em] text-fg-bright" {...p} />,
          pre: ({ node: _n, ...p }) => <pre className="my-3 overflow-x-auto rounded-md border border-line bg-panel p-3 text-xs leading-relaxed" {...p} />,
          table: ({ node: _n, ...p }) => <table className="my-3 border-collapse text-sm" {...p} />,
          th: ({ node: _n, ...p }) => <th className="border border-line bg-panel px-2 py-1 text-left font-semibold text-fg-bright" {...p} />,
          td: ({ node: _n, ...p }) => <td className="border border-line px-2 py-1 text-fg" {...p} />,
          hr: () => <hr className="my-4 border-line" />
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  )
}
