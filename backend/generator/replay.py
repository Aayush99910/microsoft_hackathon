"""Watch a synthetic match in the terminal, one readable line per event.

Run (from backend/):
    python -m generator.replay --seed 7 --delay 3          # one event every 3 seconds
    python -m generator.replay --seed 7 --speed 30         # match clock at 30x real time
    python -m generator.replay --seed 7 --delay 0 --only shot,goal,card
"""

import argparse
import math
import time

from .events import Event, MatchInfo
from .match_sim import ScriptedGoal, simulate_match


def clock(e: Event) -> str:
    """Match clock as shown on TV: 12:34, or 45+1:20 in stoppage time."""
    minute, second = int(e.t // 60), int(e.t % 60)
    limit = 45 * e.period
    if minute >= limit:
        return f"{limit}+{minute - limit}:{second:02d}"
    return f"{minute:02d}:{second:02d}"


def describe(e: Event, names: dict[int, str]) -> str:
    """One short sentence for an event."""
    who = names.get(e.player_id, "")
    if e.type == "pass":
        p = e.pass_
        dist = math.dist((e.x, e.y), (p.end_x, p.end_y))
        result = f"to {names[p.recipient_id]}" if p.recipient_id else p.outcome.upper()
        return f"{who} passes {result} ({dist:.0f} m, {p.height}, {dist / p.duration:.0f} m/s)"
    if e.type == "carry":
        dist = math.dist((e.x, e.y), (e.carry.end_x, e.carry.end_y))
        return f"{who} runs with the ball ({dist:.0f} m)"
    if e.type == "pressure":
        return f"{who} closes down {names[e.pressure.target_id]}"
    if e.type == "tackle":
        result = "wins it!" if e.tackle.won else "fails"
        return f"{who} tackles {names[e.tackle.opponent_id]} and {result}"
    if e.type == "shot":
        s = e.shot
        speed = math.dist((e.x, e.y), (s.end_x, s.end_y)) / s.duration * 3.6
        by = f" by {names[s.blocker_id]}" if s.blocker_id else ""
        extras = " (deflected)" if s.deflected else ""
        return (f"{who} SHOOTS, {s.body_part.replace('_', ' ')} {s.technique.replace('_', ' ')}, "
                f"xG {s.xg:.2f}, {speed:.0f} km/h -> {s.outcome.replace('_', ' ').upper()}{by}{extras}")
    if e.type == "goal":
        g = e.goal
        assist = f", assist {names[g.assist_id]}" if g.assist_id else ", solo goal"
        return f"GOAL! {who}{assist}   {g.home_score}-{g.away_score}"
    if e.type == "possession_change":
        return f"{who} gets the ball ({e.possession_change.reason.replace('_', ' ')})"
    if e.type == "foul":
        return f"{who} fouls {names[e.foul.victim_id]}"
    if e.type == "card":
        return f"{e.card.color.upper()} CARD for {who}"
    if e.type == "period_start":
        return f"--- {'Kick-off' if e.period == 1 else 'Second half underway'} ---"
    if e.type == "period_end":
        return f"--- {'Half-time' if e.period == 1 else 'Full-time'} ---"
    return e.type


def replay(info: MatchInfo, events: list[Event], delay: float, speed: float, only: set[str]) -> None:
    names = {p.id: p.name for team in (info.home, info.away) for p in team.players}
    short = {"home": info.home.short_name, "away": info.away.short_name, None: "   "}
    print(f"\n{info.home.name} vs {info.away.name}  ({info.venue}, seed {info.seed})\n")

    previous_t = 0.0
    for e in events:
        if only and e.type not in only:
            continue
        if speed:
            time.sleep(max(0.0, e.t - previous_t) / speed)  # keep match-clock spacing
        elif delay:
            time.sleep(delay)
        previous_t = e.t
        pressure = " [under pressure]" if e.under_pressure else ""
        print(f"{clock(e):>8}  {short[e.team]}  {describe(e, names)}{pressure}", flush=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="Watch a synthetic match in the terminal.")
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--goal", action="append", default=[], metavar="MIN:SIDE[:SCORER_ID]")
    parser.add_argument("--delay", type=float, default=3.0, help="seconds between events (default 3)")
    parser.add_argument("--speed", type=float, default=0, help="play at N x real time instead of a fixed delay")
    parser.add_argument("--only", default="", help="comma-separated event types to show, e.g. shot,goal")
    args = parser.parse_args()

    script = []
    for spec in args.goal:
        minute, side, *scorer = spec.split(":")
        script.append(ScriptedGoal(int(minute), side, int(scorer[0]) if scorer else None))

    info, events = simulate_match(args.seed, script)
    try:
        replay(info, events, args.delay, args.speed, set(filter(None, args.only.split(","))))
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
