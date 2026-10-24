"""Measure football patterns from open event data and save them as calibration numbers.

The simulator never sees real matches. It only reads the aggregate numbers this
script writes (shares, rates, medians), so every generated match is new.

Usage (from backend/):
    python -m tools.calibrate /path/to/statsbomb/events/*.json

Source data: StatsBomb Open Data (https://github.com/statsbomb/open-data), used
only to measure averages. Do not commit the raw files.
"""

import json
import math
import statistics
import sys
from collections import Counter
from pathlib import Path

# StatsBomb pitch is 120 x 80 units; ours is a real pitch in metres.
SB_LENGTH, SB_WIDTH = 120, 80
PITCH_LENGTH, PITCH_WIDTH = 105.0, 68.0
SX, SY = PITCH_LENGTH / SB_LENGTH, PITCH_WIDTH / SB_WIDTH

SET_PIECES = {"Throw-in", "Goal Kick", "Corner", "Free Kick", "Kick Off"}
PASS_LENGTH_BUCKETS = [(0, 10), (10, 20), (20, 30), (30, 45), (45, 200)]
SHOT_DISTANCE_BUCKETS = [(0, 8), (8, 12), (12, 18), (18, 25), (25, 35), (35, 200)]
THIRDS = [("defensive", 0, 35), ("middle", 35, 70), ("attacking", 70, 106)]

OUTPUT = Path(__file__).resolve().parent.parent / "generator" / "calibration.json"


def to_metres(location):
    """StatsBomb [x, y] (always attacking toward x=120) -> metres, attacking toward x=105."""
    return location[0] * SX, location[1] * SY


def third_of(x):
    return next(name for name, lo, hi in THIRDS if lo <= x < hi)


def distance_to_goal(x, y):
    return math.hypot(PITCH_LENGTH - x, PITCH_WIDTH / 2 - y)


def bucket_of(value, buckets):
    return next(i for i, (lo, hi) in enumerate(buckets) if lo <= value < hi)


def share(part, whole):
    return round(part / whole, 4) if whole else 0.0


def load_events(paths):
    matches = []
    for path in paths:
        with open(path) as f:
            matches.append(json.load(f))
    return matches


def calibrate(matches):
    n = len(matches)
    passes, carries, shots, tackles = [], [], [], []
    fouls = yellows = reds = 0

    for events in matches:
        for e in events:
            kind = e["type"]["name"]
            if kind == "Pass" and e["pass"].get("type", {}).get("name") not in SET_PIECES:
                passes.append(e)
            elif kind == "Carry":
                carries.append(e)
            elif kind == "Shot" and e["shot"]["type"]["name"] == "Open Play":
                shots.append(e)
            elif kind == "Duel" and e["duel"]["type"]["name"] == "Tackle":
                tackles.append(e)
            elif kind == "Foul Committed":
                fouls += 1
                card = e.get("foul_committed", {}).get("card", {}).get("name", "")
                yellows += card == "Yellow Card"
                reds += card in ("Red Card", "Second Yellow")

    # --- passes -------------------------------------------------------------
    def pass_vector(p):
        x0, y0 = to_metres(p["location"])
        x1, y1 = to_metres(p["pass"]["end_location"])
        return x0, y0, x1 - x0, y1 - y0

    def failed(p):
        return "outcome" in p["pass"]

    length_stats = []
    for lo, hi in PASS_LENGTH_BUCKETS:
        group = [p for p in passes if lo <= math.hypot(*pass_vector(p)[2:]) < hi]
        heights = Counter(p["pass"]["height"]["name"] for p in group)
        length_stats.append({
            "min": lo,
            "max": hi,
            "share": share(len(group), len(passes)),
            "fail_rate": share(sum(map(failed, group)), len(group)),
            "high_share": share(heights["High Pass"], len(group)),
        })

    # Direction of passes relative to the attacking direction, per pitch third
    direction = {}
    for name, lo, hi in THIRDS:
        sectors = Counter()
        for p in passes:
            x0, _, dx, dy = pass_vector(p)
            if lo <= x0 < hi:
                angle = abs(math.degrees(math.atan2(dy, dx)))
                sectors["forward" if angle < 45 else "sideways" if angle < 135 else "backward"] += 1
        total = sum(sectors.values())
        direction[name] = {k: share(sectors[k], total) for k in ("forward", "sideways", "backward")}

    # Passes aimed close to goal fail far more often (the box is crowded),
    # relative to the overall fail rate
    overall_fail = share(sum(map(failed, passes)), len(passes))
    fail_by_target = []
    for i, (lo, hi) in enumerate(SHOT_DISTANCE_BUCKETS):
        group = [
            p for p in passes
            if bucket_of(distance_to_goal(*to_metres(p["pass"]["end_location"])), SHOT_DISTANCE_BUCKETS) == i
        ]
        fail_by_target.append({
            "min": lo,
            "max": hi,
            "multiplier": round(share(sum(map(failed, group)), len(group)) / overall_fail, 3),
        })

    pressed = [p for p in passes if p.get("under_pressure")]
    calm = [p for p in passes if not p.get("under_pressure")]
    failed_passes = [p for p in passes if failed(p)]

    def ball_speeds(height):
        speeds = [
            math.hypot(*pass_vector(p)[2:]) / p["duration"]
            for p in passes
            if p["pass"]["height"]["name"] == height and not failed(p) and p.get("duration", 0) > 0.2
        ]
        return round(statistics.median(speeds), 1)

    # --- pressure -----------------------------------------------------------
    on_ball = passes + shots
    pressure_by_third = {}
    for name, lo, hi in THIRDS:
        group = [e for e in on_ball if lo <= to_metres(e["location"])[0] < hi]
        pressure_by_third[name] = share(sum(bool(e.get("under_pressure")) for e in group), len(group))

    # --- shots --------------------------------------------------------------
    shot_buckets = []
    for i, (lo, hi) in enumerate(SHOT_DISTANCE_BUCKETS):
        in_bucket = lambda e: bucket_of(distance_to_goal(*to_metres(e["location"])), SHOT_DISTANCE_BUCKETS) == i
        bucket_shots = [s for s in shots if in_bucket(s)]
        bucket_passes = [p for p in passes if in_bucket(p)]
        goals = sum(s["shot"]["outcome"]["name"] == "Goal" for s in bucket_shots)
        shot_buckets.append({
            "min": lo,
            "max": hi,
            # Chance the player shoots instead of passing from this distance
            "shoot_prob": share(len(bucket_shots), len(bucket_shots) + len(bucket_passes)),
            "goal_rate": share(goals, len(bucket_shots)),
        })

    non_goal = Counter(s["shot"]["outcome"]["name"] for s in shots if s["shot"]["outcome"]["name"] != "Goal")
    outcome_names = {"Saved": "saved", "Off T": "off_target", "Wayward": "off_target", "Blocked": "blocked", "Post": "post"}
    miss_outcomes = Counter()
    for name, count in non_goal.items():
        miss_outcomes[outcome_names.get(name, "off_target")] += count

    # --- carries, tackles ---------------------------------------------------
    carry_lengths = [
        math.hypot(*(a - b for a, b in zip(to_metres(c["carry"]["end_location"]), to_metres(c["location"]))))
        for c in carries
    ]
    carry_speeds = [d / c["duration"] for d, c in zip(carry_lengths, carries) if c.get("duration", 0) > 0.3 and d > 1]
    tackle_won = sum(t["duel"].get("outcome", {}).get("name", "") in ("Won", "Success In Play", "Success Out") for t in tackles)

    on_ball_actions = len(passes) + len(shots)

    return {
        "source": f"StatsBomb Open Data, {n} matches (aggregate statistics only)",
        "pitch": {"length": PITCH_LENGTH, "width": PITCH_WIDTH},
        "per_match": {
            "open_play_passes": round(len(passes) / n, 1),
            "carries": round(len(carries) / n, 1),
            "open_play_shots": round(len(shots) / n, 1),
            "goals": round(sum(s["shot"]["outcome"]["name"] == "Goal" for s in shots) / n, 2),
            "tackles": round(len(tackles) / n, 1),
            "fouls": round(fouls / n, 1),
            "yellow_cards": round(yellows / n, 2),
        },
        "pass": {
            "length_buckets": length_stats,
            "direction_by_third": direction,
            "fail_multiplier_by_target_distance": fail_by_target,
            "pressure_fail_multiplier": round(
                share(sum(map(failed, pressed)), len(pressed)) / share(sum(map(failed, calm)), len(calm)), 3
            ),
            "out_of_play_share_of_fails": share(
                sum(p["pass"]["outcome"]["name"] == "Out" for p in failed_passes), len(failed_passes)
            ),
            "ball_speed_ms": {"ground": ball_speeds("Ground Pass"), "high": ball_speeds("High Pass")},
        },
        "carry": {
            "prob_before_action": share(len(carries), on_ball_actions),
            "length_deciles_m": [round(q, 1) for q in statistics.quantiles(carry_lengths, n=10)],
            "speed_ms_median": round(statistics.median(carry_speeds), 1),
            "tackle_prob": share(len(tackles), len(carries)),
            "tackle_success": share(tackle_won, len(tackles)),
        },
        "pressure": {"prob_by_third": pressure_by_third},
        "shot": {
            "distance_buckets": shot_buckets,
            "miss_outcomes": {k: share(v, sum(miss_outcomes.values())) for k, v in miss_outcomes.items()},
        },
        "discipline": {
            "foul_prob_per_action": share(fouls, on_ball_actions + len(carries)),
            "yellow_per_foul": share(yellows, fouls),
            "red_per_foul": share(reds, fouls),
        },
    }


def main():
    paths = sys.argv[1:]
    if not paths:
        sys.exit("usage: python -m tools.calibrate EVENTS.json [EVENTS.json ...]")
    result = calibrate(load_events(paths))
    OUTPUT.write_text(json.dumps(result, indent=2) + "\n")
    print(f"Wrote {OUTPUT} from {len(paths)} matches")


if __name__ == "__main__":
    main()
