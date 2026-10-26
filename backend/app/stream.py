"""Live match stream as Server-Sent Events (SSE).

Plays a simulated match at `speed` x real time and sends, in order of happening:
    info        once: teams and players
    event       every match event
    stats       the live state, every ~15 match seconds and after goals
    moment      a detected key moment (headline + facts + evidence event ids)
    commentary  the agents' output for a moment, when it arrives (runs in the background)
    end         the match is over

Each stream is one viewer session. The viewer's profile (mode, language) can be changed
mid-match through PROFILES, and applies from the next moment on.
"""

import asyncio
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

PROFILES: dict[str, Profile] = {}  # session id -> current viewer profile


def sse(kind: str, data: dict) -> str:
    return f"event: {kind}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


async def match_stream(seed: int, speed: float, script: list[ScriptedGoal], agents: Agents,
                       session: str, profile: Profile) -> AsyncIterator[str]:
    info, events = simulate_match(seed, script)  # generating takes ~0.03 s; playback is what takes time
    by_id = {e.id: e for e in events}
    state = MatchState(info)
    detector = MomentDetector(state)
    PROFILES[session] = profile

    replies: asyncio.Queue[str] = asyncio.Queue()  # agent output finished in the background
    limit = asyncio.Semaphore(MAX_PARALLEL_PIPELINES)
    tasks: set[asyncio.Task] = set()
    key_moments: list[str] = []
    previous_lines: list[str] = []
    loop = asyncio.get_running_loop()

    async def comment(job: Job):
        async with limit:
            output = await run_pipeline(agents, job)
        previous_lines.append(output["base_text"])
        await replies.put(sse("commentary", output))

    async def wait(seconds: float) -> AsyncIterator[str]:
        """Sleep for `seconds`, sending any commentary that finishes meanwhile."""
        deadline = loop.time() + seconds
        while (remaining := deadline - loop.time()) > 0:
            try:
                yield await asyncio.wait_for(replies.get(), remaining)
            except TimeoutError:
                return

    yield sse("info", info.model_dump())
    previous_t, last_stats_t = 0.0, -STATS_EVERY_SECONDS
    try:
        for e in events:
            async for message in wait(max(0.0, e.t - previous_t) / speed):
                yield message
            previous_t = e.t

            state.update(e)
            yield sse("event", e.model_dump(by_alias=True))
            for moment in detector.check(e):
                yield sse("moment", asdict(moment))
                job = Job(
                    moment=moment,
                    context=agent_context(state, moment),
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
                yield sse("stats", state.snapshot())

        if tasks:  # let the last commentary finish (the full-time recap)
            await asyncio.wait(tasks, timeout=30)
        while not replies.empty():
            yield replies.get_nowait()
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
