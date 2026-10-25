"""Shared helper for calling an agent with a timeout, one retry and timing."""

import asyncio
import json
import time
from dataclasses import dataclass

from agent_framework import Agent

from .llm import FAST_OPTIONS


@dataclass
class AgentResult:
    text: str | None  # None = failed or skipped; the caller uses its fallback
    ms: int
    error: str | None = None


async def run_agent(agent: Agent | None, payload: dict, timeout: float, retries: int = 1) -> AgentResult:
    """Send `payload` as JSON to the agent. Retries once on errors (not on timeouts: no time left)."""
    started = time.perf_counter()

    def elapsed() -> int:
        return round((time.perf_counter() - started) * 1000)

    if agent is None:
        return AgentResult(None, 0, "no model configured")
    prompt = json.dumps(payload, ensure_ascii=False)
    error = None
    for _ in range(retries + 1):
        try:
            response = await asyncio.wait_for(agent.run(prompt, options=FAST_OPTIONS), timeout)
            text = response.text.strip()
            if text:
                return AgentResult(text, elapsed())
            error = "empty reply"
        except TimeoutError:
            return AgentResult(None, elapsed(), "timeout")
        except Exception as e:  # auth, rate limit, content filter, network...
            error = type(e).__name__
    return AgentResult(None, elapsed(), error)


def parse_json(text: str | None) -> dict | None:
    """Read a JSON object from a model reply, tolerating ```json fences around it."""
    if not text:
        return None
    start, end = text.find("{"), text.rfind("}")
    try:
        return json.loads(text[start:end + 1]) if start != -1 else None
    except json.JSONDecodeError:
        return None
