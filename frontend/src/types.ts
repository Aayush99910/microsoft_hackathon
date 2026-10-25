// Shapes of the messages sent by GET /api/match/stream (see backend/app/stream.py)

export type Side = 'home' | 'away'

export type Player = { id: number; name: string; number: number; position: string }
export type Team = { side: Side; name: string; short_name: string; color: string; formation: string; players: Player[] }
export type MatchInfo = { match_id: string; seed: number; venue: string; home: Team; away: Team }

export type MatchEvent = {
  id: number
  t: number
  period: 1 | 2
  type: string
  team: Side | null
  player_id: number | null
  x: number
  y: number
  [details: string]: unknown
}

type TeamStats = {
  goals: number
  shots: number
  shots_on_target: number
  xg: number
  passes: number
  pass_accuracy: number | null
  pressures: number
  tackles_won: number
  fouls: number
  yellow_cards: number
  red_cards: number
}

export type Stats = {
  t: number
  period: number
  score: Record<Side, number>
  possession_pct: Record<Side, number>
  teams: Record<Side, TeamStats>
  recent: {
    momentum: number // -1 = all away, +1 = all home
    pressures_per_min: Record<Side, number>
    pass_accuracy: Record<Side, number | null>
    turnovers_per_min: number
  }
}

export type Moment = {
  id: number
  t: number
  period: number
  kind: string
  importance: 1 | 2 | 3
  headline: string
  team: Side | null
  facts: Record<string, unknown>
  evidence: number[]
}

export type AgentStep = { agent: string; ms: number; source: 'agent' | 'fallback' | 'skipped'; error?: string }

export type Commentary = {
  moment_id: number
  text: string
  why: string | null
  profile: string
  source: 'agent' | 'fallback'
  ms: number
  steps: AgentStep[]
}

export type Profile = { mode: string; language: string }
