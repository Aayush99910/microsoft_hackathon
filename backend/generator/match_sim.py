"""Match simulator: streams a synthetic 90-minute match as events.

The whole match is one loop. Each step, the player on the ball:
    1. maybe runs with it (carry) -> may get tackled or fouled
    2. maybe gets closed down by an opponent (pressure)
    3. near goal maybe shoots, otherwise passes
    4. the pass is completed, intercepted, or goes out of play
and the clock moves on by however long that took.

Every chance and distance comes from calibration.json, measured from real
matches, so the numbers behave like real football while each match is new.
A `script` of goals lets a demo put the drama exactly where it is wanted.

Internally the ball position is kept in the *attacking frame* of the team in
possession (as if they attack toward x=105); events are converted to the real
pitch coordinates described in events.py when they are emitted.

Run (from backend/):
    python -m generator.match_sim --seed 7
    python -m generator.match_sim --seed 7 --goal 23:home --goal 78:away:30 --out match.json
"""

import argparse
import json
import math
import random
from collections import Counter
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

from .events import (
    CardDetails,
    CardEvent,
    CarryDetails,
    CarryEvent,
    Event,
    FoulDetails,
    FoulEvent,
    GoalDetails,
    GoalEvent,
    MatchInfo,
    PassDetails,
    PassEvent,
    PeriodEndEvent,
    PeriodStartEvent,
    PossessionChangeDetails,
    PossessionChangeEvent,
    PressureDetails,
    PressureEvent,
    ShotDetails,
    ShotEvent,
    TackleDetails,
    TackleEvent,
)
from .teams import FORMATION_433, build_teams

CALIBRATION = json.loads(Path(__file__).with_name("calibration.json").read_text())

LENGTH, WIDTH = 105.0, 68.0
CENTER = (LENGTH / 2, WIDTH / 2)
GOAL = (LENGTH, WIDTH / 2)
GOAL_Y_MIN, GOAL_Y_MAX, CROSSBAR = 30.34, 37.66, 2.44
HALF_SECONDS = 45 * 60
MAX_PASS_LENGTH = 65.0


@dataclass
class ScriptedGoal:
    """Force a goal for `side` at `minute` (scorer/assist picked if not given)."""

    minute: int
    side: str
    scorer_id: int | None = None
    assist_id: int | None = None


def flip(x: float, y: float) -> tuple[float, float]:
    """Convert a point between the two teams' attacking frames."""
    return LENGTH - x, WIDTH - y


def clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, value))


def other(side: str) -> str:
    return "away" if side == "home" else "home"


class MatchSimulator:
    def __init__(self, seed: int = 7, script: list[ScriptedGoal] | None = None):
        self.seed = seed
        self.rng = random.Random(seed)
        self.cal = CALIBRATION
        self.home, self.away = build_teams()
        self.teams = {"home": self.home, "away": self.away}
        self.players = {p.id: p for team in self.teams.values() for p in team.players}
        self.script = sorted(script or [], key=lambda g: g.minute)

        self.t = 0.0
        self.period = 1
        self.next_id = 1
        self.possession = 0
        self.score = {"home": 0, "away": 0}
        self.yellows: Counter[int] = Counter()
        self.sent_off: set[int] = set()
        self.pending: list[Event] = []

        # Ball state, in the attacking frame of the team in possession
        self.side = "home"
        self.carrier = 0  # 0 = nobody (before kickoff)
        self.bx, self.by = CENTER
        self.last_pass: tuple[int, int, bool] | None = None  # (passer, recipient, high), for assists and headers
        # Where and how the current possession started, to spot counter-attacks
        self.possession_start = (0.0, CENTER[0], "kickoff")  # (t, x, reason)

    @property
    def info(self) -> MatchInfo:
        return MatchInfo(
            match_id=f"synthetic-{self.seed}",
            seed=self.seed,
            venue="Northbridge Park",
            home=self.home,
            away=self.away,
        )

    # --- main loop -----------------------------------------------------------

    def run(self) -> Iterator[Event]:
        self.start_period(1, kickoff_side="home")
        yield from self.flush()
        while True:
            if self.t >= self.period * HALF_SECONDS:
                self.emit(PeriodEndEvent, None, None, *CENTER)
                if self.period == 2:
                    yield from self.flush()
                    return
                self.t = HALF_SECONDS
                self.start_period(2, kickoff_side="away")
            elif self.script_due():
                self.scripted_goal(self.script.pop(0))
            else:
                self.play_step()
            yield from self.flush()

    def play_step(self) -> None:
        if self.rng.random() < self.cal["carry"]["prob_before_action"]:
            if not self.carry():
                return  # lost the ball
        pressed = self.rng.random() < self.cal["pressure"]["prob_by_third"][self.third()]
        if pressed:
            self.press()
        if self.rng.random() < self.shoot_prob():
            self.shoot(pressed)
        else:
            self.pass_ball(pressed)

    def start_period(self, period: int, kickoff_side: str) -> None:
        self.period = period
        self.carrier = 0  # nobody "lost" the ball at the start of a half
        self.emit(PeriodStartEvent, None, None, *CENTER)
        self.kickoff(kickoff_side)

    def kickoff(self, side: str) -> None:
        self.new_possession(side, self.player_at(side, "ST"), *CENTER, reason="kickoff")

    # --- actions ---------------------------------------------------------------

    def carry(self) -> bool:
        """Run with the ball. Returns False if the ball was lost."""
        cal = self.cal["carry"]
        length = self.sample_deciles(cal["length_deciles_m"])
        angle = self.rng.gauss(0, math.radians(50))
        ex = clamp(self.bx + length * math.cos(angle), 1, LENGTH - 1)
        ey = clamp(self.by + length * math.sin(angle), 1, WIDTH - 1)
        duration = max(0.4, length / (cal["speed_ms_median"] * self.rng.uniform(0.7, 1.5)))

        self.emit(
            CarryEvent, self.side, self.carrier, self.bx, self.by,
            carry=CarryDetails(**self.end_point(ex, ey), duration=round(duration, 2)),
        )
        self.t += duration
        self.bx, self.by = ex, ey

        # Tackles and fouls are measured per pass/shot; they happen around carries, so scale to a per-carry rate
        tackle = self.cal["tackle"]["by_third"][self.third()]  # defenders challenge more near their own box
        if self.rng.random() < tackle["prob_per_action"] / cal["prob_before_action"]:
            defender = self.nearest_defender()
            won = self.rng.random() < tackle["success"]
            self.emit(
                TackleEvent, other(self.side), defender, self.bx, self.by, frame=self.side,
                tackle=TackleDetails(opponent_id=self.carrier, won=won),
            )
            if won:
                self.t += 0.5
                self.new_possession(other(self.side), defender, *flip(self.bx, self.by), reason="tackle")
                return False

        if self.rng.random() < self.cal["discipline"]["foul_prob_per_action"] / cal["prob_before_action"]:
            self.foul()
        return True

    def press(self) -> None:
        self.emit(
            PressureEvent, other(self.side), self.nearest_defender(), self.bx, self.by, frame=self.side,
            pressure=PressureDetails(target_id=self.carrier),
        )

    def pass_ball(self, pressed: bool) -> None:
        cal = self.cal["pass"]
        buckets = cal["length_buckets"]
        bucket = buckets[self.pick([b["share"] for b in buckets])]
        length = self.rng.uniform(max(bucket["min"], 3), min(bucket["max"], MAX_PASS_LENGTH))  # 3 m+ to count as a pass
        ex, ey = self.pass_target(length)
        into_box = ex >= LENGTH - 16.5 and abs(ey - WIDTH / 2) <= 20.16  # crosses get lifted
        high = self.rng.random() < (cal["high_share_into_box"] if into_box else bucket["high_share"])

        # Bucket fail rates mix calm and pressed passes; split them using the pressure multiplier
        multiplier = cal["pressure_fail_multiplier"]
        avg_pressure = sum(self.cal["pressure"]["prob_by_third"].values()) / 3
        fail_rate = bucket["fail_rate"] / (1 + avg_pressure * (multiplier - 1))
        target_distance = math.dist((ex, ey), GOAL)
        fail_rate *= next(
            b["multiplier"] for b in cal["fail_multiplier_by_target_distance"] if b["min"] <= target_distance < b["max"]
        )
        if pressed:
            fail_rate *= multiplier
        fail_rate = min(fail_rate, 0.95)

        if self.rng.random() >= fail_rate:
            recipient = self.nearest_teammate(ex, ey)
            self.complete_pass(recipient, ex, ey, high, pressed)
        elif self.rng.random() < cal["out_of_play_share_of_fails"]:
            self.pass_out(ex, ey, high, pressed)
        else:
            self.pass_intercepted(ex, ey, high, pressed)

    def complete_pass(self, recipient: int, ex: float, ey: float, high: bool, pressed: bool) -> None:
        duration = self.flight_time(ex, ey, high)
        self.emit_pass(ex, ey, recipient, "complete", high, duration, pressed)
        self.t += duration + self.rng.uniform(1.2, 3.0)  # flight + controlling the ball and looking up
        self.last_pass = (self.carrier, recipient, high)
        self.carrier = recipient
        self.bx, self.by = ex, ey

    def pass_intercepted(self, ex: float, ey: float, high: bool, pressed: bool) -> None:
        share = self.rng.uniform(0.4, 1.0)  # how far along the path it was cut out
        ix, iy = self.bx + (ex - self.bx) * share, self.by + (ey - self.by) * share
        duration = self.flight_time(ix, iy, high)
        self.emit_pass(ix, iy, None, "intercepted", high, duration, pressed)
        self.t += duration
        defender = self.nearest_player(other(self.side), *flip(ix, iy))
        self.new_possession(other(self.side), defender, *flip(ix, iy), reason="interception")

    def pass_out(self, ex: float, ey: float, high: bool, pressed: bool) -> None:
        ey = 0.0 if ey < WIDTH / 2 else WIDTH  # over the nearest touchline
        duration = self.flight_time(ex, ey, high)
        self.emit_pass(ex, ey, None, "out", high, duration, pressed)
        self.t += duration + self.rng.uniform(8, 18)  # throw-in
        thrower = self.nearest_player(other(self.side), *flip(ex, ey))
        self.new_possession(other(self.side), thrower, *flip(ex, ey), reason="out_of_play")

    def shoot(self, pressed: bool, force_goal: bool = False) -> None:
        distance = math.dist((self.bx, self.by), GOAL)
        bucket = self.shot_bucket(distance)
        centrality = 1 - min(abs(self.by - WIDTH / 2) / (WIDTH / 2), 1)
        body_part, technique = self.shot_style()
        # Bucket goal rate is an average over all angles; central shots score more, wide ones less
        xg = bucket["goal_rate"] * (0.4 + 0.8 * centrality)
        if body_part == "head":
            xg *= self.cal["shot"]["header_xg_multiplier"]  # headers are harder to score
        xg = clamp(xg, 0.01, 0.9)

        if force_goal or self.rng.random() < xg:
            outcome = "goal"
        else:
            misses = self.cal["shot"]["miss_outcomes"]
            outcome = list(misses)[self.pick(list(misses.values()))]

        ex, ey, ez = self.shot_end(outcome)
        # m/s; open data has no shot speed, so this is an assumption (headers are much slower)
        speed = self.rng.uniform(8, 18) if body_part == "head" else self.rng.uniform(16, 32)
        duration = math.dist((self.bx, self.by), (ex, ey)) / speed

        defending = other(self.side)
        blocker = None
        if outcome == "blocked":
            blocker = self.nearest_player(defending, *flip(ex, ey), exclude=(self.player_at(defending, "GK"),))
        elif outcome == "saved":
            blocker = self.player_at(defending, "GK")
        deflected = outcome != "blocked" and self.rng.random() < self.cal["shot"]["deflected_share"]

        shot_id = self.next_id
        self.emit(
            ShotEvent, self.side, self.carrier, self.bx, self.by, under_pressure=pressed,
            shot=ShotDetails(**self.end_point(ex, ey), end_z=round(ez, 2), duration=round(duration, 2),
                             xg=round(xg, 3), outcome=outcome, blocker_id=blocker, deflected=deflected,
                             body_part=body_part, technique=technique, situation=self.situation()),
        )
        self.t += duration
        self.after_shot(outcome, blocker, ex, ey, shot_id, deflected)

    def after_shot(self, outcome: str, blocker: int | None, ex: float, ey: float, shot_id: int,
                   deflected: bool) -> None:
        defending = other(self.side)
        keeper = self.player_at(defending, "GK")
        if outcome == "goal":
            self.score[self.side] += 1
            assist = self.last_pass[0] if self.last_pass and self.last_pass[1] == self.carrier else None
            self.emit(
                GoalEvent, self.side, self.carrier, self.bx, self.by,
                goal=GoalDetails(shot_id=shot_id, assist_id=assist, deflected=deflected,
                                 home_score=self.score["home"], away_score=self.score["away"]),
            )
            self.t += self.rng.uniform(45, 75)  # celebration
            self.kickoff(defending)
        elif outcome == "saved":
            self.t += self.rng.uniform(2, 6)
            self.new_possession(defending, keeper, 6, WIDTH / 2, reason="save")
        elif outcome == "blocked" and self.rng.random() < 0.4:
            self.carrier = self.nearest_teammate(self.bx - 4, self.by)  # rebound stays with attackers
            self.t += 1.0
        elif outcome == "blocked":
            self.new_possession(defending, blocker, *flip(ex, ey), reason="loose_ball")
        else:  # off target or woodwork -> goal kick
            self.t += self.rng.uniform(15, 30)
            self.new_possession(defending, keeper, 5.5, WIDTH / 2 + self.rng.uniform(-9, 9), reason="goal_kick")

    def foul(self) -> None:
        defending = other(self.side)
        fouler = self.nearest_defender()
        self.emit(FoulEvent, defending, fouler, self.bx, self.by, frame=self.side,
                  foul=FoulDetails(victim_id=self.carrier))
        discipline = self.cal["discipline"]
        roll = self.rng.random()
        if roll < discipline["red_per_foul"] and self.players[fouler].position != "GK":
            self.send_off(defending, fouler, "foul")
        elif roll < discipline["red_per_foul"] + discipline["yellow_per_foul"]:
            self.yellows[fouler] += 1
            self.emit(CardEvent, defending, fouler, self.bx, self.by, frame=self.side,
                      card=CardDetails(color="yellow", reason="foul"))
            if self.yellows[fouler] == 2 and self.players[fouler].position != "GK":
                self.send_off(defending, fouler, "second_yellow")
        self.t += self.rng.uniform(15, 35)  # free kick

    def send_off(self, side: str, player_id: int, reason: str) -> None:
        self.emit(CardEvent, side, player_id, self.bx, self.by, frame=self.side,
                  card=CardDetails(color="red", reason=reason))
        self.sent_off.add(player_id)

    def script_due(self) -> bool:
        """A scripted goal starts once its minute has passed and that team has the ball.

        If they still haven't won the ball 3 minutes later, it starts anyway.
        """
        if not self.script:
            return False
        goal = self.script[0]
        late = self.t - goal.minute * 60
        return late >= 0 and (self.side == goal.side or late >= 180)

    def scripted_goal(self, goal: ScriptedGoal) -> None:
        """Build a short move that ends in a goal: build-up, ball out wide, cross, finish."""
        if self.side != goal.side:
            self.new_possession(goal.side, self.player_at(goal.side, "CM"), 55, WIDTH / 2, reason="interception")
            self.t += 2
        active = self.positions(goal.side)
        assist = goal.assist_id if goal.assist_id in active else self.player_at(
            goal.side, self.rng.choice(["RW", "LW", "RCM", "LCM"]))
        scorer = goal.scorer_id if goal.scorer_id in active else self.player_at(
            goal.side, self.rng.choice(["ST", "ST", "RW", "LW"]))
        if scorer == assist:
            scorer = self.player_at(goal.side, "ST")

        # Cross from the assister's own flank (low y is the right-hand side)
        right_side = self.players[assist].position.startswith("R")
        wing_y = WIDTH / 2 + (-22 if right_side else 22)
        if self.carrier != assist:
            if self.bx < 50:  # too far back for one pass: play it through midfield first
                self.complete_pass(self.player_at(goal.side, "CM"), 60, WIDTH / 2, high=False, pressed=False)
            self.complete_pass(assist, 84, wing_y, high=False, pressed=False)
        self.complete_pass(scorer, 95, WIDTH / 2 + self.rng.uniform(-5, 5), high=True, pressed=False)
        self.shoot(pressed=False, force_goal=True)

    # --- helpers: state and events ----------------------------------------------

    def new_possession(self, side: str, player_id: int, x: float, y: float, reason: str) -> None:
        """Give the ball to `side`; x, y are in that side's attacking frame."""
        lost_by = self.carrier or None  # whoever had it until now (0 = nobody)
        self.side, self.carrier = side, player_id
        self.bx, self.by = clamp(x, 0, LENGTH), clamp(y, 0, WIDTH)
        self.possession += 1
        self.possession_start = (self.t, self.bx, reason)
        self.last_pass = None
        self.emit(PossessionChangeEvent, side, player_id, self.bx, self.by,
                  possession_change=PossessionChangeDetails(reason=reason, lost_by_id=lost_by))

    def emit(self, cls, side, player_id, x, y, frame=None, **fields) -> None:
        """Queue an event. x, y are in `frame`'s attacking frame (default: the acting side's)."""
        ax, ay = self.to_pitch(x, y, frame or side or "home")
        self.pending.append(cls(
            id=self.next_id, t=round(self.t, 1), period=self.period, team=side, player_id=player_id,
            x=ax, y=ay, possession=self.possession, **fields,
        ))
        self.next_id += 1

    def emit_pass(self, ex, ey, recipient, outcome, high, duration, pressed) -> None:
        self.emit(
            PassEvent, self.side, self.carrier, self.bx, self.by, under_pressure=pressed,
            pass_=PassDetails(**self.end_point(ex, ey), recipient_id=recipient, outcome=outcome,
                              height="high" if high else "ground", duration=round(duration, 2)),
        )

    def flush(self) -> Iterator[Event]:
        yield from self.pending
        self.pending = []

    def to_pitch(self, x: float, y: float, frame: str) -> tuple[float, float]:
        """Attacking frame of `frame` -> real pitch coordinates (home attacks toward x=105)."""
        if frame == "away":
            x, y = flip(x, y)
        return round(x, 1), round(y, 1)

    def end_point(self, x: float, y: float) -> dict:
        ex, ey = self.to_pitch(x, y, self.side)
        return {"end_x": ex, "end_y": ey}

    # --- helpers: players and positions ------------------------------------------

    def positions(self, side: str) -> dict[int, tuple[float, float]]:
        """Rough spot of each active player of `side`, in that side's attacking frame.

        The whole shape slides up and down the pitch with the ball, and the team
        in possession pushes a little higher.
        """
        ball_x = self.bx if side == self.side else LENGTH - self.bx
        shift = (ball_x - LENGTH / 2) * 0.5
        push = 6 if side == self.side else 0
        spots = {}
        for p in self.teams[side].players:
            if p.id in self.sent_off:
                continue
            fx, fy = FORMATION_433[p.position]
            if p.position == "GK":
                spots[p.id] = (fx + max(0.0, shift) * 0.2, fy)
            else:
                spots[p.id] = (clamp(fx + shift + push, 3, LENGTH - 3), fy)
        return spots

    def nearest_player(self, side: str, x: float, y: float, exclude: tuple[int, ...] = ()) -> int:
        spots = self.positions(side)
        return min((pid for pid in spots if pid not in exclude), key=lambda pid: math.dist(spots[pid], (x, y)))

    def nearest_teammate(self, x: float, y: float) -> int:
        return self.nearest_player(self.side, x, y, exclude=(self.carrier,))

    def nearest_defender(self) -> int:
        return self.nearest_player(other(self.side), *flip(self.bx, self.by))

    def player_at(self, side: str, position: str) -> int:
        for p in self.teams[side].players:
            if p.position == position and p.id not in self.sent_off:
                return p.id
        return next(iter(self.positions(side)))  # that player was sent off: anyone active

    # --- helpers: football geometry and chance ------------------------------------

    def third(self) -> str:
        return "defensive" if self.bx < 35 else "middle" if self.bx < 70 else "attacking"

    def shot_bucket(self, distance: float) -> dict:
        buckets = self.cal["shot"]["distance_buckets"]
        return next((b for b in buckets if b["min"] <= distance < b["max"]), buckets[-1])

    def shoot_prob(self) -> float:
        return self.shot_bucket(math.dist((self.bx, self.by), GOAL))["shoot_prob"]

    def shot_style(self) -> tuple[str, str]:
        """Body part and technique. A ball that arrives in the air gets headed or volleyed far more often."""
        cal = self.cal["shot"]
        in_the_air = bool(self.last_pass and self.last_pass[1] == self.carrier and self.last_pass[2])
        header_share = cal["header_share"]["after_high_pass" if in_the_air else "otherwise"]
        close_enough = math.dist((self.bx, self.by), GOAL) < 18  # nobody heads it from 25 m
        if close_enough and self.rng.random() < header_share:
            body_part, techniques = "head", cal["technique"]["head"]
        else:
            body_part = "left_foot" if self.rng.random() < cal["left_foot_share"] else "right_foot"
            techniques = cal["technique"]["foot_after_high_pass" if in_the_air else "foot_otherwise"]
        return body_part, list(techniques)[self.pick(list(techniques.values()))]

    def situation(self) -> str:
        """Counter-attack = ball won in our own half, then a shot within 15 seconds."""
        start_t, start_x, reason = self.possession_start
        won_back = reason in ("interception", "tackle", "loose_ball")
        if won_back and start_x < LENGTH / 2 and self.t - start_t <= 15:
            return "counter_attack"
        return "open_play"

    def pass_target(self, length: float) -> tuple[float, float]:
        """Pick an end point `length` metres away, in a direction typical for this third."""
        shares = self.cal["pass"]["direction_by_third"][self.third()]
        for _ in range(8):
            sector = list(shares)[self.pick(list(shares.values()))]
            if sector == "forward":
                angle = self.rng.uniform(-45, 45)
            elif sector == "sideways":
                angle = self.rng.choice([-1, 1]) * self.rng.uniform(45, 135)
            else:
                angle = self.rng.choice([-1, 1]) * self.rng.uniform(135, 180)
            ex = self.bx + length * math.cos(math.radians(angle))
            ey = self.by + length * math.sin(math.radians(angle))
            if 1 <= ex <= LENGTH - 1 and 1 <= ey <= WIDTH - 1:
                return ex, ey
        return clamp(ex, 1, LENGTH - 1), clamp(ey, 1, WIDTH - 1)

    def flight_time(self, ex: float, ey: float, high: bool) -> float:
        speed = self.cal["pass"]["ball_speed_ms"]["high" if high else "ground"] * self.rng.uniform(0.75, 1.3)
        return max(0.3, math.dist((self.bx, self.by), (ex, ey)) / speed)

    def shot_end(self, outcome: str) -> tuple[float, float, float]:
        if outcome in ("goal", "saved"):
            return LENGTH, self.rng.uniform(GOAL_Y_MIN + 0.3, GOAL_Y_MAX - 0.3), self.rng.uniform(0.1, CROSSBAR - 0.1)
        if outcome == "woodwork":
            if self.rng.random() < 0.3:  # crossbar
                return LENGTH, self.rng.uniform(GOAL_Y_MIN, GOAL_Y_MAX), CROSSBAR
            return LENGTH, self.rng.choice([GOAL_Y_MIN, GOAL_Y_MAX]), self.rng.uniform(0, CROSSBAR)  # a post
        if outcome == "blocked":
            step = self.rng.uniform(1, 4)
            dx, dy = GOAL[0] - self.bx, GOAL[1] - self.by
            norm = math.hypot(dx, dy) or 1
            return self.bx + dx / norm * step, self.by + dy / norm * step, self.rng.uniform(0, 1)
        side = self.rng.choice([-1, 1])  # off target: wide or over
        return LENGTH, WIDTH / 2 + side * self.rng.uniform(4.2, 12), self.rng.uniform(0, 4.5)

    def sample_deciles(self, deciles: list[float]) -> float:
        """Sample a value from a distribution described by its 10%, 20%, ..., 90% points."""
        i = self.rng.randrange(len(deciles) + 1)
        lo = deciles[i - 1] if i > 0 else 0.3
        hi = deciles[i] if i < len(deciles) else deciles[-1] * 1.6
        return self.rng.uniform(lo, hi)

    def pick(self, weights: list[float]) -> int:
        return self.rng.choices(range(len(weights)), weights=weights)[0]


def simulate_match(seed: int = 7, script: list[ScriptedGoal] | None = None) -> tuple[MatchInfo, list[Event]]:
    sim = MatchSimulator(seed, script)
    return sim.info, list(sim.run())


def summarize(events: list[Event]) -> dict:
    """Headline numbers, to compare a generated match against the real averages."""
    by_type = Counter(e.type for e in events)
    passes = [e for e in events if e.type == "pass"]
    goals = [e for e in events if e.type == "goal"]
    last_goal = goals[-1].goal if goals else None
    return {
        "events": len(events),
        "by_type": dict(by_type.most_common()),
        "pass_accuracy": round(sum(p.pass_.outcome == "complete" for p in passes) / len(passes), 3),
        "score": f"{last_goal.home_score}-{last_goal.away_score}" if last_goal else "0-0",
        "goals": [(f"{int(g.t // 60)}'", g.team, g.player_id) for g in goals],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate a synthetic football match.")
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--goal", action="append", default=[], metavar="MIN:SIDE[:SCORER_ID]",
                        help="script a goal, e.g. 23:home or 78:away:30 (repeatable)")
    parser.add_argument("--out", type=Path, help="write {info, events} JSON to this file")
    args = parser.parse_args()

    script = []
    for spec in args.goal:
        minute, side, *scorer = spec.split(":")
        script.append(ScriptedGoal(int(minute), side, int(scorer[0]) if scorer else None))

    info, events = simulate_match(args.seed, script)
    print(json.dumps(summarize(events), indent=2))
    if args.out:
        payload = {
            "info": info.model_dump(),
            "events": [e.model_dump(by_alias=True) for e in events],
        }
        args.out.write_text(json.dumps(payload, indent=1))
        print(f"Wrote {len(events)} events to {args.out}")


if __name__ == "__main__":
    main()
