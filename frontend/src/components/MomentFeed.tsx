import { MOMENT_ICON, MOMENT_LABEL, minuteLabel } from '../format'
import type { Commentary, MatchInfo, Moment } from '../types'

type Props = { info: MatchInfo; moments: Moment[]; lines: Record<number, Commentary> }

/** The commentary feed: key moments, newest first, written by the Narrator agent. */
export function MomentFeed({ info, moments, lines }: Props) {
  return (
    <section className="card feed">
      <h2>Commentary</h2>
      {moments.length === 0 && <p className="muted small">Key moments will appear here as the match unfolds.</p>}
      <ol>
        {moments.map((m) => {
          const line = lines[m.id]
          const team = m.team ? info[m.team] : null
          const icon = m.kind === 'card' && m.facts.color === 'red' ? '🟥' : MOMENT_ICON[m.kind] ?? '•'
          return (
            <li key={m.id} className={`moment importance-${m.importance}`}>
              <span className="moment-icon" aria-hidden>{icon}</span>
              <div className="moment-body">
                <div className="moment-meta">
                  <span className="minute">{minuteLabel(m.t)}</span>
                  <span>{MOMENT_LABEL[m.kind] ?? m.kind}</span>
                  {team && <span className="chip" style={{ background: team.color }}>{team.short_name}</span>}
                </div>
                <p className={line ? '' : 'pending'}>{line ? line.text : m.headline}</p>
                <span className="moment-foot">
                  {!line && 'Writing commentary…'}
                  {line?.source === 'agent' && `✨ AI commentary · ${(line.ms / 1000).toFixed(1)}s`}
                  {line?.source === 'fallback' && 'Template line (AI unavailable)'}
                  {' · '}based on {m.evidence.length} event{m.evidence.length === 1 ? '' : 's'}
                </span>
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
