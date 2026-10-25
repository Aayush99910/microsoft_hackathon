"""Event schema: what a single match event looks like.

Pitch coordinates (metres, same for every event):

        y=68 ┌──────────────────────────────┐
             │                              │
    home     │              ●               │    home attacks →
    goal  ▐  │         (52.5, 34)           │  ▌ away goal
    x=0      │                              │    x=105
        y=0  └──────────────────────────────┘

- x runs along the pitch, 0 = home goal line, 105 = away goal line.
- y runs across the pitch, 0 = bottom touchline, 68 = top touchline.
- The home team always attacks toward x=105, the away team toward x=0.

Every event has the common fields in `Event`. Types that need more detail
(pass, shot, ...) carry it in a nested block, e.g. `{"type": "pass", "pass": {...}}`.
Derived stats (pass distance, ball speed, ...) are NOT stored; they are
calculated from these raw facts by the stats layer.
"""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

Side = Literal["home", "away"]


class Event(BaseModel):
    """Fields every event has."""

    model_config = ConfigDict(populate_by_name=True)

    id: int  # running number, 1, 2, 3, ... (use this to order events)
    # Match clock in seconds (754.2 = 12:34.2). Like a real clock, the first half can run
    # past 2700 (45:00) into stoppage time, and the second half restarts at 2700.
    t: float
    period: Literal[1, 2]
    team: Side | None  # team that performed the event (None for period events)
    player_id: int | None  # player who performed it (None for period events)
    x: float  # where it happened, see pitch diagram above
    y: float
    possession: int  # which spell of possession this belongs to (1, 2, 3, ...)
    under_pressure: bool = False  # an opponent was closing the player down


# --- type-specific details -------------------------------------------------


class PassDetails(BaseModel):
    end_x: float  # where the ball ended up
    end_y: float
    recipient_id: int | None  # None when the pass did not reach a teammate
    outcome: Literal["complete", "intercepted", "out"]
    height: Literal["ground", "high"]
    duration: float  # seconds the ball travelled -> speed = distance / duration


class CarryDetails(BaseModel):
    end_x: float  # where the player stopped running with the ball
    end_y: float
    duration: float


class DribbleDetails(BaseModel):
    opponent_id: int  # defender being taken on (the dribbler is the event's player_id)
    success: bool  # True = beat them, False = lost the ball


class ShotDetails(BaseModel):
    end_x: float  # where the ball ended up (goal line for on-target shots)
    end_y: float
    end_z: float  # height in metres (crossbar is at 2.44)
    duration: float  # seconds from strike to end point -> shot speed
    xg: float  # expected goals: chance this shot scores, 0..1
    outcome: Literal["goal", "saved", "off_target", "blocked", "woodwork"]  # woodwork = post or crossbar
    blocker_id: int | None = None  # defender who blocked it ("blocked") or keeper who stopped it ("saved")
    deflected: bool = False  # touched a player on the way (can still end in a goal)
    body_part: Literal["right_foot", "left_foot", "head"]
    technique: Literal["normal", "volley", "half_volley", "overhead", "diving_header"]
    # How the attack started. Set pieces (corner, free kick, penalty) are not simulated yet.
    situation: Literal["open_play", "counter_attack"]


class PressureDetails(BaseModel):
    target_id: int  # opponent being pressed


class TackleDetails(BaseModel):
    opponent_id: int  # player who had the ball
    won: bool


class PossessionChangeDetails(BaseModel):
    reason: Literal["kickoff", "interception", "tackle", "out_of_play", "save", "goal_kick", "loose_ball"]
    lost_by_id: int | None  # player who last had the ball (None at the start of a half)


class FoulDetails(BaseModel):
    victim_id: int


class CardDetails(BaseModel):
    color: Literal["yellow", "red"]
    reason: Literal["foul", "second_yellow"]


class GoalDetails(BaseModel):
    shot_id: int  # the shot event this goal came from (body part, technique, xG, ...)
    assist_id: int | None  # None = solo goal
    deflected: bool  # copied from the shot, for overlays
    home_score: int  # score after this goal
    away_score: int


# --- event types -------------------------------------------------------------


class PassEvent(Event):
    type: Literal["pass"] = "pass"
    pass_: PassDetails = Field(alias="pass")  # `pass` is a Python keyword



class CarryEvent(Event):
    type: Literal["carry"] = "carry"
    carry: CarryDetails


class DribbleEvent(Event):
    type: Literal["dribble"] = "dribble"
    dribble: DribbleDetails


class ShotEvent(Event):
    type: Literal["shot"] = "shot"
    shot: ShotDetails


class GoalEvent(Event):
    """Sent right after a shot with outcome "goal", carrying the new score for overlays."""

    type: Literal["goal"] = "goal"
    goal: GoalDetails


class PressureEvent(Event):
    type: Literal["pressure"] = "pressure"
    pressure: PressureDetails


class TackleEvent(Event):
    type: Literal["tackle"] = "tackle"
    tackle: TackleDetails


class PossessionChangeEvent(Event):
    """`team` / `player_id` are the side and player that now have the ball."""

    type: Literal["possession_change"] = "possession_change"
    possession_change: PossessionChangeDetails


class FoulEvent(Event):
    type: Literal["foul"] = "foul"
    foul: FoulDetails


class CardEvent(Event):
    type: Literal["card"] = "card"
    card: CardDetails


class PeriodStartEvent(Event):
    type: Literal["period_start"] = "period_start"


class PeriodEndEvent(Event):
    type: Literal["period_end"] = "period_end"


MatchEvent = Annotated[
    PassEvent
    | CarryEvent
    | DribbleEvent
    | ShotEvent
    | GoalEvent
    | PressureEvent
    | TackleEvent
    | PossessionChangeEvent
    | FoulEvent
    | CardEvent
    | PeriodStartEvent
    | PeriodEndEvent,
    Field(discriminator="type"),
]


# --- match metadata ------------------------------------------------------------


class Player(BaseModel):
    id: int
    name: str
    number: int
    position: str  # GK, RB, RCB, LCB, LB, RCM, CM, LCM, RW, ST, LW


class Team(BaseModel):
    side: Side
    name: str
    short_name: str
    color: str  # hex, for overlays
    formation: str
    players: list[Player]


class MatchInfo(BaseModel):
    match_id: str
    seed: int  # same seed -> same match
    venue: str
    home: Team
    away: Team
