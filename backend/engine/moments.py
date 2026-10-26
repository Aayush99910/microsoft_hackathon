"""Moment detector: spots the moments worth talking about.

Plain code, no AI. Each moment carries:
- a headline that is always available (so the UI never waits on, or depends on, an AI call)
- `facts`: the exact numbers an agent may use
- `evidence`: the ids of the events it is based on, so every claim can be traced back

    detector = MomentDetector(state)
    for event in events:
        state.update(event)
        for moment in detector.check(event):
            ...
"""

import itertools
from dataclasses import dataclass, field

from generator.events import Event

from .stats import MatchState, shot_speed_kmh

BIG_CHANCE_XG = 0.25  # a shot this good should usually be scored
ROCKET_KMH = 110  # shot speed worth a speed tag on screen
LONG_SPELL_PASSES = 15  # completed passes in one spell of possession
MOMENTUM_SWING = 0.8  # recent threat this one-sided (on a -1..+1 scale)
PRESSING_PER_MIN = 2.5  # one team's pressures per minute over the last 5 minutes
CHAOS_TURNOVERS_PER_MIN = 3.0  # ball changing hands this often = chaos
MIN_WINDOW_SECONDS = 3 * 60  # need this much recent play before judging a trend
COOLDOWN_SECONDS = 8 * 60  # don't repeat the same trend moment more often than this


def shot_location(e: Event) -> dict:
    """Where a shot was taken from, in words, so agents describe it instead of guessing."""
    # Shooter's own frame: attacking toward x=105, low y = their right-hand side
    x, y = (e.x, e.y) if e.team == "home" else (105 - e.x, 68 - e.y)
    distance = ((105 - x) ** 2 + (34 - y) ** 2) ** 0.5
    if x >= 99.5 and 24.84 <= y <= 43.16:
        area = "inside the six-yard box"
    elif x >= 88.5 and 13.84 <= y <= 54.16:
        area = "inside the penalty area"
    else:
        area = "from outside the box"
    side = "central" if abs(y - 34) < 9 else ("from the right" if y < 34 else "from the left")
    return {"shot_distance_m": round(distance), "shot_area": area, "shot_angle": side}


@dataclass
class Moment:
    id: int
    t: float
    period: int
    kind: str  # kickoff, goal, big_chance, rocket, card, long_spell, momentum_shift, pressing, chaos, half_time, full_time
    importance: int  # 1 = minor, 2 = notable, 3 = major
    headline: str
    team: str | None = None
    player_id: int | None = None
    facts: dict = field(default_factory=dict)
    evidence: list[int] = field(default_factory=list)  # event ids


class MomentDetector:
    def __init__(self, state: MatchState):
        self.state = state
        self.ids = itertools.count(1)
        self.spell: list[Event] = []  # events of the current possession, for goal build-ups
        self.spell_announced = False
        self.last_trend: dict[str, float] = {}  # moment kind -> match time it last fired
        self.momentum_side: str | None = None  # side currently on top, once a swing has been called

    def check(self, e: Event) -> list[Moment]:
        if e.type == "possession_change":
            self.spell, self.spell_announced = [], False
        self.spell.append(e)

        found = []
        if e.type == "goal":
            found += self.goal(e)
        elif e.type == "shot":
            found += self.shot(e)
        elif e.type == "card":
            found.append(self.card(e))
        elif e.type == "pass" and self.state.possession_passes >= LONG_SPELL_PASSES and not self.spell_announced:
            self.spell_announced = True
            found.append(self.long_spell(e))
        elif e.type == "period_end":
            found.append(self.period_end(e))
        elif e.type == "period_start":
            found.append(self.kickoff(e))
        found += self.trends(e)
        return found

    # --- single-event moments ----------------------------------------------------

    def goal(self, e: Event) -> list[Moment]:
        s, names = self.state, self.state.names
        shot = next((x for x in reversed(self.spell) if x.id == e.goal.shot_id), None)
        passes = [x for x in self.spell if x.type == "pass" and x.pass_.outcome == "complete"]
        team_name = self.team_name(e.team)
        facts = {
            "scorer": names[e.player_id],
            "assist": names.get(e.goal.assist_id),
            "team": team_name,
            "score": f"{e.goal.home_score}-{e.goal.away_score}",
            "passes_in_move": len(passes),
            "deflected": e.goal.deflected,
            "scorer_goals_today": s.players[e.player_id].goals,
        }
        if shot:
            facts |= {
                "xg": shot.shot.xg,
                "body_part": shot.shot.body_part.replace("_", " "),
                "technique": shot.shot.technique.replace("_", " "),
                "situation": shot.shot.situation.replace("_", " "),
                "shot_kmh": round(shot_speed_kmh(shot)),
                **shot_location(shot),
            }
        moments = [self.moment(e, "goal", 3, f"GOAL! {facts['scorer']} scores for {team_name}, {facts['score']}",
                               facts, [x.id for x in self.spell])]
        goals = facts["scorer_goals_today"]
        if goals in (2, 3):
            label = "brace" if goals == 2 else "hat-trick"
            moments.append(self.moment(e, "milestone", 3, f"{facts['scorer']} completes a {label}",
                                       {"player": facts["scorer"], "goals_today": goals, "milestone": label}, [e.id]))
        return moments

    def shot(self, e: Event) -> list[Moment]:
        names, s = self.state.names, e.shot
        if s.outcome == "goal":
            return []  # the goal event covers it
        kmh = round(shot_speed_kmh(e))
        facts = {
            "shooter": names[e.player_id],
            "team": self.team_name(e.team),
            "xg": s.xg,
            "outcome": s.outcome.replace("_", " "),
            "stopped_by": names.get(s.blocker_id),
            "shot_kmh": kmh,
            "body_part": s.body_part.replace("_", " "),
            **shot_location(e),
        }
        if s.xg >= BIG_CHANCE_XG:
            return [self.moment(e, "big_chance", 2,
                                f"Big chance for {facts['shooter']} (xG {s.xg:.2f}), {facts['outcome']}", facts,
                                self.build_up())]
        if kmh >= ROCKET_KMH:
            return [self.moment(e, "rocket", 1, f"{facts['shooter']} hits it at {kmh} km/h", facts, self.build_up())]
        return []

    def card(self, e: Event) -> Moment:
        name = self.state.names[e.player_id]
        red = e.card.color == "red"
        reason = "second yellow" if e.card.reason == "second_yellow" else "foul"
        facts = {"player": name, "team": self.team_name(e.team), "color": e.card.color, "reason": reason}
        return self.moment(e, "card", 3 if red else 1, f"{e.card.color.capitalize()} card for {name}", facts,
                           self.build_up())

    def long_spell(self, e: Event) -> Moment:
        passes = [x for x in self.spell if x.type == "pass" and x.pass_.outcome == "complete"]
        seconds = round(e.t - self.spell[0].t)
        facts = {"team": self.team_name(e.team), "passes": len(passes), "seconds": seconds,
                 "players_involved": len({x.player_id for x in passes})}
        headline = f"{facts['team']} keep the ball: {len(passes)} passes in a row"
        return self.moment(e, "long_spell", 1, headline, facts, [x.id for x in passes])

    def kickoff(self, e: Event) -> Moment:
        """The start of each half, so the commentator opens the match instead of starting at 7'."""
        info = self.state.info
        first = e.period == 1
        facts = {
            "half": "first" if first else "second",
            "home": info.home.name,
            "away": info.away.name,
            "venue": info.venue,
            "home_formation": info.home.formation,
            "away_formation": info.away.formation,
        }
        headline = (f"We're under way at {info.venue}: {info.home.name} v {info.away.name}" if first
                    else f"The second half is under way at {info.venue}")
        return self.moment(e, "kickoff", 2, headline, facts, [e.id], team=None)

    def period_end(self, e: Event) -> Moment:
        snap = self.state.snapshot()
        kind = "half_time" if e.period == 1 else "full_time"
        facts = {
            "score": f"{snap['score']['home']}-{snap['score']['away']}",
            "possession_pct": snap["possession_pct"],
            "shots": {k: v["shots"] for k, v in snap["teams"].items()},
            "xg": {k: v["xg"] for k, v in snap["teams"].items()},
        }
        label = "Half-time" if kind == "half_time" else "Full-time"
        headline = f"{label}: {self.state.info.home.name} {facts['score']} {self.state.info.away.name}"
        return self.moment(e, kind, 3, headline, facts, [e.id])

    # --- trends over the last few minutes --------------------------------------------

    def trends(self, e: Event) -> list[Moment]:
        recent = self.state.recent
        if not recent or recent[-1].t - recent[0].t < MIN_WINDOW_SECONDS:
            return []
        window = self.state.recent_window()
        found = []

        # Momentum: recent threat swings strongly to one side (only announced when the side changes)
        momentum = window["momentum"]
        side = "home" if momentum >= MOMENTUM_SWING else "away" if momentum <= -MOMENTUM_SWING else None
        if side and side != self.momentum_side and self.cooled_down("momentum_shift", e.t):
            self.momentum_side = side
            other = "away" if side == "home" else "home"
            # In words, not a signed number: models misread "-0.85" as the named team losing
            facts = {"team_on_top": self.team_name(side), "other_team": self.team_name(other),
                     "share_of_recent_threat_pct": round(50 + abs(momentum) * 50),
                     "recent_pass_accuracy_pct": {self.team_name(k): round(v * 100) if v else None
                                                  for k, v in window["pass_accuracy"].items()}}
            found.append(self.moment(e, "momentum_shift", 2, f"{facts['team_on_top']} take control of the game",
                                     facts, self.recent_ids(("shot", "pass"), side), team=side))

        # Pressing: one team closing down far more than usual
        for side, per_min in window["pressures_per_min"].items():
            if per_min >= PRESSING_PER_MIN and self.cooled_down(f"pressing_{side}", e.t):
                other = "away" if side == "home" else "home"
                facts = {"team": self.team_name(side), "pressures_per_min": per_min,
                         "opponent": self.team_name(other),
                         "opponent_recent_pass_accuracy": window["pass_accuracy"][other]}
                found.append(self.moment(e, "pressing", 2, f"{facts['team']} press high and hard", facts,
                                         self.recent_ids(("pressure",), side), team=side))

        # Chaos: the ball keeps changing hands
        if window["turnovers_per_min"] >= CHAOS_TURNOVERS_PER_MIN and self.cooled_down("chaos", e.t):
            facts = {"turnovers_per_min": window["turnovers_per_min"], "recent_pass_accuracy": window["pass_accuracy"]}
            found.append(self.moment(e, "chaos", 1, "Scrappy spell: the ball keeps changing hands", facts,
                                     self.recent_ids(("possession_change",)), team=None))
        return found

    # --- helpers ---------------------------------------------------------------------

    def moment(self, e: Event, kind: str, importance: int, headline: str, facts: dict, evidence: list[int],
               team: str | None = "event") -> Moment:
        """team="event" (default) uses the team of the event that triggered it; trends pass the team they are about."""
        team = e.team if team == "event" else team
        player = e.player_id if team == e.team else None
        info, score = self.state.info, self.state.snapshot()["score"]
        # Every moment carries the score and minute, so no agent has to guess them
        facts = {**facts, "minute": int(e.t // 60) + 1,
                 "score_now": f"{info.home.name} {score['home']}-{score['away']} {info.away.name}"}
        return Moment(id=next(self.ids), t=e.t, period=e.period, kind=kind, importance=importance,
                      headline=headline, team=team, player_id=player, facts=facts, evidence=evidence)

    def build_up(self, events: int = 8) -> list[int]:
        """The last few events of the current spell, ending with this one: what a replay shows."""
        return [x.id for x in self.spell[-events:]]

    def cooled_down(self, key: str, t: float) -> bool:
        if t - self.last_trend.get(key, -COOLDOWN_SECONDS) < COOLDOWN_SECONDS:
            return False
        self.last_trend[key] = t
        return True

    def recent_ids(self, types: tuple[str, ...], side: str | None = None) -> list[int]:
        return [x.id for x in self.state.recent if x.type in types and (side is None or x.team == side)][-20:]

    def team_name(self, side: str | None) -> str | None:
        return {"home": self.state.info.home.name, "away": self.state.info.away.name}.get(side)
