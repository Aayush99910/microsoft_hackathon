// Shapes of the messages sent by GET /api/match/stream (see backend/app/stream.py)

export type Side = 'home' | 'away'

// position: the team-sheet label in this formation (RB, CDM, RS, ...); role: the same 11 slots in every formation
export type Player = { id: number; name: string; number: number; position: string; role: string; line: 'GK' | 'DEF' | 'MID' | 'FWD' }
export type Team = { side: Side; key: string; name: string; short_name: string; color: string; formation: string; players: Player[] }
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

export type PlayerRating = {
  id: number
  rating: number
  goals: number
  assists: number
  shots: number
  passes: number
  pass_accuracy: number | null
  tackles_won: number
  stops: number
  yellow_cards: number
  red_cards: number
}

export type Stats = {
  ratings?: PlayerRating[]
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
  catchup?: boolean // happened before the viewer joined the game: no commentary
}

export type AgentStep = { agent: string; ms: number; source: 'agent' | 'fallback' | 'skipped'; error?: string }

export type Commentary = {
  moment_id: number
  kind: string
  importance: number
  text: string
  why: string | null
  base_text: string
  base_why: string | null
  spoken?: string // the on-air version the voice reads (short bursts)
  base_spoken?: string
  short?: string // brief version (about 12 words)
  base_short?: string
  profile: string
  source: 'agent' | 'fallback'
  ms: number
  steps: AgentStep[]
  retelling?: boolean
  catchup?: boolean // stands in for a moment from before the viewer joined: its headline, no agents
}

export type Profile = { mode: string; language: string }
