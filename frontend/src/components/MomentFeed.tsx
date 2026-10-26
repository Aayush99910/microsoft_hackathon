import { MOMENT_LABEL, minuteLabel } from '../format'
import type { AgentStep, Commentary, MatchInfo, Moment } from '../types'
import { Loading } from './Loading'

type Props = {
  info: MatchInfo
  moments: Moment[]
  lines: Record<number, Commentary>
  onReplay: (moment: Moment) => void
  onCompare: (moment: Moment) => void
  waiting: string // shown while there are no moments yet
  switching: string | null // shown while the latest moments are re-told for a new mode or language
  brief: boolean // one short line per moment, no explanation or agent details
}

// Moments built from a passage of play that is worth watching again
const REPLAYABLE = new Set(['goal', 'big_chance', 'rocket', 'card', 'long_spell'])

const AGENT_NAME: Record<string, string> = {
  narrator: 'Narrator',
  recap: 'Recap',
  explainer: 'Explainer',
  personalizer: 'Personalizer',
}

/** Live commentary timeline: key moments, newest first, written by the agents. */
export function MomentFeed({ info, moments, lines, onReplay, onCompare, waiting, switching, brief }: Props) {
  return (
    <div className="feed">
        {/* While switching mode or language, show only the loader; the cards come back all at once, re-told */}
        {switching && <Loading text={switching} className="feed-loading" spinner />}
        {!switching && moments.length === 0 && <Loading text={waiting} className="feed-loading" />}
        <ol hidden={!!switching}>
          {moments.map((m) => {
            const line = lines[m.id]
            const team = m.team ? info[m.team] : null
            return (
              <li key={m.id} className={`entry ${m.importance === 3 ? 'major' : ''}`}>
                <span className="minute">{minuteLabel(m.t)}</span>
                <div>
                  <div className="entry-head">
                    {m.kind === 'card' ? (
                      <span
                        className="card-mark"
                        style={{ background: m.facts.color === 'red' ? 'var(--red)' : 'var(--yellow)' }}
                      />
                    ) : (
                      team && <span className="team-mark" style={{ background: team.color }} />
                    )}
                    <span className="kind" style={{ color: m.kind === 'goal' ? 'var(--accent)' : undefined }}>
                      {MOMENT_LABEL[m.kind] ?? m.kind}
                    </span>
                    {team && <span className="label">{team.short_name}</span>}
                    <span className="entry-actions">
                      {line && (
                        <button className="replay-btn" onClick={() => onCompare(m)} aria-label={`Compare modes for ${m.headline}`}>
                          Compare
                        </button>
                      )}
                      {REPLAYABLE.has(m.kind) && (
                        <button className="replay-btn" onClick={() => onReplay(m)} aria-label={`Replay ${m.headline}`}>
                          ▶ Replay
                        </button>
                      )}
                    </span>
                  </div>
                  <p className={`entry-text ${line && !line.retelling ? '' : 'pending'}`}>
                    {line ? (brief ? line.short ?? line.text : line.text) : m.headline}
                  </p>
                  {!brief && line?.why && (
                    <p className="why">
                      <span className="label">Why it matters</span>
                      {line.why}
                    </p>
                  )}
                  <div className="meta" hidden={brief}>
                    {line?.retelling ? 'Re-telling for your new mode…' : line ? <Trace steps={line.steps} /> : 'Agents writing…'}
                    {' / '}
                    {m.evidence.length} event{m.evidence.length === 1 ? '' : 's'}
                    {line && line.profile !== 'casual · English' && ` / ${line.profile}`}
                  </div>
                </div>
              </li>
            )
          })}
        </ol>
    </div>
  )
}

/** Which agents worked on this entry and how long each took; fallbacks are flagged. */
function Trace({ steps }: { steps: AgentStep[] }) {
  return (
    <>
      {steps
        .filter((s) => s.source !== 'skipped')
        .map((s, i) => (
          <span
            key={s.agent}
            className={s.source === 'fallback' ? 'warn' : undefined}
            title={s.source === 'fallback' ? `Template used (${s.error ?? 'error'})` : undefined}
          >
            {i > 0 && ' / '}
            {AGENT_NAME[s.agent] ?? s.agent} {(s.ms / 1000).toFixed(1)}s{s.source === 'fallback' && ' (template)'}
          </span>
        ))}
    </>
  )
}
