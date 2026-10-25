"""Live match stream as Server-Sent Events (SSE).

Plays a simulated match at `speed` x real time and sends, in order of happening:
    info        once: teams and players
    event       every match event
    stats       the live state, every ~15 match seconds and after goals
    moment      a detected key moment (headline + facts + evidence event ids)
    commentary  the Narrator's line for a moment, when it arrives (runs in the background)
    end         the match is over
"""

import asyncio
import json
from collections.abc import AsyncIterator
from dataclasses import asdict

from agents.narrator import Narrator
from engine.moments import MomentDetector
from engine.stats import MatchState
from generator.match_sim import ScriptedGoal, simulate_match

STATS_EVERY_SECONDS = 15  # match time between stats messages
MAX_PARALLEL_NARRATIONS = 3


def sse(kind: str, data: dict) -> str:
    return f"event: {kind}\ndata: {json.dumps(data)}\n\n"


async def match_stream(seed: int, speed: float, script: list[ScriptedGoal], narrator: Narrator) -> AsyncIterator[str]:
    info, events = simulate_match(seed, script)  # generating takes ~0.03 s; playback is what takes time
    state = MatchState(info)
    detector = MomentDetector(state)
    replies: asyncio.Queue[str] = asyncio.Queue()  # commentary lines finished in the background
    limit = asyncio.Semaphore(MAX_PARALLEL_NARRATIONS)
    tasks: set[asyncio.Task] = set()
    loop = asyncio.get_running_loop()

    async def narrate(moment, score):
        async with limit:
            line = await narrator.narrate(moment, score)
        await replies.put(sse("commentary", {"moment_id": moment.id, **line}))

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
                task = asyncio.create_task(narrate(moment, state.snapshot()["score"]))
                tasks.add(task)
                task.add_done_callback(tasks.discard)

            if e.t - last_stats_t >= STATS_EVERY_SECONDS or e.type in ("goal", "period_end"):
                last_stats_t = e.t
                yield sse("stats", state.snapshot())

        if tasks:  # let the last commentary lines finish
            await asyncio.wait(tasks, timeout=15)
        while not replies.empty():
            yield replies.get_nowait()
        yield sse("end", {"score": state.snapshot()["score"]})
    finally:
        for task in tasks:  # viewer left early: stop pending narrations
            task.cancel()
