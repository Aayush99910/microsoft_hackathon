"""Measure football patterns from open event data and save them as calibration numbers.

The simulator never sees real matches. It only reads the aggregate numbers this
script writes (shares, rates, medians), so every generated match is new.

Usage (from backend/):
    python -m tools.calibrate events_World_Cup.json events_European_Championship.json

Source data: the public Wyscout soccer-logs dataset, licensed CC BY 4.0:
    Pappalardo et al. (2019) "A public data set of spatio-temporal match events in
    soccer competitions", Scientific Data 6:236. https://doi.org/10.1038/s41597-019-0247-7
    Files: https://figshare.com/collections/Soccer_match_event_dataset/4415000
Only non-Premier League competitions are used. Do not commit the raw files.

A few things the dataset does not record (carries, how often players are under
pressure, volleys, deflections, ball speed). Those are set in ASSUMPTIONS below
and marked as such in the output, so it is always clear what was measured.
"""

import json
import math
import sys
from collections import Counter, defaultdict
from pathlib import Path

# Wyscout positions are percentages of the pitch, x toward the opponent goal and
# y from the attacker's left; ours are metres with low y on the attacker's right.
PITCH_LENGTH, PITCH_WIDTH = 105.0, 68.0

PASS_LENGTH_BUCKETS = [(0, 10), (10, 20), (20, 30), (30, 45), (45, 200)]
SHOT_DISTANCE_BUCKETS = [(0, 8), (8, 12), (12, 18), (18, 25), (25, 35), (35, 200)]
THIRDS = [("defensive", 0, 35), ("middle", 35, 70), ("attacking", 70, 106)]

# Wyscout tag ids (see tags2name.csv in the dataset)
GOAL, LEFT_FOOT, HEAD = 101, 401, 403
HIGH, LOW, BLOCKED, LOST = 801, 802, 2101, 701
NOT_ACCURATE = 1802
YELLOW, RED, SECOND_YELLOW = 1702, 1701, 1703
WOODWORK_TAGS = range(1217, 1224)  # "Post ..." shot positions
OFF_TARGET_TAGS = range(1210, 1217)  # "Out ..." shot positions

HIGH_PASSES = {"High pass", "Launch", "Head pass"}  # crosses depend on their high/low tag

# Not in the dataset: chosen by hand, and labelled "assumption" in the output.
ASSUMPTIONS = {
    "carry_prob_before_action": 0.8,  # most players take a touch or run before passing
    # Fairly short: Wyscout ends a pass where the receiver next plays the ball, so the
    # measured pass lengths already include some of the running with the ball in between.
    "carry_mean_length_m": 2.5,
    "carry_speed_ms": 3.0,  # jogging with the ball
    "pressure_prob_by_third": {"defensive": 0.2, "middle": 0.2, "attacking": 0.25},
    "ball_speed_ms": {"ground": 12.0, "high": 14.0},
    "deflected_share": 0.02,
    "technique": {
        "foot_after_high_pass": {"normal": 0.55, "volley": 0.25, "half_volley": 0.17, "overhead": 0.03},
        "foot_otherwise": {"normal": 0.85, "half_volley": 0.09, "volley": 0.05, "overhead": 0.01},
        "head": {"normal": 0.93, "diving_header": 0.07},
    },
}

OUTPUT = Path(__file__).resolve().parent.parent / "generator" / "calibration.json"


def to_metres(position):
    """Wyscout {x, y} in % -> metres in our frame (attacking toward x=105, low y = right side)."""
    return position["x"] / 100 * PITCH_LENGTH, (100 - position["y"]) / 100 * PITCH_WIDTH


def start(e):
    return to_metres(e["positions"][0])


def end(e):
    return to_metres(e["positions"][-1])


def tags(e):
    return {t["id"] for t in e["tags"]}


def distance_to_goal(x, y):
    return math.hypot(PITCH_LENGTH - x, PITCH_WIDTH / 2 - y)


def in_box(x, y):
    return x >= PITCH_LENGTH - 16.5 and abs(y - PITCH_WIDTH / 2) <= 20.16


def bucket_of(value, buckets):
    return next(i for i, (lo, hi) in enumerate(buckets) if lo <= value < hi)


def share(part, whole):
    return round(part / whole, 4) if whole else 0.0


def load_events(paths):
    events = []
    for path in paths:
        with open(path) as f:
            events.extend(json.load(f))
    return events


def calibrate(events):
    matches = {e["matchId"] for e in events}
    n = len(matches)

    # Sort each half's events by time, so we can look at what happened just before
    halves = defaultdict(list)
    for e in events:
        halves[(e["matchId"], e["matchPeriod"])].append(e)
    for half in halves.values():
        half.sort(key=lambda e: e["eventSec"])

    passes, shots, challenges, fouls = [], [], [], []
    other_touches = []  # touches, dribbles and runs: on the ball, but neither a pass nor a shot
    pressed_ids = set()  # passes made right after the passer was challenged in a duel
    after_high_pass = set()  # shots that came straight from a lifted pass
    out_after_fail = set()  # failed passes that went out of play

    for half in halves.values():
        for i, e in enumerate(half):
            kind, sub, tg = e["eventName"], e["subEventName"], tags(e)
            before, after = half[max(0, i - 4):i], half[i + 1:i + 3]

            if kind == "Pass" and sub != "Hand pass":  # hand passes are goalkeeper throws
                passes.append(e)
                if any(b["playerId"] == e["playerId"] and b["subEventName"] == "Ground attacking duel"
                       and e["eventSec"] - b["eventSec"] <= 2 for b in before):
                    pressed_ids.add(e["id"])
                if NOT_ACCURATE in tg and any(a["subEventName"] in ("Ball out of the field", "Throw in") for a in after):
                    out_after_fail.add(e["id"])
            elif kind == "Shot":
                shots.append(e)
                setup = next((b for b in reversed(before) if b["teamId"] == e["teamId"] and b["eventName"] == "Pass"), None)
                if setup and is_high(setup) and e["eventSec"] - setup["eventSec"] <= 4:
                    after_high_pass.add(e["id"])
            elif kind == "Duel" and sub == "Ground attacking duel":  # the ball carrier's side of a challenge
                challenges.append(e)
                other_touches.append(e)
            elif kind == "Others on the ball" and sub in ("Touch", "Acceleration"):
                other_touches.append(e)
            elif kind == "Foul":
                fouls.append(e)

    # --- passes -------------------------------------------------------------
    def length(p):
        (x0, y0), (x1, y1) = start(p), end(p)
        return math.hypot(x1 - x0, y1 - y0)

    def failed(p):
        return NOT_ACCURATE in tags(p)

    length_stats = []
    for lo, hi in PASS_LENGTH_BUCKETS:
        group = [p for p in passes if lo <= length(p) < hi]
        length_stats.append({
            "min": lo,
            "max": hi,
            "share": share(len(group), len(passes)),
            "fail_rate": share(sum(map(failed, group)), len(group)),
            "high_share": share(sum(map(is_high, group)), len(group)),
        })

    # Direction of passes relative to the attacking direction, per pitch third
    direction = {}
    for name, lo, hi in THIRDS:
        sectors = Counter()
        for p in passes:
            (x0, y0), (x1, y1) = start(p), end(p)
            if lo <= x0 < hi and (x1, y1) != (x0, y0):
                angle = abs(math.degrees(math.atan2(y1 - y0, x1 - x0)))
                sectors["forward" if angle < 45 else "sideways" if angle < 135 else "backward"] += 1
        total = sum(sectors.values())
        direction[name] = {k: share(sectors[k], total) for k in ("forward", "sideways", "backward")}

    # Passes aimed close to goal fail far more often (the box is crowded),
    # relative to the overall fail rate
    overall_fail = share(sum(map(failed, passes)), len(passes))
    fail_by_target = []
    for i, (lo, hi) in enumerate(SHOT_DISTANCE_BUCKETS):
        group = [p for p in passes if bucket_of(distance_to_goal(*end(p)), SHOT_DISTANCE_BUCKETS) == i]
        fail_by_target.append({
            "min": lo,
            "max": hi,
            "multiplier": round(share(sum(map(failed, group)), len(group)) / overall_fail, 3),
        })

    # Passes into the penalty area are often crosses, lifted regardless of length
    into_box = [p for p in passes if in_box(*end(p))]

    # Under pressure: the dataset has no pressure flag, so a duel just before the pass stands in for it
    pressed = [p for p in passes if p["id"] in pressed_ids]
    calm = [p for p in passes if p["id"] not in pressed_ids]
    failed_passes = [p for p in passes if failed(p)]

    # --- shots --------------------------------------------------------------
    def is_goal(s):
        return GOAL in tags(s)

    def is_header(s):
        return HEAD in tags(s)

    shot_buckets = []
    for i, (lo, hi) in enumerate(SHOT_DISTANCE_BUCKETS):
        bucket_shots = [s for s in shots if bucket_of(distance_to_goal(*start(s)), SHOT_DISTANCE_BUCKETS) == i]
        # Everything an attacker does on the ball from this distance: pass, shot, touch, duel, run
        bucket_actions = [
            e for e in passes + shots + other_touches
            if bucket_of(distance_to_goal(*start(e)), SHOT_DISTANCE_BUCKETS) == i
        ]
        shot_buckets.append({
            "min": lo,
            "max": hi,
            # Chance the player shoots, per action on the ball at this distance
            "shoot_prob": share(len(bucket_shots), len(bucket_actions)),
            "goal_rate": share(sum(map(is_goal, bucket_shots)), len(bucket_shots)),
        })

    def miss_outcome(s):
        tg = tags(s)
        if BLOCKED in tg:
            return "blocked"
        if tg & set(WOODWORK_TAGS):
            return "woodwork"
        if tg & set(OFF_TARGET_TAGS):
            return "off_target"
        return "saved"  # on target but not a goal

    misses = Counter(miss_outcome(s) for s in shots if not is_goal(s))

    high = [s for s in shots if s["id"] in after_high_pass]
    low = [s for s in shots if s["id"] not in after_high_pass]
    headers = [s for s in shots if is_header(s)]
    foot_shots = [s for s in shots if not is_header(s)]

    # Headers score less than foot shots from the same distance: actual goals / expected from distance alone
    expected_header_goals = sum(
        shot_buckets[bucket_of(distance_to_goal(*start(s)), SHOT_DISTANCE_BUCKETS)]["goal_rate"] for s in headers
    )

    # --- tackles, fouls -----------------------------------------------------
    # Defenders challenge far more near their own box, so measure per third (of the attacker's pitch)
    on_ball_actions = len(passes) + len(shots)
    tackle_by_third = {}
    for name, lo, hi in THIRDS:
        actions = [e for e in passes + shots if lo <= start(e)[0] < hi]
        group = [c for c in challenges if lo <= start(c)[0] < hi]
        tackle_by_third[name] = {
            "prob_per_action": share(len(group), len(actions)),
            "success": share(sum(LOST in tags(c) for c in group), len(group)),  # attacker lost = tackle won
        }
    cards = Counter(
        "red" if tags(f) & {RED, SECOND_YELLOW} else "yellow" if YELLOW in tags(f) else "none" for f in fouls
    )

    return {
        "source": (
            f"Wyscout public soccer-logs (Pappalardo et al. 2019, CC BY 4.0), {n} World Cup 2018 and "
            "Euro 2016 matches; aggregate statistics only"
        ),
        "pitch": {"length": PITCH_LENGTH, "width": PITCH_WIDTH},
        "per_match": {
            "passes": round(len(passes) / n, 1),
            "pass_accuracy": round(1 - overall_fail, 3),
            "shots": round(len(shots) / n, 1),
            "goals": round(sum(map(is_goal, shots)) / n, 2),
            "fouls": round(len(fouls) / n, 1),
            "yellow_cards": round(cards["yellow"] / n, 2),
        },
        "pass": {
            "length_buckets": length_stats,
            "direction_by_third": direction,
            "fail_multiplier_by_target_distance": fail_by_target,
            # measured with the duel proxy: passes made just after being challenged
            "pressure_fail_multiplier": round(
                share(sum(map(failed, pressed)), len(pressed)) / share(sum(map(failed, calm)), len(calm)), 3
            ),
            "out_of_play_share_of_fails": share(len(out_after_fail), len(failed_passes)),
            "ball_speed_ms": ASSUMPTIONS["ball_speed_ms"],  # assumption
            "high_share_into_box": share(sum(map(is_high, into_box)), len(into_box)),
        },
        "carry": {  # assumption: the dataset has no carries
            "prob_before_action": ASSUMPTIONS["carry_prob_before_action"],
            "length_deciles_m": exponential_deciles(ASSUMPTIONS["carry_mean_length_m"]),
            "speed_ms_median": ASSUMPTIONS["carry_speed_ms"],
        },
        # ground duels per pass/shot, and how often the defender wins them
        "tackle": {"by_third": tackle_by_third},
        "pressure": {"prob_by_third": ASSUMPTIONS["pressure_prob_by_third"]},  # assumption
        "shot": {
            "distance_buckets": shot_buckets,
            "miss_outcomes": {k: share(v, sum(misses.values())) for k, v in misses.most_common()},
            "deflected_share": ASSUMPTIONS["deflected_share"],  # assumption
            "header_share": {
                "after_high_pass": share(sum(map(is_header, high)), len(high)),
                "otherwise": share(sum(map(is_header, low)), len(low)),
            },
            "left_foot_share": share(sum(LEFT_FOOT in tags(s) for s in foot_shots), len(foot_shots)),
            "technique": ASSUMPTIONS["technique"],  # assumption: the dataset has no technique
            "header_xg_multiplier": round(sum(map(is_goal, headers)) / expected_header_goals, 3),
        },
        "discipline": {
            "foul_prob_per_action": share(len(fouls), on_ball_actions),
            "yellow_per_foul": share(cards["yellow"], len(fouls)),
            "red_per_foul": share(cards["red"], len(fouls)),
        },
        "assumptions": sorted(
            ["pass.ball_speed_ms", "carry", "pressure.prob_by_third", "shot.deflected_share", "shot.technique"]
        ),
    }


def is_high(p):
    """Was the pass lifted? Crosses are tagged high or low; the rest go by pass type."""
    if p["subEventName"] == "Cross":
        return HIGH in tags(p) or LOW not in tags(p)
    return p["subEventName"] in HIGH_PASSES


def exponential_deciles(mean):
    """10%, 20%, ..., 90% points of an exponential distribution: many short values, a few long ones."""
    return [round(-mean * math.log(1 - q / 10), 1) for q in range(1, 10)]


def main():
    paths = sys.argv[1:]
    if not paths:
        sys.exit("usage: python -m tools.calibrate events_World_Cup.json [more event files ...]")
    result = calibrate(load_events(paths))
    OUTPUT.write_text(json.dumps(result, indent=2) + "\n")
    print(f"Wrote {OUTPUT}")


if __name__ == "__main__":
    main()
