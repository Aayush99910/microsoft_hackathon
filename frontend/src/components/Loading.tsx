/** Loading indicator with a message: a moving bar, or a spinner. */
export function Loading({ text, className = '', spinner = false }: { text: string; className?: string; spinner?: boolean }) {
  return (
    <div className={`loading ${spinner ? 'with-spinner' : ''} ${className}`} role="status" aria-live="polite">
      {spinner ? (
        <span className="spinner" aria-hidden />
      ) : (
        <div className="loading-bar" aria-hidden>
          <span />
        </div>
      )}
      <p>{text}</p>
    </div>
  )
}
