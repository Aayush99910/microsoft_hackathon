"""Stats engine: turns the event stream into the live state of the match.

Plain code, no AI: every number the agents talk about comes from here, so it is
exact and instant. Agents only explain and narrate what this computes.

    state = MatchState(info)
    for event in events:
        state.update(event)
    state.snapshot()  # JSON-ready dict for the UI and the agents
"""

import math
from collections import deque
from dataclasses import asdict, dataclass

from generator.events import Event, MatchInfo

LENGTH, WIDTH = 105.0, 68.0
FINAL_THIRD = 70.0  # metres from a team's own goal line
WINDOW_SECONDS = 5 * 60  # "recent" = the last 5 minutes of match time


@dataclass
class TeamStats:
    goals: int = 0
    shots: int = 0
    shots_on_target: int = 0
    xg: float = 0.0
    passes: int = 0
    passes_completed: int = 0
    pressures: int = 0
    tackles_won: int = 0
    fouls: int = 0
    yellow_cards: int = 0
    red_cards: int = 0
    possession_seconds: float = 0.0


@dataclass
class PlayerStats:
    passes: int = 0
    passes_completed: int = 0
    shots: int = 0
    goals: int = 0
    assists: int = 0
    xg: float = 0.0
    tackles_won: int = 0
    pressures: int = 0
    carry_distance: float = 0.0  # metres run with the ball
    top_shot_kmh: float = 0.0
    top_pass_kmh: float = 0.0
    shots_on_target: int = 0
    stops: int = 0  # shots saved or blocked
    fouls: int = 0
    yellow_cards: int = 0
    red_cards: int = 0


def attacking_x(e: Event, x: float) -> float:
    """x measured from the acting team's own goal (home attacks toward 105, away toward 0)."""
    return x if e.team == "home" else LENGTH - x


def shot_speed_kmh(e: Event) -> float:
    s = e.shot
    return math.dist((e.x, e.y), (s.end_x, s.end_y)) / s.duration * 3.6 if s.duration else 0.0


def pass_speed_kmh(e: Event) -> float:
    p = e.pass_
    return math.dist((e.x, e.y), (p.end_x, p.end_y)) / p.duration * 3.6 if p.duration else 0.0


class MatchState:
    def __init__(self, info: MatchInfo):
        self.info = info
        self.names = {p.id: p.name for team in (info.home, info.away) for p in team.players}
        self.side_of = {p.id: side for side, team in (("home", info.home), ("away", info.away)) for p in team.players}
        self.teams = {"home": TeamStats(), "away": TeamStats()}
        self.players = {pid: PlayerStats() for pid in self.names}

        self.t = 0.0
        self.period = 1
        self.in_possession: str | None = None
        self.possession_passes = 0  # completed passes in the current spell
        self.last_event: Event | None = None
        self.recent: deque[Event] = deque()  # events in the last WINDOW_SECONDS

    # --- updating ------------------------------------------------------------

    def update(self, e: Event) -> None:
        if self.last_event and self.in_possession and e.period == self.last_event.period:
            self.teams[self.in_possession].possession_seconds += max(0.0, e.t - self.last_event.t)
        self.t, self.period, self.last_event = e.t, e.period, e

        self.recent.append(e)
        while self.recent and (self.recent[0].period != e.period or e.t - self.recent[0].t > WINDOW_SECONDS):
            self.recent.popleft()

        team = self.teams[e.team] if e.team else None
        player = self.players.get(e.player_id)

        if e.type == "possession_change":
            self.in_possession, self.possession_passes = e.team, 0
        elif e.type == "pass":
            team.passes += 1
            player.passes += 1
            player.top_pass_kmh = max(player.top_pass_kmh, pass_speed_kmh(e))
            if e.pass_.outcome == "complete":
                team.passes_completed += 1
                player.passes_completed += 1
                self.possession_passes += 1
        elif e.type == "carry":
            player.carry_distance += math.dist((e.x, e.y), (e.carry.end_x, e.carry.end_y))
        elif e.type == "shot":
            team.shots += 1
            team.xg += e.shot.xg
            team.shots_on_target += e.shot.outcome in ("goal", "saved")
            player.shots += 1
            player.shots_on_target += e.shot.outcome in ("goal", "saved")
            player.xg += e.shot.xg
            if e.shot.outcome in ("saved", "blocked") and e.shot.blocker_id in self.players:
                self.players[e.shot.blocker_id].stops += 1
            player.top_shot_kmh = max(player.top_shot_kmh, shot_speed_kmh(e))
        elif e.type == "goal":
            team.goals += 1
            player.goals += 1
            if e.goal.assist_id:
                self.players[e.goal.assist_id].assists += 1
        elif e.type == "pressure":
            team.pressures += 1
            player.pressures += 1
        elif e.type == "tackle" and e.tackle.won:
            team.tackles_won += 1
            player.tackles_won += 1
        elif e.type == "foul":
            team.fouls += 1
            player.fouls += 1
        elif e.type == "card":
            if e.card.color == "yellow":
                team.yellow_cards += 1
                player.yellow_cards += 1
            else:
                team.red_cards += 1
                player.red_cards += 1

    # --- derived numbers -------------------------------------------------------

    def possession_pct(self) -> dict[str, int]:
        home, away = self.teams["home"].possession_seconds, self.teams["away"].possession_seconds
        total = home + away
        if not total:
            return {"home": 50, "away": 50}
        return {"home": round(100 * home / total), "away": 100 - round(100 * home / total)}

    def recent_window(self) -> dict:
        """What the last 5 minutes looked like: who is threatening, pressing, in control."""
        minutes = max(1.0, (self.recent[-1].t - self.recent[0].t) / 60) if self.recent else 1.0
        threat = {"home": 0.0, "away": 0.0}
        pressures = {"home": 0, "away": 0}
        passes = {"home": [0, 0], "away": [0, 0]}  # [attempted, completed]
        turnovers = 0
        for e in self.recent:
            if e.type == "shot":
                threat[e.team] += 2 + 10 * e.shot.xg
            elif e.type == "pass":
                passes[e.team][0] += 1
                passes[e.team][1] += e.pass_.outcome == "complete"
                if e.pass_.outcome == "complete" and attacking_x(e, e.pass_.end_x) >= FINAL_THIRD:
                    threat[e.team] += 0.5  # ball moved into the final third
            elif e.type == "pressure":
                pressures[e.team] += 1
            elif e.type == "possession_change" and e.possession_change.reason in ("interception", "tackle", "loose_ball"):
                turnovers += 1

        total_threat = threat["home"] + threat["away"]
        return {
            # -1 = all away, +1 = all home
            "momentum": round((threat["home"] - threat["away"]) / total_threat, 2) if total_threat else 0.0,
            "pressures_per_min": {k: round(v / minutes, 1) for k, v in pressures.items()},
            "pass_accuracy": {k: round(c / a, 2) if a else None for k, (a, c) in passes.items()},
            # many turnovers per minute = chaos, few = one team in control
            "turnovers_per_min": round(turnovers / minutes, 2),
        }

    def snapshot(self) -> dict:
        def team_dict(side: str) -> dict:
            s = self.teams[side]
            d = asdict(s)
            d["xg"] = round(s.xg, 2)
            d["pass_accuracy"] = round(s.passes_completed / s.passes, 2) if s.passes else None
            d.pop("possession_seconds")
            return d

        return {
            "t": self.t,
            "period": self.period,
            "score": {"home": self.teams["home"].goals, "away": self.teams["away"].goals},
            "possession_pct": self.possession_pct(),
            "teams": {"home": team_dict("home"), "away": team_dict("away")},
            "recent": self.recent_window(),
            "in_possession": self.in_possession,
            "current_spell_passes": self.possession_passes,
            "ratings": self.ratings(),
        }

    def ratings(self) -> list[dict]:
        """Match ratings out of 10, from plain rules (no AI), so every number can be explained.

        Everyone starts on 6.0. Goals, assists, shots on target, tackles, stops, pressing, completed
        passes and ball-carrying add to it; misplaced passes, fouls and cards take away.
        """
        out = []
        for pid, p in self.players.items():
            failed = p.passes - p.passes_completed
            score = (6.0 + 1.3 * p.goals + 0.8 * p.assists + 0.15 * p.shots_on_target + 0.5 * p.xg
                     + 0.15 * p.tackles_won + 0.3 * p.stops + min(0.4, 0.03 * p.pressures)
                     + min(0.6, 0.015 * p.passes_completed) - 0.06 * failed + min(0.3, p.carry_distance / 300)
                     - 0.1 * p.fouls - 0.4 * p.yellow_cards - 1.5 * p.red_cards)
            out.append({
                "id": pid,
                "rating": round(min(10.0, max(3.0, score)), 1),
                "goals": p.goals,
                "assists": p.assists,
                "shots": p.shots,
                "passes": p.passes,
                "pass_accuracy": round(100 * p.passes_completed / p.passes) if p.passes else None,
                "tackles_won": p.tackles_won,
                "stops": p.stops,
                "yellow_cards": p.yellow_cards,
                "red_cards": p.red_cards,
            })
        return out

    def player_line(self, player_id: int) -> dict:
        """Compact stats for one player, for player-focus mode and agent context."""
        p = self.players[player_id]
        return {
            "name": self.names[player_id],
            "side": self.side_of[player_id],
            **{k: round(v, 1) if isinstance(v, float) else v for k, v in asdict(p).items()},
        }
