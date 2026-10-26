import { useEffect, useState } from 'react'
import { MOMENT_LABEL, minuteLabel } from '../format'
import { retell, type Retold } from '../retell'
import type { Commentary, Moment } from '../types'
import { MODES } from './ProfilePicker'

type Props = { moment: Moment; line: Commentary; language: string; onClose: () => void }

/** The same moment told five ways: one card per viewing mode, side by side. */
export function Compare({ moment, line, language, onClose }: Props) {
  const [versions, setVersions] = useState<Record<string, Retold | 'loading' | 'failed'>>(
    Object.fromEntries(MODES.map((m) => [m.id, 'loading'])),
  )

  useEffect(() => {
    for (const mode of MODES) {
      retell(moment, line, { mode: mode.id, language })
        .then((r) => setVersions((v) => ({ ...v, [mode.id]: r })))
        .catch(() => setVersions((v) => ({ ...v, [mode.id]: 'failed' })))
    }
  }, [moment.id, language]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="compare-backdrop" onClick={onClose}>
      <section
        className="compare"
        role="dialog"
        aria-modal="true"
        aria-label="Same moment, five takes"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="compare-head">
          <div>
            <span className="label">
              Same moment, five takes · {MOMENT_LABEL[moment.kind] ?? moment.kind} · {minuteLabel(moment.t)}
            </span>
            <p className="compare-headline">{moment.headline}</p>
          </div>
          <button className="btn btn-line" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="compare-grid">
          {MODES.map((mode) => {
            const v = versions[mode.id]
            return (
              <article key={mode.id} className="compare-card">
                <span className="kind">{mode.label}</span>
                <span className="muted small">{mode.hint}</span>
                {v === 'loading' && <p className="entry-text pending">Personalizer writing…</p>}
                {v === 'failed' && <p className="entry-text pending">Could not re-tell this one.</p>}
                {typeof v === 'object' && (
                  <>
                    <p className="entry-text">{v.text}</p>
                    {v.why && <p className="why">{v.why}</p>}
                    <div className="meta">
                      {v.source === 'original' ? 'Narrator original' : `Personalizer ${(v.ms / 1000).toFixed(1)}s`}
                    </div>
                  </>
                )}
              </article>
            )
          })}
        </div>
      </section>
    </div>
  )
}
