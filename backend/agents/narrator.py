"""Narrator agent: turns a detected moment into one live commentary line.

It only sees the moment's facts (computed by the stats engine), never raw guesses,
and is told to use nothing else. If the model is slow, unavailable or errors, the
moment's template headline is used instead, so the broadcast never stalls.
"""

import asyncio
import json
import time

from agent_framework import Agent

from engine.moments import Moment

from .llm import FAST_OPTIONS

INSTRUCTIONS = """You are a live football TV commentator.
You get one match moment as JSON: its kind, the match minute, the score and a set of facts.
Write ONE commentary line, at most 25 words, in an energetic but natural broadcast voice.
Rules:
- Use only the names, numbers and details in the JSON. Never invent players, scores, stats or events.
- Do not mention xG, ids or JSON. Translate numbers into football language (e.g. a high xG is "a golden chance").
- No emoji, hashtags or quotation marks."""

TIMEOUT_SECONDS = 8


class Narrator:
    def __init__(self, client):
        self.agent = Agent(client, INSTRUCTIONS, name="narrator") if client else None

    async def narrate(self, moment: Moment, score: dict) -> dict:
        """Returns {"text", "source": "agent" | "fallback", "ms"}."""
        started = time.perf_counter()
        if self.agent is None:
            return {"text": moment.headline, "source": "fallback", "ms": 0}

        prompt = json.dumps({
            "kind": moment.kind,
            "minute": int(moment.t // 60) + 1,
            "score": f"{score['home']}-{score['away']}",
            "facts": moment.facts,
        })
        try:
            response = await asyncio.wait_for(self.agent.run(prompt, options=FAST_OPTIONS), TIMEOUT_SECONDS)
            text = response.text.strip()
            if not text:
                raise ValueError("empty reply")
            return {"text": text, "source": "agent", "ms": round((time.perf_counter() - started) * 1000)}
        except Exception as error:  # timeout, auth, rate limit, content filter...
            return {"text": moment.headline, "source": "fallback", "error": type(error).__name__,
                    "ms": round((time.perf_counter() - started) * 1000)}
