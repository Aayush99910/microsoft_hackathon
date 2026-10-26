"""Live match stream as Server-Sent Events (SSE).

Plays a simulated match at `speed` x real time and sends, in order of happening:
    info        once: teams and players
    event       every match event
    stats       the live state, every ~15 match seconds and after goals
    moment      a detected key moment (headline + facts + evidence event ids)
    commentary  the agents' output for a moment, sent as soon as it is ready
    end         the match is over

Everything except commentary is shown BROADCAST_DELAY seconds after it happens (see match_stream).
Each stream is one viewer session. The viewer's profile (mode, language) can be changed
mid-match through PROFILES, and applies from the next moment on.
"""

import asyncio
import heapq
import itertools
import json
from collections import Counter
from collections.abc import AsyncIterator
from dataclasses import asdict

from agents.personalizer import Profile
from agents.pipeline import Agents, Job, run_pipeline
from engine.moments import MomentDetector
from engine.stats import MatchState
from generator.events import Event
from generator.match_sim import ScriptedGoal, simulate_match

STATS_EVERY_SECONDS = 15  # match time between stats messages
MAX_PARALLEL_PIPELINES = 3
# Real seconds between the server analysing an event and the viewer seeing it. The agents
# (2-4 s) and the voice (about 1 s) finish within it, so commentary arrives with its moment.
BROADCAST_DELAY = 5.0


def spoken_word_budget(speed: float) -> int:
    """How many words the commentator has time to say per moment at this playback speed."""
    if speed <= 12:
        return 32  # relaxed: say what happened and why it matters
    if speed <= 40:
        return 18  # standard
    return 10  # highlights: short bursts only

PROFILES: dict[str, Profile] = {}  # session id -> current viewer profile


def sse(kind: str, data: dict) -> str:
    return f"event: {kind}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


async def match_stream(seed: int, speed: float, script: list[ScriptedGoal], agents: Agents,
                       session: str, profile: Profile) -> AsyncIterator[str]:
    """Stream a match with a short broadcast delay.

    The server reads the match BROADCAST_DELAY seconds ahead of what the viewer sees: each event
    is analysed (and its key moments sent to the agents) as soon as it happens, but is shown on
    screen a few seconds later. Commentary is sent the moment it is ready, so it usually reaches
    the browser before its moment does, and card, voice and crowd reaction land together.
    """
    info, events = simulate_match(seed, script)  # generating takes ~0.03 s; playback is what takes time
    by_id = {e.id: e for e in events}
    state = MatchState(info)
    detector = MomentDetector(state)
    PROFILES[session] = profile

    loop = asyncio.get_running_loop()
    outbox: list[tuple[float, int, str]] = []  # (send at, order, message), sent in time order
    order = itertools.count()
    ready: asyncio.Queue[str] = asyncio.Queue()  # commentary finished in the background
    limit = asyncio.Semaphore(MAX_PARALLEL_PIPELINES)
    tasks: set[asyncio.Task] = set()
    key_moments: list[str] = []
    previous_lines: list[str] = []

    def send_at(when: float, message: str) -> None:
        heapq.heappush(outbox, (when, next(order), message))

    async def comment(job: Job):
        async with limit:
            output = await run_pipeline(agents, job)
        previous_lines.append(output["base_text"])
        await ready.put(sse("commentary", output))

    async def deliver(until: float) -> AsyncIterator[str]:
        """Send everything due before `until`, and commentary as soon as it is ready."""
        while True:
            while not ready.empty():
                send_at(loop.time(), ready.get_nowait())
            now = loop.time()
            while outbox and outbox[0][0] <= now:
                yield heapq.heappop(outbox)[2]
            if now >= until:
                return
            wake = min(until, outbox[0][0]) if outbox else until
            try:
                send_at(loop.time(), await asyncio.wait_for(ready.get(), max(0.0, wake - now)))
            except TimeoutError:
                pass

    yield sse("info", info.model_dump())
    started = loop.time()
    played, previous_t, last_stats_t = 0.0, 0.0, -STATS_EVERY_SECONDS
    try:
        for e in events:
            played += max(0.0, e.t - previous_t) / speed  # real seconds of match played so far
            previous_t = e.t
            async for message in deliver(started + played):
                yield message

            state.update(e)
            on_screen = loop.time() + BROADCAST_DELAY
            send_at(on_screen, sse("event", e.model_dump(by_alias=True)))
            for moment in detector.check(e):
                send_at(on_screen, sse("moment", asdict(moment)))
                job = Job(
                    moment=moment,
                    context={**agent_context(state, moment), "spoken_max_words": spoken_word_budget(speed)},
                    evidence=evidence_summary([by_id[i] for i in moment.evidence if i in by_id]),
                    story={"key_moments": list(key_moments), "standout_players": standout_players(state)},
                    previous_lines=list(previous_lines),
                    profile=PROFILES.get(session, profile),
                )
                if moment.importance >= 2:
                    key_moments.append(f"{int(moment.t // 60) + 1}' {moment.headline}")
                task = asyncio.create_task(comment(job))
                tasks.add(task)
                task.add_done_callback(tasks.discard)

            if e.t - last_stats_t >= STATS_EVERY_SECONDS or e.type in ("goal", "period_end"):
                last_stats_t = e.t
                send_at(on_screen, sse("stats", state.snapshot()))

        if tasks:  # let the last commentary finish (the full-time recap)
            await asyncio.wait(tasks, timeout=30)
        last_due = max((when for when, _, _ in outbox), default=loop.time())
        async for message in deliver(max(last_due, loop.time())):
            yield message
        while not ready.empty():
            yield ready.get_nowait()
        yield sse("end", {"score": state.snapshot()["score"]})
    finally:
        for task in tasks:  # viewer left early: stop pending agent work
            task.cancel()
        PROFILES.pop(session, None)


# --- shared state handed to the agents ---------------------------------------------


def agent_context(state: MatchState, moment) -> dict:
    """The match situation in plain, named terms (agents misread raw signed numbers and side codes)."""
    snap, info = state.snapshot(), state.info
    name = {"home": info.home.name, "away": info.away.name}
    recent = snap["recent"]
    momentum = recent["momentum"]
    leader = "home" if momentum > 0.15 else "away" if momentum < -0.15 else None

    def named(values: dict, scale: float = 1) -> dict:
        return {name[k]: (round(v * scale) if scale != 1 else v) if v is not None else None for k, v in values.items()}

    return {
        "minute": int(moment.t // 60) + 1,
        "score": f"{info.home.name} {snap['score']['home']}-{snap['score']['away']} {info.away.name}",
        "recent": {
            "team_creating_most_threat": name[leader] if leader else "neither, it is even",
            "their_share_of_threat_pct": round(50 + abs(momentum) * 50) if leader else 50,
            "pass_accuracy_pct": named(recent["pass_accuracy"], 100),
            "pressures_per_min": named(recent["pressures_per_min"]),
            "turnovers_per_min": recent["turnovers_per_min"],
        },
        "team_stats": {
            name[side]: {
                "possession_pct": snap["possession_pct"][side],
                "shots": t["shots"],
                "on_target": t["shots_on_target"],
                "xg": t["xg"],
                "pass_accuracy_pct": round(t["pass_accuracy"] * 100) if t["pass_accuracy"] else None,
                "tackles_won": t["tackles_won"],
            }
            for side, t in snap["teams"].items()
        },
    }


def evidence_summary(events: list[Event]) -> dict:
    """What the evidence events contain, so the Explainer can ground its reasoning."""
    if not events:
        return {"events": 0}
    passes = [e for e in events if e.type == "pass"]
    summary = {
        "events": len(events),
        "by_type": dict(Counter(e.type for e in events)),
        "seconds_covered": round(events[-1].t - events[0].t),
        "players_involved": len({e.player_id for e in events if e.player_id}),
    }
    if passes:  # only meaningful when the evidence is passes (a "0" here was misread as "no passes completed")
        summary["passes_completed_of_attempted"] = f"{sum(p.pass_.outcome == 'complete' for p in passes)}/{len(passes)}"
    return summary


def standout_players(state: MatchState, top: int = 3) -> list[dict]:
    def score(pid: int) -> float:
        p = state.players[pid]
        return p.goals * 3 + p.assists * 2 + p.xg + p.tackles_won * 0.2 + p.passes_completed * 0.01

    best = sorted(state.players, key=score, reverse=True)[:top]
    return [
        {k: v for k, v in state.player_line(pid).items()
         if k in ("name", "goals", "assists", "shots", "xg", "tackles_won", "passes_completed")}
        for pid in best
    ]
