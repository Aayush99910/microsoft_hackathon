import { MOMENT_ICON, MOMENT_LABEL, minuteLabel } from '../format'
import type { AgentStep, Commentary, MatchInfo, Moment } from '../types'

type Props = { info: MatchInfo; moments: Moment[]; lines: Record<number, Commentary> }

const AGENT_NAME: Record<string, string> = {
  narrator: 'Narrator',
  recap: 'Recap',
  explainer: 'Explainer',
  personalizer: 'Personalizer',
}

/** The commentary feed: key moments, newest first, written by the agents. */
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
                  {line && line.profile !== 'casual · English' && <span className="profile-tag">{line.profile}</span>}
                </div>
                <p className={line ? '' : 'pending'}>{line ? line.text : m.headline}</p>
                {line?.why && (
                  <p className="why">
                    <strong>Why it matters</strong> {line.why}
                  </p>
                )}
                <div className="moment-foot">
                  {line ? <Trace steps={line.steps} /> : <span>Agents working…</span>}
                  <span>
                    · based on {m.evidence.length} event{m.evidence.length === 1 ? '' : 's'}
                  </span>
                </div>
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

/** Which agents worked on this line, how long each took, and any fallbacks. */
function Trace({ steps }: { steps: AgentStep[] }) {
  return (
    <span className="trace">
      {steps
        .filter((s) => s.source !== 'skipped')
        .map((s) => (
          <span
            key={s.agent}
            className={`step ${s.source}`}
            title={s.source === 'fallback' ? `Fell back to a template (${s.error ?? 'error'})` : 'Written by the agent'}
          >
            {s.source === 'fallback' ? '⚠' : '✨'} {AGENT_NAME[s.agent] ?? s.agent} {(s.ms / 1000).toFixed(1)}s
          </span>
        ))}
    </span>
  )
}
